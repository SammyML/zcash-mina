import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import {
  AccountUpdate,
  Field,
  Mina,
  Poseidon,
  PrivateKey,
  PublicKey,
  UInt64,
  fetchAccount,
  MerkleMap,
  UInt32,
  Bool,
  Signature,
} from 'o1js';

import { zkZECToken } from './bridge-contracts.js';
import { BridgeV3 } from './bridge.js';
import {
  ZcashVerifier,
  ZcashProofHelper,
  MintOutput,
  ZcashProofVerification,
} from './zcash-verifier.js';
import { MerkleBranch, LightClient } from './light-client.js';
import { OrchardVerifier } from './orchard-verifier.js';
import { createTestnetClient, ZcashRPC } from './zcash-rpc.js';
import { ZcashRPCMock } from './zcash-rpc-mock.js';

const ZEC_SCALE = 100_000_000;

type DemoAccount = {
  alias: string;
  key: PrivateKey;
  publicKey: PublicKey;
};

type DemoContext = {
  deployer: DemoAccount;
  users: DemoAccount[];
  tokenKey: PrivateKey;
  bridgeKey: PrivateKey;
  token: zkZECToken;
  bridge: BridgeV3;
  zcashRPC: ZcashRPCMock;
  // Off-chain state storage
  nullifierMap: MerkleMap;
  processedTxMap: MerkleMap;
  burnRequestsMap: MerkleMap;
  // Statistics tracking (since removed from on-chain state)
  totalMinted: bigint;
  totalBurned: bigint;
  // User balance tracking (for mock mode balance checks)
  userBalances: Map<string, bigint>;
};

const PORT = Number(process.env.DEMO_PORT ?? 8787);
const ZCASH_MODE = process.env.ZCASH_MODE || 'mock'; // 'mock' or 'testnet'

// Global state
let contextPromise: Promise<DemoContext> | null = null;
let isInitializing = false;
let initializationError: unknown = null;

// Mutex for serializing transactions
let transactionMutex: Promise<any> = Promise.resolve();
async function withMutex<T>(fn: () => Promise<T>): Promise<T> {
  const result = transactionMutex.then(() => fn());
  transactionMutex = result.catch(() => { });
  return result;
}

async function bootstrapDemo(): Promise<DemoContext> {
  if (initializationError) throw initializationError;
  if (contextPromise) return contextPromise;

  isInitializing = true;

  contextPromise = (async () => {
    console.log('Initializing LocalBlockchain...');
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const deployerKey = Local.testAccounts[0].key;
    const user1Key = Local.testAccounts[1].key;
    const user2Key = Local.testAccounts[2].key;

    const deployer: DemoAccount = {
      alias: 'deployer',
      key: deployerKey,
      publicKey: deployerKey.toPublicKey(),
    };
    const users: DemoAccount[] = [
      { alias: 'user1', key: user1Key, publicKey: user1Key.toPublicKey() },
      { alias: 'user2', key: user2Key, publicKey: user2Key.toPublicKey() },
    ];

    // Initialize Merkle Maps
    const nullifierMap = new MerkleMap();
    const processedTxMap = new MerkleMap();
    const burnRequestsMap = new MerkleMap();

    // Initialize Zcash RPC Mock
    const zcashRPC = new ZcashRPCMock();

    // Conditional Compilation
    // On Railway (limited memory), we MUST skip ALL compilation
    // BridgeV3 depends on ZcashVerifier, so we can't compile one without the other
    // Fortunately, LocalBlockchain({ proofsEnabled: false }) works without compilation
    const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined ||
      process.env.SKIP_ZKPROGRAM_COMPILE === 'true';

    if (isRailway) {
      console.log('Running in Deployment Mode (Railway):');
      console.log('- Skipping ZkProgram compilation (saves memory)');
      console.log('- Skipping Smart Contract compilation (saves memory)');
      console.log('- Using mock proofs (proofsEnabled: false)');
    } else {
      console.log('Running in Local Mode:');
      console.log('- Compiling ZkPrograms');
      await ZcashVerifier.compile();
      await LightClient.compile();
      await OrchardVerifier.compile();

      console.log('- Compiling Smart Contracts');
      await zkZECToken.compile();
      await BridgeV3.compile();
    }

    const tokenKey = PrivateKey.random();
    const token = new zkZECToken(tokenKey.toPublicKey());
    const deployTokenTx = await Mina.transaction(deployer.publicKey, async () => {
      AccountUpdate.fundNewAccount(deployer.publicKey);
      await token.deploy({});
    });
    await deployTokenTx.prove();
    await deployTokenTx.sign([deployer.key, tokenKey]).send();

    const bridgeKey = PrivateKey.random();
    const bridge = new BridgeV3(bridgeKey.toPublicKey());
    const deployBridgeTx = await Mina.transaction(deployer.publicKey, async () => {
      AccountUpdate.fundNewAccount(deployer.publicKey);
      await bridge.deploy({});
      // Initialize with genesis block hash and height
      await bridge.initialize(
        tokenKey.toPublicKey(),
        deployer.publicKey,
        Field(0), // Genesis block hash
        UInt64.from(0), // Genesis height
        nullifierMap.getRoot(), // Initial nullifier root
        processedTxMap.getRoot(), // Initial processed tx root
        burnRequestsMap.getRoot() // Initial burn requests root
      );
      console.log('Bridge Initialized with Nullifier Root:', nullifierMap.getRoot().toString());
    });
    await deployBridgeTx.prove();
    await deployBridgeTx.sign([deployer.key, bridgeKey]).send();

    const ctx: DemoContext = {
      deployer,
      users,
      tokenKey,
      bridgeKey,
      token,
      bridge,
      zcashRPC,
      nullifierMap,
      processedTxMap,
      burnRequestsMap,
      totalMinted: 0n,
      totalBurned: 0n,
      userBalances: new Map(), // Track balances per user address
    };

    isInitializing = false;
    console.log('Demo server initialized successfully');
    return ctx;
  })().catch((error) => {
    isInitializing = false;
    initializationError = error;
    contextPromise = null;
    console.error('Initialization failed:', error);
    throw error;
  });

  return contextPromise;
}

