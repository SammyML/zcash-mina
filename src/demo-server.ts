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

const ZEC_SCALE = 100_000_000;

type DemoAccount = {
  alias: string;
  key: PrivateKey;
  publicKey: PublicKey;
};

type DemoContext = {
  deployer: DemoAccount;
  operator: DemoAccount;
  users: DemoAccount[];
  tokenKey: PrivateKey;
  bridgeKey: PrivateKey;
  token: zkZECToken;
  bridge: BridgeV3;
  // Off-chain state storage
  nullifierMap: MerkleMap;
  processedTxMap: MerkleMap;
};

const PORT = Number(process.env.DEMO_PORT ?? 8787);
let contextPromise: Promise<DemoContext> | null = null;

async function bootstrapDemo(): Promise<DemoContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
    Mina.setActiveInstance(Local);

    const deployerKey = Local.testAccounts[0].key;
    const operatorKey = Local.testAccounts[1].key;
    const user1Key = Local.testAccounts[2].key;
    const user2Key = Local.testAccounts[3].key;

    const deployer: DemoAccount = {
      alias: 'deployer',
      key: deployerKey,
      publicKey: deployerKey.toPublicKey(),
    };
    const operator: DemoAccount = {
      alias: 'operator',
      key: operatorKey,
      publicKey: operatorKey.toPublicKey(),
    };
    const users: DemoAccount[] = [
      { alias: 'user1', key: user1Key, publicKey: user1Key.toPublicKey() },
      { alias: 'user2', key: user2Key, publicKey: user2Key.toPublicKey() },
    ];

    // Initialize Merkle Maps
    const nullifierMap = new MerkleMap();
    const processedTxMap = new MerkleMap();

    // Compile ZkPrograms first (dependencies for smart contracts)
    await ZcashVerifier.compile();
    await LightClient.compile();

    // Then compile smart contracts
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
        operator.publicKey,
        Field(0), // Genesis block hash
        UInt64.from(0), // Genesis height
        nullifierMap.getRoot(), // Initial nullifier root
        processedTxMap.getRoot() // Initial processed tx root
      );
    });
    await deployBridgeTx.prove();
    await deployBridgeTx.sign([deployer.key, bridgeKey]).send();

    // Approve bridge to mint tokens
    // In a real app, we would need to call token.approveAccount(bridge.address) or similar if permissions require it
    // But here permissions are set in deploy to allow proofs, and we are simulating

    const ctx: DemoContext = {
      deployer,
      operator,
      users,
      tokenKey,
      bridgeKey,
      token,
      bridge,
      nullifierMap,
      processedTxMap,
    };

    // Seed some initial balances
    await seedDemoBalances(ctx);
    return ctx;
  })();

  return contextPromise;
}

async function seedDemoBalances(ctx: DemoContext) {
  // Mint some initial tokens to users using the new verification flow
  // We'll just do one for user1
  const amount = 2.5;
  await handleMint(ctx, { recipient: 'user1', amount });
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
  if (normalized === 'operator') return ctx.operator;
  const user = ctx.users.find((candidate) => candidate.alias === normalized);
  if (user) return user;

  const match =
    [ctx.operator, ...ctx.users].find(
      (candidate) => candidate.publicKey.toBase58() === identifier
    ) ?? null;
  if (match) return match;

  throw new Error(`Unknown account identifier: ${identifier}`);
}

async function buildStatus(ctx: DemoContext) {
  // Fetch latest state
  await fetchAccount({ publicKey: ctx.bridge.address });

  // Note: totalMinted and totalBurned are no longer on-chain state to save space
  // In a real app, these would be indexed from events
  const totalMinted = "0";
  const totalBurned = "0";
  const isPaused = ctx.bridge.isPaused.get();
  const nullifierRoot = ctx.bridge.nullifierSetRoot.get();

  return {
    tokenAddress: ctx.token.address.toBase58(),
    bridgeAddress: ctx.bridge.address.toBase58(),
    totalMinted: totalMinted,
    totalBurned: totalBurned,
    netLocked: "0", // Simplified
    isPaused: isPaused.toBoolean(),
    nullifierRoot: nullifierRoot.toString(),
    accounts: [ctx.operator, ...ctx.users].map((account) => ({
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

  // 1. Generate Mock Zcash Proof
  // In a real app, this would come from the user's wallet
  const nullifier1 = Field.random();
  const nullifier2 = Field.random();

  const mockProof = ZcashProofHelper.createMockProof(
    nullifier1.toBigInt(),
    nullifier2.toBigInt(),
    amountUInt64.toBigInt()
  );

  const txHash = mockProof.hash();

  // 2. Generate Witnesses
  // Nullifier witnesses (proving they are NOT in the set yet)
  const nullifierWitness1 = ctx.nullifierMap.getWitness(nullifier1);
  const nullifierWitness2 = ctx.nullifierMap.getWitness(nullifier2);

  // Processed Tx witness (proving tx hash is NOT in the set yet)
  const processedTxWitness = ctx.processedTxMap.getWitness(txHash);

  // Mock Merkle Branch for block inclusion
  const merkleBranch = new MerkleBranch({
    path: Array(32).fill(Field(0)), // Dummy path of length 32
    index: UInt32.from(0),
    pathLength: UInt32.from(32),
  });

  // 3. Create Recursive Proof (Mocked)
  // We need a dummy proof for the ZkProgram
  const dummyProof = await ZcashVerifier.verifySingle(txHash, mockProof);

  // 4. Execute Transaction
  const tx = await Mina.transaction(ctx.operator.publicKey, async () => {
    await ctx.bridge.mintWithFullVerification(
      ctx.token.address, // Added
      ctx.operator.publicKey, // Added
      recipient.publicKey,
      // txHash removed
      // mockProof removed
      dummyProof,
      merkleBranch,
      nullifierWitness1,
      nullifierWitness2,
      processedTxWitness
    );
  });

  await tx.prove();
  await tx.sign([ctx.operator.key]).send();

  // 5. Update Off-chain State
  // If transaction succeeded, update our local Merkle Maps to match on-chain state
  ctx.nullifierMap.set(nullifier1, Field(1));
  ctx.nullifierMap.set(nullifier2, Field(1));
  ctx.processedTxMap.set(txHash, Field(1));
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
      ctx.token.address, // Added
      ctx.operator.publicKey, // Added
      burner.publicKey,
      amount,
      zcashField
    );
  });

  await tx.prove();
  await tx.sign([burner.key]).send();
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
      await handleMint(ctx, body);
      const status = await buildStatus(ctx);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/burn') {
      const body = await readJsonBody(req);
      await handleBurn(ctx, body);
      const status = await buildStatus(ctx);
      sendJson(res, 200, status);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/reset') {
      contextPromise = null;
      const fresh = await bootstrapDemo();
      const status = await buildStatus(fresh);
      sendJson(res, 200, status);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : 'Unknown server error',
    });
  }
});

server.listen(PORT, () => {
  console.log(`Demo server listening on http://localhost:${PORT}`);
});
