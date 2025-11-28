/**
 * Zcash RPC Client
 * 
 * Connects to Zcash testnet to fetch real transaction and block data
 */

export interface ZcashRPCConfig {
    url: string;
    username?: string;
    password?: string;
}

export class ZcashRPC {
    private url: string;
    private auth?: string;

    constructor(config: ZcashRPCConfig) {
        this.url = config.url;
        if (config.username && config.password) {
            this.auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
        }
    }

    /**
     * Make RPC call to Zcash node
     */
    private async call(method: string, params: any[] = []): Promise<any> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.auth) {
            headers['Authorization'] = `Basic ${this.auth}`;
        }

        const response = await fetch(this.url, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params,
            }),
        });

        if (!response.ok) {
            throw new Error(`RPC call failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
            throw new Error(`RPC error: ${data.error.message}`);
        }

        return data.result;
    }

    /**
     * Get raw transaction hex
     */
    async getRawTransaction(txHash: string): Promise<string> {
        return await this.call('getrawtransaction', [txHash, 0]);
    }

    /**
     * Get transaction details
     */
    async getTransaction(txHash: string): Promise<any> {
        return await this.call('getrawtransaction', [txHash, 1]);
    }

    /**
     * Get block hash by height
     */
    async getBlockHash(height: number): Promise<string> {
        return await this.call('getblockhash', [height]);
    }

    /**
     * Get block header
     */
    async getBlockHeader(blockHash: string): Promise<any> {
        return await this.call('getblockheader', [blockHash]);
    }

    /**
     * Get block
     */
    async getBlock(blockHash: string): Promise<any> {
        return await this.call('getblock', [blockHash]);
    }

    /**
     * Get blockchain info
     */
    async getBlockchainInfo(): Promise<any> {
        return await this.call('getblockchaininfo', []);
    }
}

/**
 * Public Zcash testnet RPC endpoints
 */
export const ZCASH_TESTNET_RPCS = [
    'https://testnet.zcash.com',
    'https://zcash-testnet.drpc.org',
];

/**
 * Create a Zcash RPC client for testnet
 */
export function createTestnetClient(): ZcashRPC {
    return new ZcashRPC({
        url: process.env.ZCASH_RPC_URL || ZCASH_TESTNET_RPCS[0],
    });
}

export default {
    ZcashRPC,
    createTestnetClient,
    ZCASH_TESTNET_RPCS,
};
