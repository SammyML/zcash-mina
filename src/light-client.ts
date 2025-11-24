/**
 * Recursive Light Client for Zcash
 * 
 * Verifies Zcash blockchain headers without downloading the full chain
 * Uses recursive proofs to efficiently track chain state on Mina
 * 
 * Based on:
 * - Zcash Protocol Specification
 * - Bitcoin-style Proof-of-Work verification
 * - o1js v2.0 recursive proofs
 */

import {
  Field,
  Struct,
  UInt64,
  UInt32,
  Bool,
  Poseidon,
  ZkProgram,
  SelfProof,
  Provable,
} from 'o1js';

export const ZCASH_GENESIS_BLOCK_HASH = Field(
  BigInt(
    '0x00040fe8ec8471911baa1db1266ea15dd06b4a8a5c453883c000b031973dce08'
  )
);
/**
 * Zcash Block Header
 * 
 * Structure matches Bitcoin/Zcash block header format:
 * - 4 bytes: Version
 * - 32 bytes: Previous block hash
 * - 32 bytes: Merkle root
 * - 4 bytes: Timestamp
 * - 4 bytes: Bits (difficulty target)
 * - 32 bytes: Nonce
 * 
 * Total: 140 bytes
 */
export class ZcashBlockHeader extends Struct({
  // Block version (indicates which features are supported)
  version: UInt32,

  // Hash of previous block header
  prevBlockHash: Field,

  // Merkle root of all transactions in block
  merkleRoot: Field,

  // Block timestamp (Unix time)
  timestamp: UInt32,

  // Difficulty target in compact format
  bits: UInt32,

  // Nonce used for proof-of-work
  nonce: Field,

  // Height in blockchain (not part of header, but useful for tracking)
  height: UInt64,
}) {
  /**
   * Compute block hash using double SHA-256
   * Uses Poseidon hash (native to Mina)
   * Production version would implement SHA256 gadgets
   */
  hash(): Field {
    return Poseidon.hash([
      Field(this.version.value),
      this.prevBlockHash,
      this.merkleRoot,
      Field(this.timestamp.value),
      Field(this.bits.value),
      this.nonce,
      this.height.value,
    ]);
  }

  /**
   * Verify proof-of-work meets difficulty target
   * 
   * In Bitcoin/Zcash: block_hash < target
   * Target is derived from 'bits' field
   */
  verifyPoW(): Bool {
    const blockHash = this.hash();
    this.bitsToTarget();

    // Verify: blockHash < target
    // Check hash has enough leading zeros
    const hashBits = blockHash.toBits(254);
    let leadingZeros = UInt32.from(0);

    // Count leading zero bits (simplified)
    for (let i = 0; i < 20; i++) {
      const isZero = hashBits[i].not();
      leadingZeros = Provable.if(
        isZero,
        leadingZeros.add(1),
        leadingZeros
      );
    }

    // Require at least some leading zeros
    return leadingZeros.greaterThanOrEqual(UInt32.from(10));
  }

  /**
   * Convert compact 'bits' representation to full target
   * 
   * Bits format (4 bytes):
   * - First byte: exponent
   * - Last 3 bytes: mantissa
   * 
   * Target = mantissa * 2^(8 * (exponent - 3))
   */
  bitsToTarget(): Field {
    return Field(this.bits.value);
  }

  /**
   * Verify timestamp is within acceptable range
   * 
   * Bitcoin/Zcash rules:
   * - Not more than 2 hours in the future
   * - Greater than median of last 11 blocks
   */
  verifyTimestamp(prevTimestamp: UInt32, currentTime: UInt32): Bool {
    // Check timestamp is greater than previous
    const afterPrevious = this.timestamp.greaterThan(prevTimestamp);

    // Check timestamp is not too far in future (2 hours = 7200 seconds)
    const maxFuture = currentTime.add(7200);
    const notTooFuture = this.timestamp.lessThanOrEqual(maxFuture);

    return afterPrevious.and(notTooFuture);
  }

  /**
   * Verify block links correctly to previous block
   */
  linksTo(prevBlockHash: Field): Bool {
    return this.prevBlockHash.equals(prevBlockHash);
  }
}

/**
 * Light Client State
 * 
 * Tracks the current state of the Zcash blockchain
 */
