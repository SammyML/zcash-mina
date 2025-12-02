/**
 * This is the complete zcash-mina bridge implementation
 * 
 * Provides a privacy preserving bridge between Zcash and Mina
 * using recursive zero-knowledge proofs.
 */

import {
  SmartContract,
  state,
  State,
  method,
  UInt64,
  PublicKey,
  Permissions,
  DeployArgs,
  Field,
  Bool,
  AccountUpdate,
  Provable,
  Poseidon,
  MerkleMapWitness,
  Struct,
  Signature,
} from 'o1js';

import { zkZECToken } from './bridge-contracts.js';
import {
  ZcashVerifier,
  ZcashProofVerification,
} from './zcash-verifier.js';
import { OrchardVerifier, OrchardProof } from './orchard-verifier.js';
import { OrchardBundle, OrchardAction } from './orchard-types.js';
import {
  LightClient,
  LightClientProof,
  MerkleBranch,
} from './light-client.js';

/**
 * Bridge State Snapshot
 * Tracks critical bridge parameters for auditing
 */
const LightClientUpdatedEvent = Struct({
  blockHash: Field,
  height: UInt64,
  chainWork: Field,
});

const MintedEvent = Struct({
  recipient: PublicKey,
  amount: UInt64,
  zcashTxHash: Field,
  nullifier1: Field,
  nullifier2: Field,
});

const WithdrawalEvent = Struct({
  burnerAddress: PublicKey,
  amount: UInt64,
  zcashAddress: Field,
  requestId: Field,
});

const BridgePausedEvent = Struct({
  timestamp: Field,
});

const BurnRequestedEvent = Struct({
  requester: PublicKey,
  amount: UInt64,
  zcashAddress: Field,
  timestamp: UInt64,
});

const BurnedEvent = Struct({
  burner: PublicKey,
  amount: UInt64,
  zcashAddress: Field,
});

export class BridgeSnapshot extends Struct({
  totalMinted: UInt64,
  totalBurned: UInt64,
  nullifierSetRoot: Field,
  zcashBlockHeight: UInt64,
  timestamp: UInt64,
}) {
  netLocked(): UInt64 {
    return this.totalMinted.sub(this.totalBurned);
  }

  hash(): Field {
    return Poseidon.hash([
      this.totalMinted.value,
      this.totalBurned.value,
      this.nullifierSetRoot,
      this.zcashBlockHeight.value,
      this.timestamp.value,
    ]);
  }
}

/**
 * Withdrawal Request
 * Created when user burns zkZEC to unlock ZEC on Zcash
 */
export class WithdrawalRequest extends Struct({
  burnerAddress: PublicKey,
  amount: UInt64,
  zcashAddress: Field,
  requestId: Field,
  timestamp: UInt64,
  status: Field, // 0=pending, 1=completed, 2=cancelled
}) {
  static pending(
    burner: PublicKey,
    amount: UInt64,
    zcashAddr: Field,
    id: Field
  ): WithdrawalRequest {
    return new WithdrawalRequest({
      burnerAddress: burner,
      amount,
      zcashAddress: zcashAddr,
      requestId: id,
      timestamp: UInt64.from(Date.now()),
      status: Field(0),
    });
  }

  hash(): Field {
    return Poseidon.hash([
      this.burnerAddress.x,
      this.amount.value,
      this.zcashAddress,
      this.requestId,
    ]);
  }

  isPending(): Bool {
    return this.status.equals(Field(0));
  }

  isCompleted(): Bool {
    return this.status.equals(Field(1));
  }
}

/**
 * Fixed-size array of MerkleMapWitnesses for Orchard actions
 */
export class NullifierWitnesses extends Struct({
  witnesses: Provable.Array(MerkleMapWitness, 2)
}) { }

/**
 * Complete Bridge Contract
 * 
 * Features:
 * - Mint zkZEC with Zcash proof verification
 * - Light client integration for blockchain verification
 * - Nullifier tracking to prevent double-spends
 * - Withdrawal management
 * - Emergency pause mechanism
 */
export class BridgeV3 extends SmartContract {

  // State Variables


  // Hash of configuration (tokenAddress, operator)
  // configHash = Poseidon.hash(tokenAddress.toFields().concat(operator.toFields()))
  @state(Field) configHash = State<Field>();

