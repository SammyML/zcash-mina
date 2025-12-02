import { createForeignCurve, Crypto } from 'o1js';

/**
 * Pallas Curve Definition
 * 
 * Defines the Pallas elliptic curve using o1js's createForeignCurve facility.
 * Pallas is the "application curve" for Zcash Orchard and the "base field" for Mina's Vesta curve.
 * This enables native verification of Orchard proofs on Mina.
 */
export class Pallas extends createForeignCurve(Crypto.CurveParams.Pallas) { }