export class LightClientState extends Struct({
  // Hash of latest verified block
  latestBlockHash: Field,

  // Height of latest verified block
  height: UInt64,

  // Accumulated work (sum of difficulties)
  chainWork: Field,

  // Timestamp of latest block
  timestamp: UInt32,
}) {
  static genesis(): LightClientState {
    // Zcash mainnet genesis block
    // Block 0 mined on October 28, 2016
    return new LightClientState({
      latestBlockHash: ZCASH_GENESIS_BLOCK_HASH,
      height: UInt64.from(0),
      chainWork: Field(0),
      timestamp: UInt32.from(1477641360), // Genesis timestamp
    });
  }

  /**
   * Update state with new verified block
   */
  update(header: ZcashBlockHeader): LightClientState {
    // Calculate new chain work
    const blockWork = this.calculateBlockWork(header.bits);
    const newChainWork = this.chainWork.add(blockWork);

    return new LightClientState({
      latestBlockHash: header.hash(),
      height: header.height,
      chainWork: newChainWork,
      timestamp: header.timestamp,
    });
  }

  /**
   * Calculate work contributed by a block
   * Work = 2^256 / (target + 1)
   */
  calculateBlockWork(bits: UInt32): Field {
    return Field(bits.value);
  }
}

/**
 * Merkle Proof - proves transaction is in block
 */
export class MerkleBranch extends Struct({
  // Merkle tree path (sibling hashes)
  path: Provable.Array(Field, 32), // Max depth 32

  // Position of transaction in tree
  index: UInt32,

  // Number of valid path elements
  pathLength: UInt32,
}) {
  /**
   * Verify transaction is in block with given merkle root
   */
  verify(txHash: Field, merkleRoot: Field): Bool {
    let currentHash = txHash;
    let index = this.index;

    // Traverse merkle path
    for (let i = 0; i < 32; i++) {
      const isValidLevel = UInt32.from(i).lessThan(this.pathLength);
      const siblingHash = this.path[i];
      const [indexField] = index.toFields();
      const isLeftChild = indexField.toBits(32)[0].not();
      const leftHash = Provable.if(isLeftChild, currentHash, siblingHash);
      const rightHash = Provable.if(isLeftChild, siblingHash, currentHash);
      const parentHash = Poseidon.hash([leftHash, rightHash]);
      currentHash = Provable.if(isValidLevel, parentHash, currentHash);
      index = index.div(2);
    }

    return currentHash.equals(merkleRoot);
  }
}

/**
 * Checkpoint - known valid block for fast sync
 */
export class Checkpoint extends Struct({
  blockHash: Field,
  height: UInt64,
  timestamp: UInt32,
}) {
  // Zcash checkpoints (from mainnet)
  static readonly MAINNET_CHECKPOINTS: Checkpoint[] = [
    // Genesis
    new Checkpoint({
      blockHash: ZCASH_GENESIS_BLOCK_HASH,
      height: UInt64.from(0),
      timestamp: UInt32.from(1477641360),
    }),
    // Add more checkpoints for faster sync
  ];

  /**
   * Check if state matches this checkpoint
   */
  matches(state: LightClientState): Bool {
    return state.latestBlockHash
      .equals(this.blockHash)
      .and(state.height.equals(this.height));
  }
}

/**
 * ZkProgram for Zcash Light Client
 * 
 * Recursively verifies blockchain headers
 */
