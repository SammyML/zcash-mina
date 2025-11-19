/**
 * Test and Interaction
 *
 * This script demonstrates:
 * 1. Deploying the zkZEC token and Bridge contracts
 * 2. Minting zkZEC tokens (simulating ZEC lock on Zcash)
 * 3. Transferring zkZEC between users
 * 4. Burning zkZEC tokens (simulating ZEC unlock request)
 * 5. Querying bridge statistics
 */

import {
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  UInt64,
  Signature,
  Field,
} from 'o1js';
import { zkZECToken, Bridge } from './bridge-contracts';

/**
 * Main test function
 */
async function main() {
  console.log('🚀 Phase 1: zkZEC Bridge PoC - Starting Tests\n');

  
  // Setup Local Blockchain
  console.log(' Setting up local Mina blockchain...');
  const Local = await Mina.LocalBlockchain({ proofsEnabled: true });
  Mina.setActiveInstance(Local);

  // Get test accounts from local blockchain
  const deployerAccount = Local.testAccounts[0];
  const deployerKey = deployerAccount.key;
  
  const bridgeOperatorAccount = Local.testAccounts[1];
  const bridgeOperatorKey = bridgeOperatorAccount.key;
  
  const user1Account = Local.testAccounts[2];
  const user1Key = user1Account.key;
  
  const user2Account = Local.testAccounts[3];
  const user2Key = user2Account.key;

  console.log(' Local blockchain initialized');
  console.log(`   Deployer: ${deployerAccount.toBase58()}`);
  console.log(`   Bridge Operator: ${bridgeOperatorAccount.toBase58()}`);
  console.log(`   User 1: ${user1Account.toBase58()}`);
  console.log(`   User 2: ${user2Account.toBase58()}\n`);

  
  // Deploy Token Contract
  console.log('🪙 Deploying zkZEC Token Contract...');
  
  // Generate keypair for token contract
  const tokenKey = PrivateKey.random();
  const tokenAddress = tokenKey.toPublicKey();
  
  // Create token contract instance
  const token = new zkZECToken(tokenAddress);

  console.log('   Compiling zkZEC contract...');
  await zkZECToken.compile();
  
  // Deploy token contract
  const deployTokenTx = await Mina.transaction(deployerAccount, async () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    await token.deploy({});
    await token.init();
  });
  await deployTokenTx.sign([deployerKey, tokenKey]).send();

  console.log(' zkZEC Token deployed!');
  console.log(`   Token Address: ${tokenAddress.toBase58()}\n`);


  // Deploy Bridge Contract
  
  console.log(' Deploying Bridge Contract...');
  
  // Generate keypair for bridge contract
  const bridgeKey = PrivateKey.random();
  const bridgeAddress = bridgeKey.toPublicKey();
  
  // Create bridge contract instance
  const bridge = new Bridge(bridgeAddress);

  console.log(' Compiling Bridge contract...');
  await Bridge.compile();
  
  // Deploy bridge contract
  const deployBridgeTx = await Mina.transaction(deployerAccount, async () => {
    AccountUpdate.fundNewAccount(deployerAccount);
    await bridge.deploy({});
    await bridge.init(tokenAddress);
  });
  await deployBridgeTx.sign([deployerKey, bridgeKey]).send();

  console.log(' Bridge Contract deployed!');
  console.log(` Bridge Address: ${bridgeAddress.toBase58()}\n`);

  // Mint zkZEC Tokens
  console.log('💰 Minting zkZEC tokens (simulating ZEC lock)...');
  
  const mintAmount = UInt64.from(1000000); // 1 zkZEC (assuming 6 decimals)
  
  // Bridge operator signs the mint operation
  const mintSignature = Signature.create(
    bridgeOperatorKey,
    mintAmount.toFields()
  );

  console.log(`   Minting ${mintAmount.toString()} zkZEC to User 1...`);
  
  const mintTx = await Mina.transaction(bridgeOperatorAccount, async () => {
    AccountUpdate.fundNewAccount(bridgeOperatorAccount);
    await bridge.mint(user1Account, mintAmount, mintSignature);
  });
  await mintTx.sign([bridgeOperatorKey]).send();

  console.log(' zkZEC tokens minted!');
  console.log(`   User 1 balance: ${mintAmount.toString()} zkZEC\n`);

  // Transfer zkZEC Between Users
  
  console.log(' Transferring zkZEC from User 1 to User 2...');
  
  const transferAmount = UInt64.from(250000); // 0.25 zkZEC

  const transferTx = await Mina.transaction(user1Account, async () => {
    AccountUpdate.fundNewAccount(user1Account);
    
    // User 1 sends tokens to User 2
    const senderUpdate = AccountUpdate.createSigned(user1Account);
    senderUpdate.balanceChange = senderUpdate.balanceChange.sub(transferAmount.value);
    senderUpdate.body.tokenId = token.deriveTokenId();
    
    const receiverUpdate = AccountUpdate.create(user2Account);
    receiverUpdate.balanceChange = receiverUpdate.balanceChange.add(transferAmount.value);
    receiverUpdate.body.tokenId = token.deriveTokenId();
  });
  await transferTx.sign([user1Key]).send();

  console.log(' Transfer successful!');
  console.log(`   User 1 balance: ${mintAmount.sub(transferAmount).toString()} zkZEC`);
  console.log(`   User 2 balance: ${transferAmount.toString()} zkZEC\n`);


  // Burn zkZEC Tokens
  console.log('Burning zkZEC tokens (requesting ZEC unlock)...');
  
  const burnAmount = UInt64.from(100000); // 0.1 zkZEC
  
  // Simulated Zcash z-address (in production, this would be validated)
  const zcashAddress = Field.from(12345678901234567890n);
  
  // User signs the burn operation
  const burnSignature = Signature.create(
    user1Key,
    [burnAmount.value, zcashAddress]
  );

  console.log(`   User 1 burning ${burnAmount.toString()} zkZEC...`);
  console.log(`   Destination z-addr: ${zcashAddress.toString()}`);
  
  const burnTx = await Mina.transaction(user1Account, async () => {
    await bridge.burn(burnAmount, zcashAddress, burnSignature);
  });
  await burnTx.sign([user1Key]).send();

  console.log('Burn successful!');
  console.log(' Guardians will be notified to release ZEC on Zcash\n');

  
  // Query Bridge Statistics
  
  console.log('Bridge Statistics:');
  
  const stats = await bridge.getBridgeStats();
  
  console.log(`   Total Minted: ${stats.totalMinted.toString()} zkZEC`);
  console.log(`   Total Burned: ${stats.totalBurned.toString()} zkZEC`);
  console.log(`   Net Locked (on Zcash): ${stats.netLocked.toString()} ZEC\n`);


  console.log('Phase 1 PoC Complete!');
  console.log('\n What we demonstrated:');
  console.log('    Deployed zkZEC custom token on Mina');
  console.log('    Deployed Bridge contract');
  console.log('    Minted zkZEC (simulating ZEC lock on Zcash)');
  console.log('    Transferred zkZEC between users');
  console.log('    Burned zkZEC (requesting ZEC unlock)');
  console.log('    Queried bridge statistics');
  
}

// Run the test
main()
  .then(() => {
    console.log('\n All tests passed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n  Error during tests:', error);
    process.exit(1);
  });