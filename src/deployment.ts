import {
    Mina, PrivateKey, PublicKey, AccountUpdate, UInt64,
    Field,
    MerkleMap,
} from 'o1js';
import { zkZECToken } from './bridge-contracts.js';
import { BridgeV3 } from './bridge.js';
import { LightClient } from './light-client.js';
import { ZcashVerifier } from './zcash-verifier.js';
import { OrchardVerifier } from './orchard-verifier.js';
import fs from 'fs/promises';
import path from 'path';

type NetworkConfig = {
    network: string;
    minaUrl: string;
    deployerKeyPath: string;
    operatorKeyPath: string;
    zcashSource: {
        type: string;
        url?: string;
        username?: string;
        password?: string;
    };
    tokenAddress?: string;
    bridgeAddress?: string;
};

async function loadConfig(network: string): Promise<NetworkConfig> {
    const configPath = path.join('config', `${network}.json`);
    const configData = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(configData) as NetworkConfig;
}

async function loadOrGenerateKey(keyPath: string): Promise<PrivateKey> {
    try {
        const keyData = await fs.readFile(keyPath, 'utf-8');
        const keyJson = JSON.parse(keyData);
        return PrivateKey.fromBase58(keyJson.privateKey);
    } catch {
        console.log(`Generating new key at ${keyPath}...`);
        const key = PrivateKey.random();
        const keyJson = {
            privateKey: key.toBase58(),
            publicKey: key.toPublicKey().toBase58(),
        };
        await fs.mkdir(path.dirname(keyPath), { recursive: true });
        await fs.writeFile(keyPath, JSON.stringify(keyJson, null, 2));
        console.log(`Generated key: ${keyJson.publicKey} `);
        return key;
    }
}

async function deployToNetwork(network: string) {
    console.log(`Deploying to ${network}...`);

    const config = await loadConfig(network);

    if (network === 'local') {
        const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
        Mina.setActiveInstance(Local);
        console.log('Using LocalBlockchain');
    } else {
        const Network = Mina.Network(config.minaUrl);
        Mina.setActiveInstance(Network);
        console.log(`Connected to ${config.minaUrl} `);
    }

    const deployerKey = await loadOrGenerateKey(config.deployerKeyPath);
    const operatorKey = await loadOrGenerateKey(config.operatorKeyPath);

    const deployer = deployerKey.toPublicKey();
    const operator = operatorKey.toPublicKey();

    console.log(`Deployer: ${deployer.toBase58()} `);
    console.log(`Operator: ${operator.toBase58()} `);

    console.log('Compiling contracts...');
    // Compile ZkPrograms first (they are dependencies for smart contracts)
    await ZcashVerifier.compile();
    console.log('ZcashVerifier compiled');
    await LightClient.compile();
    console.log('LightClient compiled');
    await OrchardVerifier.compile();
    console.log('OrchardVerifier compiled');

    // Then compile smart contracts
    await zkZECToken.compile();
    console.log('zkZECToken compiled');
    await BridgeV3.compile();
    console.log('BridgeV3 compiled');

    console.log('Compilation complete');

    const tokenKey = PrivateKey.random();
    const token = new zkZECToken(tokenKey.toPublicKey());

    console.log('Deploying zkZEC token...');
    const deployTokenTx = await Mina.transaction(deployer, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await token.deploy({});
    });
    await deployTokenTx.sign([deployerKey, tokenKey]).send();
    console.log(`Token deployed at: ${token.address.toBase58()} `);

    const bridgeKey = PrivateKey.random();
    const bridge = new BridgeV3(bridgeKey.toPublicKey());

    const genesisHash = Field(
        BigInt(
            '0x00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08'
        )
    );
    const genesisHeight = UInt64.from(0);

    console.log('Deploying Bridge contract...');
    const deployBridgeTx = await Mina.transaction(deployer, async () => {
        AccountUpdate.fundNewAccount(deployer);
        await bridge.deploy({});
        await bridge.initialize(
            token.address,
            operator,
            Field(0), // Genesis hash
            UInt64.from(0), // Genesis height
            new MerkleMap().getRoot(),
            new MerkleMap().getRoot(),
            new MerkleMap().getRoot() // Initial burn requests root
        );
    });
    await deployBridgeTx.sign([deployerKey, bridgeKey]).send();
    console.log(`Bridge deployed at: ${bridge.address.toBase58()} `);

    config.tokenAddress = token.address.toBase58();
    config.bridgeAddress = bridge.address.toBase58();

    const configPath = path.join('config', `${network}.json`);
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(`Configuration updated at ${configPath} `);

    console.log('\nDeployment Summary:');
    console.log(`Network: ${network} `);
    console.log(`Token Address: ${token.address.toBase58()} `);
    console.log(`Bridge Address: ${bridge.address.toBase58()} `);
    console.log(`Deployer: ${deployer.toBase58()} `);
    console.log(`Operator: ${operator.toBase58()} `);
}

const network = process.argv[2] || 'local';
deployToNetwork(network)
    .then(() => {
        console.log('\nDeployment successful!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\nDeployment failed:', error);
        process.exit(1);
    });