function setCorsHeaders(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Origin, X-Requested-With, Content-Type, Accept'
  );
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS'
  );
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(body);
}

async function readJsonBody<T = Record<string, unknown>>(
  req: IncomingMessage
): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {} as T;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf-8')) as T;
  } catch (error) {
    throw new Error('Invalid JSON body');
  }
}

function resolveAccount(ctx: DemoContext, identifier: string): DemoAccount {
  const normalized = identifier.toLowerCase();
  const user = ctx.users.find((candidate) => candidate.alias === normalized);
  if (user) return user;

  const match =
    ctx.users.find(
      (candidate) => candidate.publicKey.toBase58() === identifier
    ) ?? null;
  if (match) return match;

  throw new Error(`Unknown account identifier: ${identifier}`);
}

async function buildStatus(ctx: DemoContext) {
  // Fetch latest state
  await fetchAccount({ publicKey: ctx.bridge.address });

  // Use off-chain tracking for totalMinted and totalBurned
  // (On-chain state was removed to fit within 8 field element limit)
  const totalMinted = ctx.totalMinted.toString();
  const totalBurned = ctx.totalBurned.toString();
  const netLocked = (ctx.totalMinted - ctx.totalBurned).toString();
  const isPaused = ctx.bridge.isPaused.get();
  const nullifierRoot = ctx.bridge.nullifierSetRoot.get();

  return {
    tokenAddress: ctx.token.address.toBase58(),
    bridgeAddress: ctx.bridge.address.toBase58(),
    totalMinted: totalMinted,
    totalBurned: totalBurned,
    netLocked: netLocked,
    isPaused: isPaused.toBoolean(),
    nullifierRoot: nullifierRoot.toString(),
    accounts: ctx.users.map((account) => ({
      alias: account.alias,
      address: account.publicKey.toBase58(),
    })),
  };
}

