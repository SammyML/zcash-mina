import { MerkleMap, Field } from 'o1js';

const map = new MerkleMap();
const key = Field(123);
const witness = map.getWitness(key);

// Check what root we get when we compute with Field(0)
const [root0, extractedKey0] = witness.computeRootAndKey(Field(0));
console.log('Root with value 0:', root0.toString());
console.log('Extracted key:', extractedKey0.toString());
console.log('Original key:', key.toString());
console.log('Empty map root:', map.getRoot().toString());
console.log('Match:', root0.equals(map.getRoot()).toBoolean());
