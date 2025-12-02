import { Struct, Field, UInt8, UInt64, Provable, Signature, PublicKey } from 'o1js';
import { Pallas } from './orchard-pallas.js';

/**
 * Orchard Action Structure
 * 
 * Represents a single Spend + Output action in the Orchard protocol.
 * See: https://zips.z.cash/protocol/protocol.pdf#actionstruct
 */
export class OrchardAction extends Struct({
    // Nullifier (spend) - derived from note
    nf: Field,

    // Commitment (output) - note commitment
    cmx: Field,

    // Ephemeral key for note encryption
    ephemeralKey: Pallas,

    // Value commitment (Pedersen commitment to value)
    cv: Pallas,

    // Randomized verification key (spend authorization)
    // For demo: using Mina PublicKey (Vesta) for binding signature
    rk: PublicKey,
}) { }

/**
 * Orchard Bundle Structure
 * 
 * Represents a bundle of actions with a binding signature and proof.
 * See: https://zips.z.cash/protocol/protocol.pdf#orchardbundle
 */
export class OrchardBundle extends Struct({
    // Actions in this bundle (fixed size for circuit)
    actions: Provable.Array(OrchardAction, 2), // Demo: 2 actions max

    // Bundle flags
    flags: UInt8,

    // Net value change (positive = mint, negative = burn)
    valueBalance: UInt64, // Using UInt64 for simplicity in demo

    // Anchor (Merkle root of commitment tree)
    anchor: Field,

    // Binding signature (verifies balance and authorization)
    // In a full implementation, this would be a RedPallas signature
    // For demo, we use a standard Mina Signature as a placeholder
    bindingSignature: Signature,
}) { }
