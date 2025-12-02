import {
    Field,
    UInt64,
    UInt8,
    Signature,
    PrivateKey,
    Mina,
    AccountUpdate,
    Poseidon,
    Provable,
} from 'o1js';
import { Pallas } from './orchard-pallas.js';
import { OrchardVerifier, OrchardProof } from './orchard-verifier.js';
import { OrchardBundle, OrchardAction } from './orchard-types.js';

describe('Native Orchard Verification', () => {
    beforeAll(async () => {
        console.log('Compiling OrchardVerifier...');
        await OrchardVerifier.compile();
        console.log('Compilation complete.');
    });

    it('should instantiate Pallas curve points', () => {
        // Test Pallas generator
        const generator = Pallas.generator;
        expect(generator).toBeDefined();

        // Test scalar multiplication
        const scalar = Pallas.Scalar.from(123n);
        const point = generator.scale(scalar);
        expect(point).toBeDefined();
    });

    it('should verify a valid Orchard bundle', async () => {
        // 1. Setup mock data
        const anchor = Field.random();
        const valueBalance = UInt64.from(100_000);

        // Create binding signature keys (Vesta for demo)
        const signingKey = PrivateKey.random();
        const publicKey = signingKey.toPublicKey();

        // Create mock actions
        const action1 = new OrchardAction({
            nf: Field.random(),
            cmx: Field.random(),
            ephemeralKey: Pallas.generator,
            cv: Pallas.generator,
            rk: publicKey, // Using Vesta PublicKey as per orchard-types.ts update
        });

        const action2 = new OrchardAction({
            nf: Field.random(),
            cmx: Field.random(),
            ephemeralKey: Pallas.generator,
            cv: Pallas.generator,
            rk: publicKey,
        });

        // Create binding signature
        // Message = valueBalance || anchor
        const message = valueBalance.toFields().concat([anchor]);
        const signature = Signature.create(signingKey, message);

        // Create bundle
        const bundle = new OrchardBundle({
            actions: [action1, action2],
            flags: UInt8.from(1),
            valueBalance: valueBalance,
            anchor: anchor,
            bindingSignature: signature,
        });

        // Verify bundle
        const proof = await OrchardVerifier.verifyBundle(anchor, bundle);

        // Check proof output
        expect(proof.publicOutput.valueBalance).toEqual(valueBalance);
        expect(proof.publicOutput.nullifiers[0]).toEqual(action1.nf);
        expect(proof.publicOutput.commitments[0]).toEqual(action1.cmx);

        // Verify the proof itself
        const ok = await OrchardVerifier.verify(proof);
        expect(ok).toBe(true);
    });
});
