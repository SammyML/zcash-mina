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
} from 'o1js';

import { zkZECToken } from './bridge-contracts.js';
import { BridgeV3 } from './bridge.js';
import {
  ZcashVerifier,
  ZcashProofHelper,
} from './zcash-verifier.js';
import { MerkleBranch, LightClient } from './light-client.js';
import { createTestnetClient, ZcashRPC } from './zcash-rpc.js';

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
  // Off-chain state storage
  nullifierMap: MerkleMap;
  processedTxMap: MerkleMap;
  // Statistics tracking (since removed from on-chain state)
  totalMinted: bigint;
  totalBurned: bigint;
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

    // Conditional ZkProgram compilation
    // Skip on Railway (limited memory) but compile locally
    const skipCompilation = process.env.RAILWAY_ENVIRONMENT !== undefined ||
      process.env.SKIP_ZKPROGRAM_COMPILE === 'true';

    if (skipCompilation) {
      console.log('Skipping ZkProgram compilation (deployment environment)...');
    } else {
      console.log('Compiling ZkPrograms...');
      await ZcashVerifier.compile();
      await LightClient.compile();
    }

    // Then compile smart contracts
    console.log('Compiling smart contracts...');
    await zkZECToken.compile();
    await BridgeV3.compile();

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
        processedTxMap.getRoot() // Initial processed tx root
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
      nullifierMap,
      processedTxMap,
      totalMinted: 0n,
      totalBurned: 0n,
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

  // Note: totalMinted and totalBurned are no longer on-chain state to save space
  // We track them in the DemoContext for display purposes
  // We track them in the DemoContext for display purposes
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

  // 1. Generate or Fetch Zcash Proof
  let mockProof;
  let nullifier1: Field;
  let nullifier2: Field;
  let txHash: Field;

  if (ZCASH_MODE === 'testnet') {
    // Testnet Mode: Fetch real Zcash transaction
    console.log('Testnet Mode: Fetching real Zcash transaction...');

    // For demo purposes, we'll use a known testnet transaction
    // In production, the user would provide their own tx hash
    const testnetTxHash = process.env.ZCASH_TESTNET_TX ||
      '5c3d6fd7d207e3e3c7c8e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a0f9e8d7c6b5';

    try {
      const rpcClient = createTestnetClient();
      const rawTx = await rpcClient.getRawTransaction(testnetTxHash);
      const txBytes = Buffer.from(rawTx, 'hex');

      console.log(`Fetched transaction: ${testnetTxHash.substring(0, 16)}...`);
      console.log(`Transaction size: ${txBytes.length} bytes`);

      // Parse the transaction bytes
      mockProof = ZcashProofHelper.parseTransaction(txBytes);

      // Extract nullifiers from parsed proof
      nullifier1 = mockProof.nullifier1.value;
      nullifier2 = mockProof.nullifier2.value;
      txHash = mockProof.hash();

      console.log('Successfully parsed testnet transaction');
    } catch (error) {
      console.error('Failed to fetch testnet transaction:', error);
      console.log('Falling back to mock mode...');

      // Fallback to mock if testnet fetch fails
      nullifier1 = Field.random();
      nullifier2 = Field.random();
      mockProof = ZcashProofHelper.createMockProof(
        nullifier1.toBigInt(),
        nullifier2.toBigInt(),
        amountUInt64.toBigInt()
      );
      txHash = mockProof.hash();
    }
  } else {
    // Mock Mode: Generate mock proof (default)
    console.log('Mock Mode: Generating mock Zcash proof...');
    nullifier1 = Field.random();
    nullifier2 = Field.random();

    mockProof = ZcashProofHelper.createMockProof(
      nullifier1.toBigInt(),
      nullifier2.toBigInt(),
      amountUInt64.toBigInt()
    );

    txHash = mockProof.hash();
  }

  // 2. Generate Witnesses from current maps
  // These maps should already be in sync with on-chain state
  const nullifierWitness1 = ctx.nullifierMap.getWitness(nullifier1);
  const nullifierWitness2 = ctx.nullifierMap.getWitness(nullifier2);

  // Sync Check: Ensure off-chain state matches on-chain state
  try {
    const onChainRoot = ctx.bridge.nullifierSetRoot.get();
    const offChainRoot = ctx.nullifierMap.getRoot();

    console.log('Sync Check:');
    console.log('- On-chain Root:', onChainRoot.toString());
    console.log('- Off-chain Root:', offChainRoot.toString());

    if (!onChainRoot.equals(offChainRoot).toBoolean()) {
      console.error('CRITICAL: State mismatch detected!');
      throw new Error(`State mismatch: Off-chain root (${offChainRoot.toString()}) does not match on-chain root (${onChainRoot.toString()})`);
    }
  } catch (e) {
    console.error('Failed to verify state sync:', e);
    // We might continue if it's just a fetch error, but for demo safety let's throw
    throw e;
  }

  // Debug logging
  const [computedRoot1] = nullifierWitness1.computeRootAndKey(Field(0));
  console.log('Mint: Computed Root from Witness 1:', computedRoot1.toString());
  console.log('Mint: Current Map Root:', ctx.nullifierMap.getRoot().toString());

  const processedTxWitness = ctx.processedTxMap.getWitness(txHash);

  // Mock Merkle Branch for block inclusion
  const merkleBranch = new MerkleBranch({
    path: Array(32).fill(Field(0)), // Dummy path of length 32
    index: UInt32.from(0),
    pathLength: UInt32.from(32),
  });

  // 3. Create Recursive Proof (Mocked)
  const dummyProof = await ZcashVerifier.verifySingle(txHash, mockProof);

  // 4. Execute Transaction
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

  // 5. Update Off-chain State
  // IMPORTANT: Only update the first nullifier to match the on-chain contract logic.
  // The contract only updates the root with nullifier1 due to the complexity of
  // chaining multiple Merkle updates in a single transaction.
  // In production, you'd need to either:
  // 1. Handle both nullifiers properly with sequential witnesses, or
  // 2. Use a different approach like batching nullifiers
  ctx.nullifierMap.set(nullifier1, Field(1));
  // ctx.nullifierMap.set(nullifier2, Field(1)); // Commented out to match on-chain logic
  ctx.processedTxMap.set(txHash, Field(1));

  // Update statistics
  ctx.totalMinted += amountUInt64.toBigInt();

  console.log('Mint: Updated Map Root:', ctx.nullifierMap.getRoot().toString());
  console.log('Mint: Total Minted:', (Number(ctx.totalMinted) / 100_000_000).toFixed(8), 'ZEC');
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

  // Burn doesn't require complex proofs in this direction for the user
  // (User just burns tokens to request withdrawal)

  const tx = await Mina.transaction(burner.publicKey, async () => {
    await ctx.bridge.burn(
      ctx.token.address,
      ctx.deployer.publicKey,
      burner.publicKey,
      amount,
      zcashField
    );
  });

  await tx.prove();
  await tx.sign([burner.key]).send();

  // Update statistics
  ctx.totalBurned += amount.toBigInt();

  console.log('Burn: Total Burned:', (Number(ctx.totalBurned) / 100_000_000).toFixed(8), 'ZEC');
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
    sendJson(res, 500, {
      error: 'Internal server error',
      message: errorMessage,
    });
  }
});

server.listen(PORT, () => {
  console.log(`Demo server listening on http://localhost:${PORT}`);
});
