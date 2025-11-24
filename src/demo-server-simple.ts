import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import {
    AccountUpdate,
    Field,
    Mina,
    PrivateKey,
    PublicKey,
    UInt64,
    Signature,
} from 'o1js';

import { zkZECToken, Bridge } from './bridge-contracts.js';

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
    bridge: Bridge;
};

const PORT = Number(process.env.DEMO_PORT ?? 8787);
let contextPromise: Promise<DemoContext> | null = null;

async function bootstrapDemo(): Promise<DemoContext> {
    if (contextPromise) return contextPromise;

    contextPromise = (async () => {
        console.log('Initializing LocalBlockchain...');
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

        console.log('Compiling contracts...');
        await zkZECToken.compile();
        await Bridge.compile();
        console.log('Contracts compiled!');

        // Deploy token
        const tokenKey = PrivateKey.random();
        const token = new zkZECToken(tokenKey.toPublicKey());
        const deployTokenTx = await Mina.transaction(deployer.publicKey, async () => {
            AccountUpdate.fundNewAccount(deployer.publicKey);
            await token.deploy({});
        });
        await deployTokenTx.prove();
        await deployTokenTx.sign([deployer.key, tokenKey]).send();
        console.log('Token deployed!');

        // Deploy bridge
        const bridgeKey = PrivateKey.random();
        const bridge = new Bridge(bridgeKey.toPublicKey());
        const deployBridgeTx = await Mina.transaction(deployer.publicKey, async () => {
            AccountUpdate.fundNewAccount(deployer.publicKey);
            await bridge.deploy({});
            await bridge.initialize(tokenKey.toPublicKey(), operator.publicKey);
        });
        await deployBridgeTx.prove();
        await deployBridgeTx.sign([deployer.key, bridgeKey]).send();
        console.log('Bridge deployed!');

        const ctx: DemoContext = {
            deployer,
            operator,
            users,
            tokenKey,
            bridgeKey,
            token,
            bridge,
        };

        // Seed initial balance
        console.log('Seeding initial balances...');
        await seedDemoBalances(ctx);
        console.log('Demo ready!');

        return ctx;
    })();

    return contextPromise;
}

async function seedDemoBalances(ctx: DemoContext) {
    // Mint some initial tokens to user1
    const amount = UInt64.from(250000000); // 2.5 ZEC
    const mintSignature = Signature.create(
        ctx.operator.key,
        amount.toFields()
    );

    const mintTx = await Mina.transaction(ctx.operator.publicKey, async () => {
        // await ctx.bridge.mint(ctx.users[0].publicKey, amount, mintSignature);
        console.log("Minting disabled in simple demo due to Phase 2 upgrade");
    });
    await mintTx.prove();
    await mintTx.sign([ctx.operator.key]).send();
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
    const totalMinted = ctx.bridge.totalMinted.get();
    const totalBurned = ctx.bridge.totalBurned.get();
    const netLocked = totalMinted.sub(totalBurned);

    return {
        tokenAddress: ctx.token.address.toBase58(),
        bridgeAddress: ctx.bridge.address.toBase58(),
        totalMinted: totalMinted.toString(),
        totalBurned: totalBurned.toString(),
        netLocked: netLocked.toString(),
        isPaused: false,
        nullifierRoot: '0', // Phase 1 doesn't track nullifiers
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

    // Create operator signature
    const mintSignature = Signature.create(
        ctx.operator.key,
        amountUInt64.toFields()
    );

    // Execute mint transaction
    const tx = await Mina.transaction(ctx.operator.publicKey, async () => {
        // await ctx.bridge.mint(recipient.publicKey, amountUInt64, mintSignature);
        console.log("Minting disabled in simple demo due to Phase 2 upgrade");
    });

    await tx.prove();
    await tx.sign([ctx.operator.key]).send();
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

    // Create user signature
    const burnSignature = Signature.create(
        burner.key,
        [amount.value, zcashField]
    );

    // Execute burn transaction
    const tx = await Mina.transaction(burner.publicKey, async () => {
        await ctx.bridge.burn(burner.publicKey, amount, zcashField, burnSignature);
    });

    await tx.prove();
    await tx.sign([burner.key]).send();
}

function stringToField(input: string): Field {
    const chunks = input.split('').map((char) => Field(BigInt(char.charCodeAt(0))));
    if (chunks.length === 0) return Field(0);
    return chunks[0]; // Simplified for demo
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
