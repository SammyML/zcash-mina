/**
 * Deployment and Usage
 * 
 *
 * - Deploying contracts
 * - Minting zkZEC
 * - Burning zkZEC
 * - Managing the bridge
 */

import fs from 'fs/promises';
import path from 'node:path';
import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt64,
  Field,
  UInt32,
  MerkleMap,
  fetchAccount,
} from 'o1js';

import { zkZECToken, Bridge } from './bridge-contracts.js';
import { BridgeV3, BridgeHelper } from './bridge.js';
import {
  ZcashVerifier,
  ZcashProofHelper,
  ZcashShieldedProof,
  ZcashProofVerification,
} from './zcash-verifier.js';
import {
  LightClient,
  LightClientHelper,
  Checkpoint,
  MerkleBranch,
  ZCASH_GENESIS_BLOCK_HASH,
} from './light-client.js';

// Configuration

interface Config {
  network: 'local' | 'devnet' | 'mainnet';
  minaUrl: string;
  zcashUrl: string;
  deployerKeyPath: string;
  operatorKeyPath: string;
  tokenAddress?: string;
  bridgeAddress?: string;
}

async function loadConfig(network: string): Promise<Config> {
  const configPath = `config/${network}.json`;
  try {
    const configData = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(configData);
  } catch (error) {
    throw new Error(
      `Missing config file at ${configPath}. Please create one before running commands.`
    );
  }
}

async function saveConfig(network: string, config: Config): Promise<void> {
  const configPath = `config/${network}.json`;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
}

type NetworkContext = {
  isLocal: boolean;
  deployerKey: PrivateKey;
  operatorKey: PrivateKey;
  burnerKey?: PrivateKey;
  proofsEnabled: boolean;
};

async function initNetwork(config: Config): Promise<NetworkContext> {
  if (config.network === 'local') {
    const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
    Mina.setActiveInstance(Local);
    const deployerKey = Local.testAccounts[0].key;
    const operatorKey = Local.testAccounts[1].key;
    const burnerKey = Local.testAccounts[2]?.key;
    return {
      isLocal: true,
      deployerKey,
      operatorKey,
      burnerKey,
      proofsEnabled: true,
    };
  }

  const Network = Mina.Network(config.minaUrl);
  Mina.setActiveInstance(Network);

  const deployerKey = await loadPrivateKey(config.deployerKeyPath);
  const operatorKey = await loadPrivateKey(config.operatorKeyPath);

  return { isLocal: false, deployerKey, operatorKey, proofsEnabled: true };
}

// Deployment Scripts


/**
 * Deploy zkZEC token and Bridge contracts
 */
