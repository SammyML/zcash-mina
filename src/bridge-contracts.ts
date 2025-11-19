/**
 * PHASE 1: Mock Bridge & zkZEC Token (Mina-Side)
 * 
 * This is a Proof of Concept implementation for a Zcash-Mina bridge.
 * Phase 1 focuses on creating the basic token and bridge infrastructure on Mina.
 * 
 * Components:
 * 1. zkZEC Token Contract - Custom token representing wrapped ZEC
 * 2. Bridge Contract - Handles minting and burning of zkZEC
 * 
 * For Phase 1, mint/burn operations are simplified and require only signatures.
 * Later phases will add proof verification and light client integration.
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
  AccountUpdate,
  Field,
} from 'o1js';

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
  // Track the total amount of zkZEC tokens in circulation
  @state(UInt64) totalSupply = State<UInt64>();

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
    
    // Initialize total supply to zero
    this.totalSupply.set(UInt64.from(0));
  }

  /**
   * Required by TokenContract - approves or denies token operations
   * For Phase 1, we approve all operations from the bridge
   * 
   * @param forest - Forest of account updates to approve
   */
  @method
  async approveBase(forest: AccountUpdateForest): Promise<void> {
    // Simple approval: ensure the net balance change is zero
    // This means total tokens minted equals total tokens burned/transferred
    this.checkZeroBalanceChange(forest);
  }
}

/**
 * Bridge Contract
 * 
 * This contract manages the bridge between Zcash and Mina.
 * It can mint zkZEC tokens (when ZEC is locked on Zcash)
 * and burn zkZEC tokens (when user wants to unlock ZEC on Zcash).
 * 
 * Phase 1 Implementation:
 * - Simplified mint/burn that requires signatures only
 * - No proof verification (added in Phase 2)
 * - No light client integration (added in Phase 3)
 */
export class Bridge extends SmartContract {
  // Reference to the zkZEC token contract
  @state(PublicKey) tokenAddress = State<PublicKey>();
  
  // Track total amount minted (for monitoring/debugging)
  @state(UInt64) totalMinted = State<UInt64>();
  
  // Track total amount burned (for monitoring/debugging)
  @state(UInt64) totalBurned = State<UInt64>();

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
  async initialize(tokenAddress: PublicKey) {
    super.init();
    
    this.tokenAddress.set(tokenAddress);
    this.totalMinted.set(UInt64.from(0));
    this.totalBurned.set(UInt64.from(0));
  }

  /**
   * Mint zkZEC tokens
   * 
   * Phase 1: Simplified version that requires bridge operator signature
   * Phase 2+: Will require valid Zcash transaction proof
   * 
   * @param recipientAddress - Mina address to receive the zkZEC tokens
   * @param amount - Amount of zkZEC to mint (in smallest units)
   * @param bridgeOperatorSignature - Signature from authorized bridge operator
   */
  @method
  async mint(
    recipientAddress: PublicKey,
    amount: UInt64,
    bridgeOperatorSignature: Signature
  ) {
    // Phase 1: Verify bridge operator signature
    // In Phase 2+, this will be replaced with Zcash proof verification
    const isValid = bridgeOperatorSignature.verify(
      this.address,
      amount.toFields()
    );
    isValid.assertTrue('Invalid bridge operator signature');

    // Get current token address
    const tokenAddr = this.tokenAddress.getAndRequireEquals();
    
    // Get the token contract instance
    const token = new zkZECToken(tokenAddr);
    
    // Get current total supply from token contract
    const currentSupply = token.totalSupply.getAndRequireEquals();
    
    // Mint tokens using the token contract's internal mint method
    // This creates an account update that adds tokens to recipient's balance
    token.internal.mint({
      address: recipientAddress,
      amount: amount,
    });
    
    // Update token total supply
    token.totalSupply.set(currentSupply.add(amount));
    
    // Update bridge's minted counter
    const totalMinted = this.totalMinted.getAndRequireEquals();
    this.totalMinted.set(totalMinted.add(amount));

    // Emit event for off-chain monitoring
    this.emitEvent('minted', {
      recipient: recipientAddress,
      amount: amount,
    });
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

    // Get current token address
    const tokenAddr = this.tokenAddress.getAndRequireEquals();
    
    // Get the token contract instance
    const token = new zkZECToken(tokenAddr);
    
    // Get current total supply
    const currentSupply = token.totalSupply.getAndRequireEquals();
    
    // Burn tokens from the burner's account
    token.internal.burn({
      address: burnerAddress,
      amount: amount,
    });
    
    // Update token total supply (decrease)
    token.totalSupply.set(currentSupply.sub(amount));
    
    // Update bridge's burned counter
    const totalBurned = this.totalBurned.getAndRequireEquals();
    this.totalBurned.set(totalBurned.add(amount));

    // Emit withdrawal event with ZK proof
    // Guardians monitor for this event and execute Zcash transaction
    this.emitEvent('withdrawal', {
      amount: amount,
      zcashAddress: zcashAddress,
      burnerAddress: burnerAddress,
    });
  }

  // Define events that the bridge emits
  events: any = {
    minted: {
      recipient: PublicKey,
      amount: UInt64,
    },
    withdrawal: {
      amount: UInt64,
      zcashAddress: Field,
      burnerAddress: PublicKey,
    },
  };
}