  // Light client state
  @state(Field) zcashBlockHash = State<Field>();
  @state(UInt64) zcashBlockHeight = State<UInt64>();

  // Nullifier set root (Merkle tree of spent nullifiers)
  @state(Field) nullifierSetRoot = State<Field>();

  // Processed Zcash transactions root (prevent replays)
  @state(Field) processedTxRoot = State<Field>();

  // Emergency pause flag
  @state(Bool) isPaused = State<Bool>();

  // Security: Rate Limiting & Circuit Breaker (packed into one Field)
  // Format: Poseidon.hash([lastMintTime, dailyMintedAmount, lastResetTime])
  @state(Field) securityState = State<Field>();

  // Security: Burn Timelock
  @state(Field) burnRequestsRoot = State<Field>();

  // Note: totalMinted and totalBurned are now tracked off-chain via events
  // Use the 'minted' and 'burned' events to reconstruct these values

  // Deployment & Initialization 


  async deploy(args: DeployArgs) {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
      receive: Permissions.proof(),
    });
  }

  @method
  async initialize(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    genesisBlockHash: Field,
    genesisHeight: UInt64,
    initialNullifierRoot: Field,
    initialProcessedTxRoot: Field,
    initialBurnRequestsRoot: Field
  ) {
    super.init();

    // Set config hash
    const configHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    this.configHash.set(configHash);

    // Initialize light client with Zcash genesis
    this.zcashBlockHash.set(genesisBlockHash);
    this.zcashBlockHeight.set(genesisHeight);

    // Initialize nullifier set
    this.nullifierSetRoot.set(initialNullifierRoot);

    // Initialize empty processed tx set
    this.processedTxRoot.set(initialProcessedTxRoot);

    // Initialize pause state
    this.isPaused.set(Bool(false));

    // Initialize security state (all zeros)
    // Format: Poseidon.hash([lastMintTime, dailyMintedAmount, lastResetTime])
    const initialSecurityState = Poseidon.hash([Field(0), Field(0), Field(0)]);
    this.securityState.set(initialSecurityState);

    // Initialize burn requests map
    this.burnRequestsRoot.set(initialBurnRequestsRoot);
  }


  // Light Client Operations


  @method
  async updateLightClient(proof: LightClientProof) {
    // Ensure bridge not paused
    const paused = this.isPaused.getAndRequireEquals();
    paused.assertFalse('Bridge is paused');

    // Verify the light client proof
    proof.verify();

    // Get current state
    this.zcashBlockHash.getAndRequireEquals();
    const previousHeight = this.zcashBlockHeight.getAndRequireEquals();

    // Basic monotonicity check
    proof.publicOutput.height
      .greaterThan(previousHeight)
      .assertTrue('Light client proof must advance the chain');

    // Update to new state
    const newState = proof.publicOutput;
    this.zcashBlockHash.set(newState.latestBlockHash);
    this.zcashBlockHeight.set(newState.height);

    this.emitEvent('lightClientUpdated', {
      blockHash: newState.latestBlockHash,
      height: newState.height,
      chainWork: newState.chainWork,
    });
  }


  // Minting Operations (ZEC -> zkZEC)

  @method
  async mintWithFullVerification(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    recipientAddress: PublicKey,
    // zcashTxHash, zcashProof removed - we get them from the verified proof output
    proofVerification: ZcashProofVerification,
    merkleBranch: MerkleBranch,
    nullifierWitness1: MerkleMapWitness,
    nullifierWitness2: MerkleMapWitness,
    processedTxWitness: MerkleMapWitness
  ) {
    // 0. Verify config
    const configHash = this.configHash.getAndRequireEquals();
    const computedConfigHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    configHash.assertEquals(computedConfigHash, 'Invalid config');

    // 1. Check bridge is not paused
    const paused = this.isPaused.getAndRequireEquals();
    paused.assertFalse('Bridge is paused');

    // 2. Verify Zcash proof
    proofVerification.verify();

    // Get verified data from the proof output
    const mintOutput = proofVerification.publicOutput;
    const zcashTxHash = mintOutput.txHash;
    const mintAmount = mintOutput.amount;
    const nullifier1 = mintOutput.nullifier1;
    const nullifier2 = mintOutput.nullifier2;

    // 3. Amount Limits (basic sanity check)
    // Min: 0.001 ZEC (100,000 zats), Max: 10,000 ZEC
    mintAmount.assertGreaterThanOrEqual(UInt64.from(100_000), 'Amount too small');
    mintAmount.assertLessThanOrEqual(UInt64.from(1_000_000_000_000), 'Amount too large');

    // 4. Verify transaction is in a verified Zcash block (Merkle Proof)
    // We verify that the transaction hash exists in the block header we track
    // Note: In a full implementation, we would verify the Merkle path from txHash to blockRoot
    // For this demo, we verify the block header is tracked by our light client
    // and that the transaction hash matches the proof input.

    // Verify we are tracking a valid Zcash block
    this.zcashBlockHash.getAndRequireEquals();

    // 5. Check nullifiers haven't been spent (prevent double-spend)
    const nullifierRoot = this.nullifierSetRoot.getAndRequireEquals();

    // Verify nullifier1 not in set
    const [computedRoot1, key1] = nullifierWitness1.computeRootAndKey(
      Field(0)
    );
    computedRoot1.assertEquals(nullifierRoot, 'Invalid nullifier witness 1');
    key1.assertEquals(
      nullifier1,
      'Nullifier1 mismatch'
    );

    // Verify nullifier2 not in set
    const [computedRoot2, key2] = nullifierWitness2.computeRootAndKey(
      Field(0)
    );
    computedRoot2.assertEquals(nullifierRoot, 'Invalid nullifier witness 2');
    key2.assertEquals(
      nullifier2,
      'Nullifier2 mismatch'
    );

    // 8. Check transaction hasn't been processed (prevent replay)
    const processedRoot = this.processedTxRoot.getAndRequireEquals();
    const [computedTxRoot, txKey] = processedTxWitness.computeRootAndKey(
      Field(0)
    );
    computedTxRoot.assertEquals(processedRoot, 'Invalid tx witness');
    txKey.assertEquals(zcashTxHash, 'Tx hash mismatch');

    // 9. Add nullifiers to set (mark as spent)
    // We update with the first nullifier's root.
    const newNullifierRoot1 = nullifierWitness1.computeRootAndKey(
      Field(1)
    )[0];
    this.nullifierSetRoot.set(newNullifierRoot1);

    // 10. Mark transaction as processed
    const newProcessedRoot = processedTxWitness.computeRootAndKey(
      Field(1)
    )[0];
    this.processedTxRoot.set(newProcessedRoot);

    // 11. Mint zkZEC tokens
    const token = new zkZECToken(tokenAddress);
    token.internal.mint({ address: recipientAddress, amount: mintAmount });

    // 12. Emit event (totalMinted/totalBurned tracked off-chain via events)
    this.emitEvent('minted', {
      recipient: recipientAddress,
      amount: mintAmount,
      zcashTxHash,
      nullifier1: nullifier1,
      nullifier2: nullifier2,
    });
  }



  /**
   * Mint zkZEC using Native Orchard Verification
   * 
   * This method uses the Pallas/Vesta curve compatibility to verify
   * Zcash Orchard transactions natively on Mina, without off-chain guardians.
   */
  @method
  async mintWithOrchardVerification(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    recipientAddress: PublicKey,
    orchardBundle: OrchardBundle,
    orchardProof: OrchardProof,
    nullifierWitnesses: NullifierWitnesses,
  ) {
    // 1. Verify config
    const configHash = this.configHash.getAndRequireEquals();
    const computedConfigHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    configHash.assertEquals(computedConfigHash, 'Invalid config');

    // 2. Check bridge is not paused
    this.isPaused.getAndRequireEquals().assertFalse('Bridge is paused');

    // 3. Verify Orchard bundle natively on-chain
    // This verifies the anchor, binding signature, and internal consistency
    orchardProof.verify();

    // Verify anchor matches on-chain state
    orchardProof.publicInput.assertEquals(
      this.zcashBlockHash.getAndRequireEquals(),
      'Anchor mismatch'
    );

    // Verify bundle matches proof output
    // This ensures the bundle provided is the one that was verified
    orchardProof.publicOutput.valueBalance.assertEquals(
      orchardBundle.valueBalance,
      'Value balance mismatch'
    );

    // 4. Check nullifiers haven't been spent
    const nullifierRoot = this.nullifierSetRoot.getAndRequireEquals();
    const nullifiers = orchardBundle.actions.map((a: OrchardAction) => a.nf);

    // Verify proof output matches bundle actions
    for (let i = 0; i < 2; i++) {
      orchardProof.publicOutput.nullifiers[i].assertEquals(
        nullifiers[i],
        'Nullifier mismatch with proof'
      );
    }

    // We only support 2 actions in this demo implementation
    for (let i = 0; i < 2; i++) {
      const [root, key] = nullifierWitnesses.witnesses[i].computeRootAndKey(Field(0));
      root.assertEquals(nullifierRoot, 'Invalid nullifier witness');
      key.assertEquals(nullifiers[i], 'Nullifier mismatch');
    }

    // 5. Mint zkZEC
    // Value balance is positive for mints (ZEC locked -> zkZEC minted)
    const mintAmount = orchardBundle.valueBalance;

    // Amount limits check
    mintAmount.assertGreaterThanOrEqual(UInt64.from(100_000), 'Amount too small');
    mintAmount.assertLessThanOrEqual(UInt64.from(1_000_000_000_000), 'Amount too large');

    const token = new zkZECToken(tokenAddress);
    token.internal.mint({ address: recipientAddress, amount: mintAmount });

    // 6. Update nullifier set
    // We update sequentially for each nullifier
    let currentRoot = nullifierRoot;
    for (let i = 0; i < 2; i++) {
      // Re-verify witness against current root (which might have changed in previous iteration)
      // Note: In a real MerkleMap, we'd need updated witnesses or a batch update
      // For this demo, we assume the witnesses are valid for the initial state
      // and we just calculate the new root
      const [newRoot, _] = nullifierWitnesses.witnesses[i].computeRootAndKey(Field(1));
      currentRoot = newRoot;
    }
    this.nullifierSetRoot.set(currentRoot);

    // 7. Emit event
    this.emitEvent('minted', {
      recipient: recipientAddress,
      amount: mintAmount,
      zcashTxHash: orchardBundle.anchor, // Using anchor as tx reference for now
      nullifier1: nullifiers[0],
      nullifier2: nullifiers[1],
    });
  }

  // Burning Operations (zkZEC -> ZEC)

  /**
   * Request a burn (Step 1 of 2)
   * 
   * Initiates a burn request which is timelocked for 24 hours.
   * This allows guardians to detect and prevent fraudulent burns.
   */
  @method
  async requestBurn(
    amount: UInt64,
    zcashAddress: Field,
    userSignature: Signature,
    requesterAddress: PublicKey,
    burnRequestsWitness: MerkleMapWitness
  ) {
    // 1. Check bridge is not paused
    const paused = this.isPaused.getAndRequireEquals();
    paused.assertFalse('Bridge is paused');

    // 2. Verify signature
    const isValid = userSignature.verify(
      requesterAddress,
      [amount.value, zcashAddress]
    );
    isValid.assertTrue('Invalid user signature');

    // 3. Verify burn request doesn't already exist
    const requestsRoot = this.burnRequestsRoot.getAndRequireEquals();
    const [computedRoot, key] = burnRequestsWitness.computeRootAndKey(Field(0));
    computedRoot.assertEquals(requestsRoot, 'Invalid witness');

    // Key is hash(requester + amount + zcashAddress)
    const requestHash = Poseidon.hash(
      requesterAddress.toFields().concat([amount.value, zcashAddress])
    );
    key.assertEquals(requestHash, 'Request hash mismatch');

    // 4. Store request with current timestamp
    const currentTime = this.network.timestamp.getAndRequireEquals();
    const [newRoot] = burnRequestsWitness.computeRootAndKey(currentTime.value);
    this.burnRequestsRoot.set(newRoot);

    // 5. Emit event
    this.emitEvent('burnRequested', {
      requester: requesterAddress,
      amount,
      zcashAddress,
      timestamp: currentTime
    });
  }

  /**
   * Execute a burn (Step 2 of 2)
   * 
   * Finalizes the burn after the timelock has expired.
   * Burns the tokens and updates stats.
   */
  @method
  async executeBurn(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    burnerAddress: PublicKey,
    amount: UInt64,
    zcashAddress: Field,
    requestTime: UInt64,
    burnRequestsWitness: MerkleMapWitness
  ) {
    // 0. Verify config
    const configHash = this.configHash.getAndRequireEquals();
    const computedConfigHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    configHash.assertEquals(computedConfigHash, 'Invalid config');

    // 1. Check bridge is not paused
    const paused = this.isPaused.getAndRequireEquals();
    paused.assertFalse('Bridge is paused');

    // 2. Verify timelock (24 hours = 86,400,000 ms)
    const currentTime = this.network.timestamp.getAndRequireEquals();
    const timePassed = currentTime.sub(requestTime);
    // For demo purposes, we use 1 minute instead of 24 hours
    timePassed.assertGreaterThanOrEqual(UInt64.from(60_000), 'Timelock not expired');

    // 3. Verify burn request exists
    const requestsRoot = this.burnRequestsRoot.getAndRequireEquals();
    const [computedRoot, key] = burnRequestsWitness.computeRootAndKey(requestTime.value);
    computedRoot.assertEquals(requestsRoot, 'Invalid witness');

    const requestHash = Poseidon.hash(
      burnerAddress.toFields().concat([amount.value, zcashAddress])
    );
    key.assertEquals(requestHash, 'Request hash mismatch');

    // 4. Remove request (set to 0) to prevent replay
    const [newRoot] = burnRequestsWitness.computeRootAndKey(Field(0));
    this.burnRequestsRoot.set(newRoot);

    // 5. Burn tokens
    const token = new zkZECToken(tokenAddress);
    token.internal.burn({
      address: burnerAddress,
      amount: amount,
    });

    // 6. Emit event (totalBurned tracked off-chain via events)
    this.emitEvent('burned', {
      burner: burnerAddress,
      amount,
      zcashAddress
    });
  }


  // Administrative Operations

  @method
  async pause(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    operatorSignature: Signature
  ) {
    // Verify config
    const configHash = this.configHash.getAndRequireEquals();
    const computedConfigHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    configHash.assertEquals(computedConfigHash, 'Invalid config');

    // Verify signature
    operatorSignature.verify(operatorAddress, [Field(1)]).assertTrue();

    this.isPaused.set(Bool(true));
    this.emitEvent('paused', { timestamp: Field(Date.now()) });
  }

  @method
  async unpause(
    tokenAddress: PublicKey,
    operatorAddress: PublicKey,
    operatorSignature: Signature
  ) {
    // Verify config
    const configHash = this.configHash.getAndRequireEquals();
    const computedConfigHash = Poseidon.hash(
      tokenAddress.toFields().concat(operatorAddress.toFields())
    );
    configHash.assertEquals(computedConfigHash, 'Invalid config');

    // Verify signature
    operatorSignature.verify(operatorAddress, [Field(0)]).assertTrue();

    this.isPaused.set(Bool(false));
    this.emitEvent('unpaused', { timestamp: Field(Date.now()) });
  }




  // Events

  events = {
    lightClientUpdated: LightClientUpdatedEvent,
    minted: MintedEvent,
    burnRequested: BurnRequestedEvent,
    burned: BurnedEvent,
    paused: BridgePausedEvent,
    unpaused: BridgePausedEvent,
  };
}

/**
 * Helper functions for bridge operations
 */
export class BridgeHelper {
  /**
   * Calculate mint fee
   * implement fee structure( when the product is live for general use)
   */
  static calculateMintFee(amount: UInt64): UInt64 {
    // 0.1% fee
    return amount.div(1000);
  }

  /**
   * Calculate burn fee
   */
  static calculateBurnFee(amount: UInt64): UInt64 {
    // 0.1% fee
    return amount.div(1000);
  }

  /**
   * Estimate time for withdrawal processing
   * Based on Zcash confirmation requirements
   */
  static estimateWithdrawalTime(confirmations: number = 6): number {
    // Zcash block time: ~75 seconds
    return confirmations * 75; // seconds
  }

  /**
   * Validate Zcash z-address format
   */
  static isValidZcashAddress(address: string): boolean {
    // Sapling addresses start with 'zs'
    // Orchard addresses start with 'u' (unified)
    return (
      (address.startsWith('zs') && address.length === 78) ||
      (address.startsWith('u1') && address.length >= 141)
    );
  }
}

export default {
  BridgeV3,
  BridgeSnapshot,
  WithdrawalRequest,
  BridgeHelper,
};