export async function deployContracts(networkName: string) {
  console.log(`\n Deploying to ${networkName}...\n`);

  // Load configuration
  const config = await loadConfig(networkName);

  // Setup network & keys
  const { deployerKey, operatorKey, proofsEnabled } = await initNetwork(config);
  const deployerAccount = deployerKey.toPublicKey();
  const operatorAccount = operatorKey.toPublicKey();

  console.log('Accounts:');
  console.log(`Deployer: ${deployerAccount.toBase58()}`);
  console.log(`Operator: ${operatorAccount.toBase58()}\n`);

  // Compile contracts
  const useBasicBridge = config.network === 'local';

  console.log('Compiling contracts');
  const { verificationKey: tokenVerificationKey } = await zkZECToken.compile();
  let bridgeVerificationKey;
  if (useBasicBridge) {
    ({ verificationKey: bridgeVerificationKey } = await Bridge.compile());
  } else {
    ({ verificationKey: bridgeVerificationKey } = await BridgeV3.compile());
    await ZcashVerifier.compile();
    await LightClient.compile();
  }
  console.log('Compilation complete\n');

  // Deploy token
  console.log('Deploying zkZEC Token');
  const tokenKey = PrivateKey.random();
  const tokenAddress = tokenKey.toPublicKey();
  const token = new zkZECToken(tokenAddress);

  const deployTokenTx = await Mina.transaction(
    { sender: deployerAccount, fee: 0.1e9 },
    async () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      await token.deploy({ verificationKey: tokenVerificationKey });
    }
  );
  await proveIfNeeded(deployTokenTx, proofsEnabled);
  await deployTokenTx.sign([deployerKey, tokenKey]).send();
  console.log(`Token deployed: ${tokenAddress.toBase58()}\n`);

  // Deploy bridge
  console.log('Deploying Bridge');
  const bridgeKey = PrivateKey.random();
  const bridgeAddress = bridgeKey.toPublicKey();
  if (useBasicBridge) {
    const bridge = new Bridge(bridgeAddress);
    const deployBridgeTx = await Mina.transaction(
      { sender: deployerAccount, fee: 0.2e9 },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await bridge.deploy({ verificationKey: bridgeVerificationKey });
        await bridge.initialize(tokenAddress, operatorAccount);
      }
    );
    await proveIfNeeded(deployBridgeTx, proofsEnabled);
    await deployBridgeTx.sign([deployerKey, bridgeKey]).send();
  } else {
    const bridge = new BridgeV3(bridgeAddress);
    const genesisHash = ZCASH_GENESIS_BLOCK_HASH;
    const genesisHeight = UInt64.from(0);

    const deployBridgeTx = await Mina.transaction(
      { sender: deployerAccount, fee: 0.2e9 },
      async () => {
        AccountUpdate.fundNewAccount(deployerAccount);
        await bridge.deploy({ verificationKey: bridgeVerificationKey });
        await bridge.initialize(
          tokenAddress,
          operatorAccount,
          genesisHash,
          genesisHeight
        );
      }
    );
    await proveIfNeeded(deployBridgeTx, proofsEnabled);
    await deployBridgeTx.sign([deployerKey, bridgeKey]).send();
  }
  console.log(`Bridge deployed: ${bridgeAddress.toBase58()}\n`);

  // Save addresses
  config.tokenAddress = tokenAddress.toBase58();
  config.bridgeAddress = bridgeAddress.toBase58();
  await saveConfig(networkName, config);

  // Save keys
  await savePrivateKey(`keys/${networkName}-token.json`, tokenKey);
  await savePrivateKey(`keys/${networkName}-bridge.json`, bridgeKey);

  console.log('Deployment complete!\n');
  console.log('Summary:');
  console.log(`Token:  ${tokenAddress.toBase58()}`);
  console.log(`Bridge: ${bridgeAddress.toBase58()}`);
}

// Minting Script

/**
 * Mint zkZEC from Zcash transaction
 */
export async function mintZkZEC(
  networkName: string,
  zcashTxHash: string,
  recipientAddress: string,
  amount: string
) {
  console.log(`\n Minting zkZEC...\n`);

  // Load configuration
  const config = await loadConfig(networkName);
  if (config.network === 'local') {
    throw new Error(
      'Minting via CLI is disabled on the local mock network. Run `npm run interact` for local demonstrations.'
    );
  }

  if (!config.bridgeAddress) {
    throw new Error('Bridge not deployed');
  }

  // Setup network
  const { operatorKey, proofsEnabled } = await initNetwork(config);
  const operatorAccount = operatorKey.toPublicKey();

  // Load bridge
  const bridgeAddress = PublicKey.fromBase58(config.bridgeAddress);
  const bridge = new BridgeV3(bridgeAddress);

  // Fetch Zcash transaction
  console.log(`Fetching Zcash transaction: ${zcashTxHash}`);
  const zcashTx = await fetchZcashTransaction(config.zcashUrl, zcashTxHash);
  
  // Parse proof
  const zcashProof = ZcashProofHelper.parseTransaction(zcashTx);
  const txHash = Field(zcashTxHash);

  // Generate verification proof
  console.log('Generating verification proof');
  const verification = await ZcashVerifier.verifySingle(txHash, zcashProof);

  // Prepare Merkle witnesses
  const nullifierMap = new MerkleMap();
  const processedMap = new MerkleMap();

  const nullifierWitness1 = nullifierMap.getWitness(
    zcashProof.nullifier1.value
  );
  const nullifierWitness2 = nullifierMap.getWitness(
    zcashProof.nullifier2.value
  );
  const processedTxWitness = processedMap.getWitness(txHash);

  // Create mock Merkle branch
  const merkleBranch = new MerkleBranch({
    path: Array(32).fill(Field(0)),
    index: UInt32.from(0),
    pathLength: UInt32.from(10),
  });

  // Mint
  console.log('Minting tokens...');
  const recipient = PublicKey.fromBase58(recipientAddress);
  const mintAmount = UInt64.from(amount);

  const mintTx = await Mina.transaction(
    { sender: operatorAccount, fee: 0.05e9 },
    async () => {
      await bridge.mintWithFullVerification(
        recipient,
        mintAmount,
        txHash,
        zcashProof,
        verification.proof as ZcashProofVerification,
        merkleBranch,
        nullifierWitness1,
        nullifierWitness2,
        processedTxWitness
      );
    }
  );

  await mintTx.prove();
  await proveIfNeeded(mintTx, proofsEnabled);
  await mintTx.sign([operatorKey]).send();

  console.log('Mint successful!\n');
  console.log('Details:');
  console.log(`Recipient: ${recipientAddress}`);
  console.log(`Amount: ${amount} zkZEC`);
  console.log(`Zcash TX: ${zcashTxHash}`);
}