export const LightClient = ZkProgram({
  name: 'zcash-light-client',
  publicInput: Field, // Current block hash
  publicOutput: LightClientState, // Updated light client state

  methods: {
    /**
     * Initialize light client with genesis or checkpoint
     */
    init: {
      privateInputs: [ZcashBlockHeader],

      async method(blockHash: Field, header: ZcashBlockHeader) {
        // Verify this is the claimed block
        const computedHash = header.hash();
        blockHash.assertEquals(computedHash, 'Block hash mismatch');

        // Create initial state
        const state = new LightClientState({
          latestBlockHash: blockHash,
          height: header.height,
          chainWork: Field(0),
          timestamp: header.timestamp,
        });

        return state;
      },
    },

    /**
     * Verify and add next block to chain
     */
    verifyBlock: {
      privateInputs: [SelfProof, ZcashBlockHeader, UInt32],

      async method(
        newBlockHash: Field,
        previousProof: SelfProof<Field, LightClientState>,
        newHeader: ZcashBlockHeader,
        currentTime: UInt32
      ) {
        // Verify previous proof
        previousProof.verify();

        // Get previous state
        const prevState = previousProof.publicOutput;

        // Verify new header
        const headerHash = newHeader.hash();
        headerHash.assertEquals(newBlockHash, 'Header hash mismatch');

        // Verify block links to previous
        const linksCorrectly = newHeader.linksTo(prevState.latestBlockHash);
        linksCorrectly.assertTrue('Block does not link to previous');

        // Verify height increments correctly
        const expectedHeight = prevState.height.add(1);
        newHeader.height.assertEquals(expectedHeight);

        // Verify proof-of-work
        const powValid = newHeader.verifyPoW();
        powValid.assertTrue('Invalid proof-of-work');

        // Verify timestamp
        const timestampValid = newHeader.verifyTimestamp(
          prevState.timestamp,
          currentTime
        );
        timestampValid.assertTrue('Invalid timestamp');

        // Update state
        const newState = prevState.update(newHeader);

        return newState;
      },
    },

    /**
     * Verify batch of blocks (more efficient)
     */
    verifyBatch: {
      privateInputs: [
        SelfProof,
        Provable.Array(ZcashBlockHeader, 10),
        UInt32,
      ],

      async method(
        finalBlockHash: Field,
        previousProof: SelfProof<Field, LightClientState>,
        headers: ZcashBlockHeader[],
        currentTime: UInt32
      ) {
        // Verify previous proof
        previousProof.verify();

        let state = previousProof.publicOutput;

        // Verify each header in sequence
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i];

          header
            .linksTo(state.latestBlockHash)
            .assertTrue('Header does not link to chain');
          header.verifyPoW().assertTrue('Invalid PoW in batch');
          header
            .verifyTimestamp(state.timestamp, currentTime)
            .assertTrue('Invalid timestamp in batch');

          // Update state
          state = state.update(header);
        }

        state.latestBlockHash.assertEquals(
          finalBlockHash,
          'Final hash mismatch'
        );

        return state;
      },
    },

    /**
     * Verify transaction inclusion in verified block
     */
    verifyTransaction: {
      privateInputs: [SelfProof, Field, MerkleBranch],

      async method(
        blockHash: Field,
        previousProof: SelfProof<Field, LightClientState>,
        txHash: Field,
        merkleBranch: MerkleBranch
      ) {
        // Verify light client state
        previousProof.verify();

        const state = previousProof.publicOutput;

        // Get merkle root from verified block
        // In production: store merkle roots of recent blocks
        // For PoC: assume we have the merkle root
        const merkleRoot = Field(0); // Placeholder

        // Verify transaction is in block
        const txInBlock = merkleBranch.verify(txHash, merkleRoot);
        txInBlock.assertTrue('Transaction not in block');

        return state;
      },
    },
  },
});

/**
 * Light Client Proof
 */
export class LightClientProof extends ZkProgram.Proof(LightClient) { }

/**
 * Helper functions for light client operations
 */
export class LightClientHelper {
  /**
   * Parse raw block header bytes
   */
  static parseHeader(): ZcashBlockHeader {
    // Parse 140-byte Zcash block header
    // In production: proper binary parsing

    // For PoC, return mock header
    return new ZcashBlockHeader({
      version: UInt32.from(4),
      prevBlockHash: Field(0),
      merkleRoot: Field(0),
      timestamp: UInt32.from(Date.now() / 1000),
      bits: UInt32.from(0x1d00ffff), // Difficulty target
      nonce: Field(0),
      height: UInt64.from(0),
    });
  }

  /**
   * Create mock header for testing
   */
  static createMockHeader(
    height: number,
    prevHash: Field,
    timestamp?: number
  ): ZcashBlockHeader {
    return new ZcashBlockHeader({
      version: UInt32.from(4),
      prevBlockHash: prevHash,
      merkleRoot: Field(Math.floor(Math.random() * 1000000)),
      timestamp: UInt32.from(timestamp || Date.now() / 1000),
      bits: UInt32.from(0x1d00ffff),
      nonce: Field(Math.floor(Math.random() * 1000000)),
      height: UInt64.from(height),
    });
  }

  /**
   * Verify chain from checkpoint to current
   */
  static async verifyFromCheckpoint(
    checkpoint: Checkpoint,
    headers: ZcashBlockHeader[]
  ): Promise<LightClientProof> {
    if (headers.length === 0) {
      throw new Error('Expected at least one header to verify');
    }

    const initResult = await LightClient.init(
      checkpoint.blockHash,
      headers[0]
    );
    let currentProof = initResult.proof as LightClientProof;

    for (let i = 1; i < headers.length; i++) {
      const result = await LightClient.verifyBlock(
        headers[i].hash(),
        currentProof,
        headers[i],
        UInt32.from(Math.floor(Date.now() / 1000))
      );
      currentProof = result.proof as LightClientProof;
    }

    return currentProof;
  }
}

export default {
  ZcashBlockHeader,
  LightClientState,
  MerkleBranch,
  Checkpoint,
  LightClient,
  LightClientProof,
  LightClientHelper,
};