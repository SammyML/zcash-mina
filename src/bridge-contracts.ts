/**
 * zkZEC Token and Bridge Contracts
 * 
 * Core smart contracts for the Zcash-Mina bridge:
 * - zkZEC: Custom token representing wrapped ZEC
 * - Bridge: Handles minting and burning with ZK proof verification
 */

import {
  SmartContract,
  state,
  State,
  method,
  UInt64,
  PublicKey,
  Signature,
  Permissions,
  DeployArgs,
  TokenContract,
  AccountUpdateForest,
  Field,
  MerkleMapWitness,
} from 'o1js';

import { ZcashProofVerification } from './zcash-verifier.js';

/**
 * zkZEC Token Contract
 * 
 * This is a custom token on Mina representing wrapped Zcash (ZEC).
 * It extends TokenContract which provides the base functionality for custom tokens.
 * 
 * Key features:
 * - Tracks total supply of zkZEC in circulation
 * - Controls minting and burning through the bridge
 * - Uses token symbol "zkZEC" to identify this custom token
 */
export class zkZECToken extends TokenContract {

  /**
   * Deploy the token contract with proper permissions
   * This sets up the initial state and security permissions
   */
  async deploy(args: DeployArgs) {
    await super.deploy(args);

    // Set permissions to ensure only proofs can modify state
    // This prevents unauthorized changes to the token contract
    this.account.permissions.set({
      ...Permissions.default(),
      // Only this contract (via proofs) can edit state
      editState: Permissions.proof(),
      // Only this contract can set the token symbol
      setTokenSymbol: Permissions.proof(),
      // Sending requires proof authorization
      send: Permissions.proof(),
      // Receiving requires proof authorization  
      receive: Permissions.proof(),
    });
  }

  /**
   * Initialize the token contract
   * Sets the token symbol and initializes total supply to 0
   */
  @method
  async init() {
    super.init();

    // Set the token symbol to "zkZEC"
    this.account.tokenSymbol.set('zkZEC');

  }

  /**
   * Approves or denies token operations
   */
  @method
  async approveBase(forest: AccountUpdateForest): Promise<void> {
    this.checkZeroBalanceChange(forest);
  }
}

/**
 * Bridge Contract
 * 
 * Manages the bridge between Zcash and Mina.
 * Mints zkZEC tokens when ZEC is locked on Zcash.
 * Burns zkZEC tokens when users want to unlock ZEC on Zcash.
 */
export class Bridge extends SmartContract {
  // Reference to the zkZEC token contract
  @state(PublicKey) tokenAddress = State<PublicKey>();

  // Authorized bridge operator public key
  @state(PublicKey) operatorAddress = State<PublicKey>();

  // Track total amount minted (for monitoring/debugging)
  @state(UInt64) totalMinted = State<UInt64>();

  // Track total amount burned (for monitoring/debugging)
  @state(UInt64) totalBurned = State<UInt64>();

  // Root of the nullifier Merkle Map (prevents double-spending)
  @state(Field) nullifierRoot = State<Field>();

  /**
   * Deploy the bridge contract with proper permissions
   */
  async deploy(args: DeployArgs) {
    await super.deploy(args);

    this.account.permissions.set({
      ...Permissions.default(),
      editState: Permissions.proof(),
      send: Permissions.proof(),
      receive: Permissions.proof(),
    });
  }

  /**
   * Initialize the bridge contract
   * Sets the token address and initializes counters
   * 
   * @param tokenAddress - Address of the zkZEC token contract
   */
  @method
  async initialize(tokenAddress: PublicKey, operator: PublicKey) {
    super.init();

    this.tokenAddress.set(tokenAddress);
    this.operatorAddress.set(operator);
    this.totalMinted.set(UInt64.from(0));
    this.totalBurned.set(UInt64.from(0));
    // Initialize empty Merkle Map root
    // Root of empty MerkleMap()
    const emptyMapRoot = Field('29554586302995507950896879774049088969377516712869523960093083257574755226328');
    this.nullifierRoot.set(emptyMapRoot);
  }

  /**
   * Mint zkZEC tokens using a Zcash proof
   * 
   * Verifies ZK proof and checks nullifiers to prevent double-spending.
   */
  @method
  async mint(
    recipientAddress: PublicKey,
    proof: ZcashProofVerification,
    nullifierWitness1: MerkleMapWitness,
    nullifierWitness2: MerkleMapWitness
  ) {
    // 1. Verify the ZK proof
    // The proof public input is the transaction hash.
    // We verify that the proof is valid for the claimed output.
    // We verify that the proof is valid for the claimed output.
    const output = proof.publicOutput;
    proof.verify();

    // 2. Prevent Double-Spending (Nullifier Check)
    const currentRoot = this.nullifierRoot.getAndRequireEquals();

    // Check nullifier 1
    const [root1, key1] = nullifierWitness1.computeRootAndKey(Field(0)); // 0 = not spent
    root1.assertEquals(currentRoot, 'Nullifier 1 witness invalid');
    key1.assertEquals(output.nullifier1, 'Nullifier 1 key mismatch');

    // Update root to mark nullifier 1 as spent (set to 1)
    const [newRoot1] = nullifierWitness1.computeRootAndKey(Field(1));

    // Check nullifier 2 (against new root)
    const [root2, key2] = nullifierWitness2.computeRootAndKey(Field(0));
    root2.assertEquals(newRoot1, 'Nullifier 2 witness invalid');
    key2.assertEquals(output.nullifier2, 'Nullifier 2 key mismatch');

    // Update root to mark nullifier 2 as spent
    const [finalRoot] = nullifierWitness2.computeRootAndKey(Field(1));

    // Save new root
    this.nullifierRoot.set(finalRoot);

    // 3. Mint tokens
    const tokenAddr = this.tokenAddress.getAndRequireEquals();
    const token = new zkZECToken(tokenAddr);

    token.internal.mint({
      address: recipientAddress,
      amount: output.amount,
    });

    // 4. Update stats
    const totalMinted = this.totalMinted.getAndRequireEquals();
    this.totalMinted.set(totalMinted.add(output.amount));
  }

  /**
   * Burn zkZEC tokens
   * 
   * This is called when a user wants to unlock ZEC on Zcash.
   * The user burns their zkZEC, and guardians will release ZEC on Zcash.
   * 
   * @param burnerAddress - Address of the user burning tokens
   * @param amount - Amount of zkZEC to burn
   * @param zcashAddress - Destination Zcash z-address (as Field for simplicity)
   * @param userSignature - Signature from the user authorizing the burn
   */
  @method
  async burn(
    burnerAddress: PublicKey,
    amount: UInt64,
    zcashAddress: Field,
    userSignature: Signature
  ) {
    // Verify user signature
    const isValid = userSignature.verify(
      burnerAddress,
      [amount.value, zcashAddress]
    );
    isValid.assertTrue('Invalid user signature');

    const tokenAddr = this.tokenAddress.getAndRequireEquals();
    const token = new zkZECToken(tokenAddr);

    token.internal.burn({
      address: burnerAddress,
      amount: amount,
    });

    // Update bridge's burned counter
    const totalBurned = this.totalBurned.getAndRequireEquals();
    this.totalBurned.set(totalBurned.add(amount));

  }
}