// Burning

/**
 * Burn zkZEC to unlock ZEC on Zcash
 */
export async function burnZkZEC(
  networkName: string,
  amount: string,
  zcashAddress: string,
  burnerKeyPath: string
) {
  console.log(`\n Burning zkZEC...\n`);

  // Load configuration
  const config = await loadConfig(networkName);
  if (config.network === 'local') {
    throw new Error(
      'Burning via CLI is disabled on the local mock network. Run `npm run interact` for local demonstrations.'
    );
  }

  if (!config.bridgeAddress) {
    throw new Error('Bridge not deployed');
  }

  // Setup network
  const { proofsEnabled } = await initNetwork(config);
  const burnerKey = await loadPrivateKey(burnerKeyPath);
  const burnerAccount = burnerKey.toPublicKey();

  // Validate Zcash address
  if (!BridgeHelper.isValidZcashAddress(zcashAddress)) {
    throw new Error('Invalid Zcash address');
  }

  // Load bridge
  const bridgeAddress = PublicKey.fromBase58(config.bridgeAddress);
  const bridge = new BridgeV3(bridgeAddress);

  // Burn
  console.log('Burning tokens...');
  const burnAmount = UInt64.from(amount);
  const zcashAddrField = Field(zcashAddress);

  const burnTx = await Mina.transaction(
    { sender: burnerAccount, fee: 0.03e9 },
    async () => {
      await bridge.burn(burnerAccount, burnAmount, zcashAddrField);
    }
  );

  await burnTx.prove();
  await proveIfNeeded(burnTx, proofsEnabled);
  await burnTx.sign([burnerKey]).send();

  console.log(' Burn successful!\n');
  console.log(' Details:');
  console.log(`  Amount: ${amount} zkZEC`);
  console.log(` Zcash Address: ${zcashAddress}`);
  console.log('\n Waiting for guardian confirmation...');
  console.log(`   Estimated time: ${BridgeHelper.estimateWithdrawalTime()} seconds`);
}

// Light Client Update 

/**
 * Update light client with latest Zcash blocks
 */
export async function updateLightClient(
  networkName: string,
  startHeight: number,
  endHeight: number
) {
  console.log(`\n Updating light client...\n`);

  // Load configuration
  const config = await loadConfig(networkName);
  if (config.network === 'local') {
    throw new Error(
      'Light client updates are disabled on the local mock network. Run `npm run interact` for local demonstrations.'
    );
  }

  if (!config.bridgeAddress) {
    throw new Error('Bridge not deployed');
  }

  // Setup network
  const { operatorKey, proofsEnabled } = await initNetwork(config);
  const operatorAccount = operatorKey.toPublicKey();

  // Fetch Zcash blocks
  console.log(`Fetching blocks ${startHeight} to ${endHeight}...`);
  const headers = await fetchZcashHeaders(
    config.zcashUrl,
    startHeight,
    endHeight
  );

  // Generate light client proof
  console.log('Generating light client proof...');
  const checkpoint = Checkpoint.MAINNET_CHECKPOINTS[0];
  const lcProof = await LightClientHelper.verifyFromCheckpoint(
    checkpoint,
    headers
  );

  // Update bridge
  console.log('Updating bridge state...');
  const bridgeAddress = PublicKey.fromBase58(config.bridgeAddress);
  const bridge = new BridgeV3(bridgeAddress);

  const updateTx = await Mina.transaction(
    { sender: operatorAccount, fee: 0.02e9 },
    async () => {
      await bridge.updateLightClient(lcProof);
    }
  );

  await updateTx.prove();
  await proveIfNeeded(updateTx, proofsEnabled);
  await updateTx.sign([operatorKey]).send();

  console.log(' Light client updated!\n');
  console.log(' Details:');
  console.log(` Latest height: ${endHeight}`);
  console.log(` Blocks verified: ${endHeight - startHeight + 1}`);
}


// Bridge Statistics Script


/**
 * Query bridge statistics
 */