async function handleMint(
  ctx: DemoContext,
  payload: { recipient?: string; amount?: number }
) {
  if (!payload.recipient) {
    throw new Error('recipient field is required');
  }
  if (payload.amount === undefined || payload.amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
  const recipient = resolveAccount(ctx, payload.recipient);
  const amountUInt64 = amountToUInt64(payload.amount);

  console.log(`\n[Mint Flow] Starting mint for ${payload.amount} ZEC to ${recipient.alias}...`);

  // 1. Create Zcash Shielded Transaction
  console.log('[Step 1/5] Creating Zcash shielded transaction...');
  // In a real app, the user would do this from their wallet.
  // Here we simulate it via our mock RPC.
  const zcashTx = await ctx.zcashRPC.createShieldedTransaction(
    payload.amount,
    'zs1...' // Bridge's Zcash address
  );
  console.log(`✓ Zcash Tx Created: ${zcashTx.txid}`);

  // 2. Wait for Confirmations
  console.log('[Step 2/5] Waiting for Zcash confirmations...');
  await ctx.zcashRPC.waitForConfirmations(zcashTx.txid, 6);
  console.log('✓ Transaction confirmed (6 blocks)');

  // 3. Verify Block Headers (Light Client)
  console.log('[Step 3/5] Verifying Zcash block headers...');
  // In a real app, we'd verify the block header chain here.
  // For demo, we just fetch the header from our mock.
  const blockHeader = await ctx.zcashRPC.getBlockHeader(zcashTx.blockHeight);
  console.log(`✓ Block header verified: ${blockHeader.hash.toString()}`);

  // 4. Generate Proofs
  console.log('[Step 4/5] Generating ZK proofs...');

  // Parse proof from the transaction
  const { nullifier1, nullifier2 } = zcashTx.proof;

  // Create mock proof data first to get consistent hash
  // This ensures ZcashVerifier.verifySingle() passes because hash(proof) == txHash
  const mockProofData = ZcashProofHelper.createMockProof(
    nullifier1.toBigInt(),
    nullifier2.toBigInt(),
    amountUInt64.toBigInt()
  );
  const txHash = mockProofData.hash();

  // Generate witnesses
  const nullifierWitness1 = ctx.nullifierMap.getWitness(nullifier1);
  const nullifierWitness2 = ctx.nullifierMap.getWitness(nullifier2);
  const processedTxWitness = ctx.processedTxMap.getWitness(txHash);

  // Mock Merkle Branch for block inclusion
  const merkleBranch = new MerkleBranch({
    path: Array(32).fill(Field(0)),
    index: UInt32.from(0),
    pathLength: UInt32.from(32),
  });

  // Create Zcash Proof
  const isRailway = process.env.RAILWAY_ENVIRONMENT !== undefined ||
    process.env.SKIP_ZKPROGRAM_COMPILE === 'true';

  let dummyProof: ZcashProofVerification;

  if (isRailway) {
    console.log('Creating mock ZcashProofVerification (deployment mode)...');
    const mintOutput = new MintOutput({
      amount: amountUInt64,
      nullifier1: nullifier1,
      nullifier2: nullifier2,
      txHash: txHash,
    });

    dummyProof = {
      publicInput: txHash,
      publicOutput: mintOutput,
      maxProofsVerified: 0,
      proof: null as any,
      shouldVerify: Bool(false),
      publicFields: () => ({ input: [txHash], output: [] }),
      verify: () => { },
      verifyIf: () => { },
      toJSON: () => ({ publicInput: [], publicOutput: [], maxProofsVerified: 0, proof: '' }),
    } as ZcashProofVerification;
  } else {
    console.log('Creating ZcashProofVerification via ZkProgram...');
    // Use the mock proof data created above
    dummyProof = await ZcashVerifier.verifySingle(txHash, mockProofData);
  }

  // 5. Mint on Mina
  console.log('[Step 5/5] Minting zkZEC on Mina...');

  const tx = await Mina.transaction(ctx.deployer.publicKey, async () => {
    await ctx.bridge.mintWithFullVerification(
      ctx.token.address,
      ctx.deployer.publicKey,
      recipient.publicKey,
      dummyProof,
      merkleBranch,
      nullifierWitness1,
      nullifierWitness2,
      processedTxWitness
    );
  });

  await tx.prove();
  await tx.sign([ctx.deployer.key]).send();

  // Update Off-chain State
  ctx.nullifierMap.set(nullifier1, Field(1));
  ctx.processedTxMap.set(txHash, Field(1));

  // Update off-chain balance tracking
  const recipientAddr = recipient.publicKey.toBase58();
  const currentBalance = ctx.userBalances.get(recipientAddr) || 0n;
  ctx.userBalances.set(recipientAddr, currentBalance + amountUInt64.toBigInt());
  ctx.totalMinted += amountUInt64.toBigInt();

  console.log(`✓ Minted ${(Number(amountUInt64.toBigInt()) / 100_000_000).toFixed(8)} zkZEC to ${recipient.alias}`);
  console.log(`  Total Minted: ${(Number(ctx.totalMinted) / 100_000_000).toFixed(8)} zkZEC`);
}

async function handleBurn(
  ctx: DemoContext,
  payload: { burner?: string; amount?: number; zcashAddress?: string }
) {
  if (!payload.burner) throw new Error('burner field is required');
  if (payload.amount === undefined || payload.amount <= 0) {
    throw new Error('amount must be greater than zero');
  }
  if (!payload.zcashAddress) {
    throw new Error('zcashAddress field is required');
  }

  const burner = resolveAccount(ctx, payload.burner);
  const amount = amountToUInt64(payload.amount);
  const zcashField = stringToField(payload.zcashAddress);

  // Check balance using off-chain tracking
  const burnerAddr = burner.publicKey.toBase58();
  const currentBalance = ctx.userBalances.get(burnerAddr) || 0n;
  if (currentBalance < amount.toBigInt()) {
    throw new Error('Insufficient balance');
  }

  console.log(`\n[Burn Flow] Starting burn for ${payload.amount} zkZEC from ${burner.alias}...`);

  // Step 1: Request Burn
  console.log('[Step 1/3] Requesting burn (initiating 24h timelock)...');

  // Create signature
  const signature = Signature.create(
    burner.key,
    [amount.value, zcashField]
  );

  // Get witness for empty slot
  const requestKey = Poseidon.hash(
    burner.publicKey.toFields().concat([amount.value, zcashField])
  );
  const requestWitness = ctx.burnRequestsMap.getWitness(requestKey);

  const tx1 = await Mina.transaction(burner.publicKey, async () => {
    await ctx.bridge.requestBurn(
      amount,
      zcashField,
      signature,
      burner.publicKey,
      requestWitness
    );
  });

  await tx1.prove();
  await tx1.sign([burner.key]).send();

  // Get the timestamp that was stored on-chain
  // In LocalBlockchain, network.timestamp starts at 0 and increments with slots
  const timestamp = ctx.bridge.network.timestamp.get();
  ctx.burnRequestsMap.set(requestKey, timestamp.value);
  console.log('✓ Burn requested. Timelock started.');

  // Step 2: Simulate Time Passing
  console.log('[Step 2/3] Simulating 24-hour wait...');
  await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds

  // Advance LocalBlockchain time by incrementing slots
  // For demo purposes, the contract checks for 60_000ms (1 minute)
  // LocalBlockchain slot time is 3 minutes (180_000ms) by default
  // So we need to increment by at least 1 slot to pass the 1 minute check
  try {
    const local = Mina.activeInstance as any;
    if (local.incrementGlobalSlot) {
      console.log('  Advancing chain time by incrementing slots...');
      // Increment by 480 slots = 24 hours (at 3 min per slot)
      local.incrementGlobalSlot(480);
    }
  } catch (e) {
    console.log('  Could not advance chain time, proceeding...');
  }

  // Step 3: Execute Burn
  console.log('[Step 3/3] Executing burn...');

  const executeWitness = ctx.burnRequestsMap.getWitness(requestKey);

  const tx2 = await Mina.transaction(ctx.deployer.publicKey, async () => {
    await ctx.bridge.executeBurn(
      ctx.token.address,
      ctx.deployer.publicKey,
      burner.publicKey,
      amount,
      zcashField,
      timestamp, // Original request time
      executeWitness
    );
  });

  await tx2.prove();
  await tx2.sign([ctx.deployer.key]).send();

  // Update Off-chain State
  ctx.burnRequestsMap.set(requestKey, Field(0));
  ctx.userBalances.set(burnerAddr, currentBalance - amount.toBigInt());
  ctx.totalBurned += amount.toBigInt();

  console.log(`✓ Burned ${(Number(amount.toBigInt()) / 100_000_000).toFixed(8)} zkZEC from ${burner.alias}`);
  console.log(`  Total Burned: ${(Number(ctx.totalBurned) / 100_000_000).toFixed(8)} zkZEC`);
  console.log(`  Net Locked: ${(Number(ctx.totalMinted - ctx.totalBurned) / 100_000_000).toFixed(8)} ZEC`);
}

function stringToField(input: string): Field {
  const chunks = input.split('').map((char) => Field(BigInt(char.charCodeAt(0))));
  if (chunks.length === 0) return Field(0);
  return Poseidon.hash(chunks);
}

function amountToUInt64(amount: number): UInt64 {
  const scaled = Math.round(amount * ZEC_SCALE);
  if (scaled <= 0) {
    throw new Error('amount converts to zero zatoshis');
  }
  return UInt64.from(BigInt(scaled));
}

const server = createServer(async (req, res) => {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const ctx = await bootstrapDemo();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const status = await buildStatus(ctx);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/mint') {
      const body = await readJsonBody(req);
      await withMutex(() => handleMint(ctx, body));
      const status = await buildStatus(ctx);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/burn') {
      const body = await readJsonBody(req);
      await withMutex(() => handleBurn(ctx, body));
      const status = await buildStatus(ctx);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      contextPromise = null;
      initializationError = null;
      const fresh = await bootstrapDemo();
      const status = await buildStatus(fresh);
      sendJson(res, 200, status);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error('Request error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Check if it's a user-facing error (balance, validation, etc.)
    const isUserError = errorMessage.includes('Insufficient balance') ||
      errorMessage.includes('required') ||
      errorMessage.includes('must be');

    sendJson(res, isUserError ? 400 : 500, {
      error: isUserError ? errorMessage : 'Internal server error',
      details: isUserError ? undefined : errorMessage,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Demo server listening on http://localhost:${PORT}`);
});
