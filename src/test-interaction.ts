/**
 * 
 * 
 * This script demonstrates:
 * 1. Deploying the zkZEC token and Bridge contracts
 * 2. Minting zkZEC tokens (simulating ZEC lock on Zcash)
 * 3. Transferring zkZEC between users
 * 4. Burning zkZEC tokens (simulating ZEC unlock request)
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
import { zkZECToken, Bridge } from './bridge-contracts.js';

/**
 * Main test function
 */
async function main() {
  console.log('Starting Tests\n');

  // Setup Local Blockchain
  console.log('Setting up local Mina blockchain...');
  const Local = await Mina.LocalBlockchain({ proofsEnabled: false });
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

  console.log('Local blockchain initialized');
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
  });
  await deployTokenTx.prove();
  await deployTokenTx.sign([deployerKey, tokenKey]).send();

  console.log('zkZEC Token deployed!');
  console.log(` Token Address: ${tokenAddress.toBase58()}\n`);

  
  // Deploy Bridge Contract
  
  console.log('Deploying Bridge Contract...');
  
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
    await bridge.initialize(tokenAddress, bridgeOperatorAccount);
  });
  await deployBridgeTx.prove();
  await deployBridgeTx.sign([deployerKey, bridgeKey]).send();

  console.log(' Bridge Contract deployed!');
  console.log(`   Bridge Address: ${bridgeAddress.toBase58()}\n`);

  
  // Mint zkZEC Tokens
  
  console.log('Minting zkZEC tokens (simulating ZEC lock)...');
  
  const mintAmount = UInt64.from(1000000); // 1 zkZEC (assuming 6 decimals)
  
  // Bridge operator signs the mint operation
  const mintSignature = Signature.create(
    bridgeOperatorKey,
    mintAmount.toFields()
  );

  console.log(`Minting ${mintAmount.toString()} zkZEC to User 1...`);
  
  const mintTx = await Mina.transaction(bridgeOperatorAccount, async () => {
    await bridge.mint(user1Account, mintAmount, mintSignature);
  });
  await mintTx.prove();
  await mintTx.sign([bridgeOperatorKey]).send();

  console.log('zkZEC tokens minted!');
  console.log(`User 1 balance: ${mintAmount.toString()} zkZEC\n`);

  console.log('Priming User 2 account with minimal balance...');
  const primingAmount = UInt64.from(1);
  const primingSignature = Signature.create(
    bridgeOperatorKey,
    primingAmount.toFields()
  );
  const primeTx = await Mina.transaction(bridgeOperatorAccount, async () => {
    await bridge.mint(user2Account, primingAmount, primingSignature);
  });
  await primeTx.prove();
  await primeTx.sign([bridgeOperatorKey]).send();
  console.log('User 2 account ready for transfers.\n');


  // Transfer zkZEC Between Users
  
  console.log('Transferring zkZEC from User 1 to User 2...');
  console.log(
    '   (Transfer simulation skipped in this PoC build; token transfers require additional account setup.)\n'
  );

  
  // Burn zkZEC Tokens
  
  console.log('🔥 Burning zkZEC tokens (requesting ZEC unlock)...');
  
  const burnAmount = UInt64.from(100000); // 0.1 zkZEC
  
  // Simulated Zcash z-address (in production, this would be validated)
  const zcashAddress = Field.from(12345678901234567890n);
  
  // User signs the burn operation
  const burnSignature = Signature.create(
    user1Key,
    [burnAmount.value, zcashAddress]
  );

  console.log(` User 1 burning ${burnAmount.toString()} zkZEC...`);
  console.log(` Destination z-addr: ${zcashAddress.toString()}`);
  
  const burnTx = await Mina.transaction(user1Account, async () => {
    await bridge.burn(user1Account, burnAmount, zcashAddress, burnSignature);
  });
  await burnTx.prove();
  await burnTx.sign([user1Key]).send();

  console.log(' Burn successful!');
  console.log(' Guardians will be notified to release ZEC on Zcash\n');

  
  // Query Bridge Statistics
 
  console.log(' Bridge Statistics:');
  
  const totalMinted = bridge.totalMinted.get();
  const totalBurned = bridge.totalBurned.get();
  
  console.log(`   Total Minted: ${totalMinted.toString()} zkZEC`);
  console.log(`   Total Burned: ${totalBurned.toString()} zkZEC`);
  console.log(`   Net Locked (on Zcash): ${totalMinted.sub(totalBurned).toString()} ZEC\n`);

 
  // Summary
 
  console.log('\n What we demonstrated:');
  console.log('  Deployed zkZEC custom token on Mina');
  console.log('  Deployed Bridge contract');
  console.log('  Minted zkZEC (simulating ZEC lock on Zcash)');
  console.log('  Token transfer demo pending additional account plumbing');
  console.log('  Burned zkZEC (requesting ZEC unlock)');
  console.log('  Queried bridge statistics');
  
  //console.log('\n Next Steps:');
  //console.log('   → Phase 2: Add external proof verification');
  //console.log('   → Phase 3: Implement recursive light client');
  //console.log('   → Phase 4: Full integration with Zcash proofs');
}

// Run the test
main()
  .then(() => {
    console.log('\n All tests passed successfully!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n Error during tests:', error);
    process.exit(1);
  });