export async function getBridgeStats(networkName: string) {
  console.log(`\n Bridge Statistics\n`);

  // Load configuration
  const config = await loadConfig(networkName);
  if (config.network === 'local') {
    throw new Error(
      'Statistics are unavailable on the local mock network beyond a single CLI session.'
    );
  }

  if (!config.bridgeAddress) {
    throw new Error('Bridge not deployed');
  }

  // Setup network
  await initNetwork(config);

  // Load bridge
  const bridgeAddress = PublicKey.fromBase58(config.bridgeAddress);
  const bridge = new BridgeV3(bridgeAddress);

  // Fetch state
  await fetchAccount({ publicKey: bridgeAddress });

  const totalMinted = bridge.totalMinted.get();
  const totalBurned = bridge.totalBurned.get();
  const zcashHeight = bridge.zcashBlockHeight.get();
  const isPaused = bridge.isPaused.get();

  console.log('Bridge Contract:');
  console.log(`   Address: ${bridgeAddress.toBase58()}`);
  console.log(`   Status: ${isPaused ? 'PAUSED' : 'ACTIVE'}`);
  console.log('\nToken Statistics:');
  console.log(`   Total Minted: ${totalMinted} zkZEC`);
  console.log(`   Total Burned: ${totalBurned} zkZEC`);
  console.log(`   Net Locked: ${totalMinted.sub(totalBurned)} ZEC`);
  console.log('\nLight Client:');
  console.log(`   Zcash Height: ${zcashHeight}`);
}


// Helper Functions


type PendingTx = Awaited<ReturnType<typeof Mina.transaction>>;

async function proveIfNeeded(tx: PendingTx, proofsEnabled: boolean) {
  if (proofsEnabled) {
    await tx.prove();
  }
}

async function loadPrivateKey(path: string): Promise<PrivateKey> {
  const keyData = await fs.readFile(path, 'utf-8');
  const keyJson = JSON.parse(keyData);
  return PrivateKey.fromBase58(keyJson.privateKey);
}

async function savePrivateKey(
  filePath: string,
  key: PrivateKey
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const keyJson = {
    privateKey: key.toBase58(),
    publicKey: key.toPublicKey().toBase58(),
  };
  await fs.writeFile(filePath, JSON.stringify(keyJson, null, 2));
}

async function fetchZcashTransaction(
  rpcUrl: string,
  txHash: string
): Promise<Uint8Array> {
  // In production: fetch from Zcash RPC
  // For PoC: return mock transaction
  return new Uint8Array(200);
}

async function fetchZcashHeaders(
  rpcUrl: string,
  startHeight: number,
  endHeight: number
): Promise<any[]> {
  // In production: fetch from Zcash RPC
  // For PoC: return mock headers
  const headers = [];
  for (let i = startHeight; i <= endHeight; i++) {
    headers.push(
      LightClientHelper.createMockHeader(
        i,
        Field(i - 1),
        Date.now() / 1000 + i * 75
      )
    );
  }
  return headers;
}

// command line interface

const commands = {
  deploy: deployContracts,
  mint: mintZkZEC,
  burn: burnZkZEC,
  update: updateLightClient,
  stats: getBridgeStats,
} as const;

// Parse command line arguments
const commandArg = process.argv[2];
const args = process.argv.slice(3);

if (!commandArg || !(commandArg in commands)) {
  console.log(`
Zcash-Mina Bridge CLI

Usage:
  npm run bridge <command> [args...]

Commands:
  deploy <network>                       Deploy contracts
  mint <network> <txHash> <recipient> <amount>   Mint zkZEC
  burn <network> <amount> <zcashAddr> <keyPath>  Burn zkZEC
  update <network> <start> <end>         Update light client
  stats <network>                        Show statistics

Examples:
  npm run bridge deploy devnet
  npm run bridge mint devnet abc123... B62... 1000000
  npm run bridge burn devnet 500000 zs1... keys/user.json
  npm run bridge update devnet 1000 1100
  npm run bridge stats devnet
  `);
  process.exit(1);
}

const command = commandArg as keyof typeof commands;
const handler = commands[command] as (...cmdArgs: string[]) => Promise<void>;

// Execute command
handler(...args)
  .then(() => {
    console.log('\n Command completed successfully!');
    process.exit(0);
  })
  .catch((error: unknown) => {
    if (error instanceof Error) {
      console.error('\n Error:', error.message);
    } else {
      console.error('\n Error:', error);
    }
    process.exit(1);
  });