import { PrivateKey } from 'o1js';

const key = PrivateKey.random();
console.log('Private Key:', key.toBase58());
console.log('Public Key:', key.toPublicKey().toBase58());
