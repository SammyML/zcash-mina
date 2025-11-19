/**
 * Main Entry Point
 * 
 * This file exports all the contracts and types from the bridge PoC.
 * Import from here in your applications:
 * 
 * ```typescript
 * import { zkZECToken, Bridge } from './index.js';
 * ```
 */

// Export the main contracts
export { zkZECToken, Bridge } from './bridge-contracts.js';

// Re-export commonly used o1js types for convenience
export {
  Mina,
  PrivateKey,
  PublicKey,
  Field,
  UInt64,
  UInt32,
  Bool,
  Signature,
  AccountUpdate,
  SmartContract,
  method,
  state,
  State,
  Permissions,
  TokenContract,
} from 'o1js';

import type { PublicKey } from 'o1js';

/**
 * Helper functions for working with the bridge
 */

/**
 * Convert ZEC amount to zkZEC smallest units
 * Assuming 8 decimals (like Bitcoin/Zcash)
 * 
 * @param zecAmount - Amount in ZEC (e.g., 1.5)
 * @returns Amount in smallest units (satoshis)
 */
export function zecToSmallestUnit(zecAmount: number): bigint {
  return BigInt(Math.floor(zecAmount * 100_000_000));
}

/**
 * Convert zkZEC smallest units to ZEC
 * 
 * @param smallestUnits - Amount in smallest units
 * @returns Amount in ZEC
 */
export function smallestUnitToZec(smallestUnits: bigint): number {
  return Number(smallestUnits) / 100_000_000;
}

/**
 * Format a Mina address for display
 * 
 * @param address - PublicKey to format
 * @returns Shortened address string
 */
export function formatAddress(address: PublicKey): string {
  const full = address.toBase58();
  return `${full.slice(0, 6)}...${full.slice(-4)}`;
}

/**
 * Validate a Zcash z-address format (simplified)
 * In production, this would use proper Zcash address validation
 * 
 * @param address - Address string to validate
 * @returns true if valid format
 */
export function isValidZcashAddress(address: string): boolean {
  // Simplified validation - z-addresses start with 'z' and are 78 chars
  return address.startsWith('z') && address.length === 78;
}

/**
 * Configuration constants
 */
export const BRIDGE_CONFIG = {
  // Token symbol
  TOKEN_SYMBOL: 'zkZEC',
  
  // Decimals (matching ZEC)
  DECIMALS: 8,
  
  // Minimum mint amount (0.00000001 ZEC)
  MIN_MINT_AMOUNT: BigInt(1),
  
  // Minimum burn amount (0.00000001 ZEC)
  MIN_BURN_AMOUNT: BigInt(1),
  
  // Zcash confirmation requirement (for future phases)
  ZCASH_CONFIRMATIONS: 6,
  
  // Mina confirmation requirement (for future phases)
  MINA_CONFIRMATIONS: 15,
};

/**
 * Version information
 */
export const VERSION = {
  phase: 1,
  version: '0.1.0',
  name: 'Zcash-Mina Bridge PoC',
  description: 'Privacy-preserving bridge using recursive zero-knowledge proofs',
};