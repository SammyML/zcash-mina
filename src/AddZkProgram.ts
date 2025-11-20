import { ZkProgram, Field, SelfProof } from 'o1js';

export const AddZkProgram = ZkProgram({
  name: 'add-program',
  publicInput: Field,
  publicOutput: Field,
  methods: {
    init: {
      privateInputs: [],
      async method(publicInput: Field) {
        return { publicOutput: publicInput };
      },
    },

    update: {
      privateInputs: [SelfProof],
      async method(
        publicInput: Field,
        previousProof: SelfProof<Field, Field>
      ) {
        previousProof.verify();
        publicInput.assertEquals(previousProof.publicOutput);
        return { publicOutput: previousProof.publicOutput.add(Field(1)) };
      },
    },
  },
});

export class AddProgramProof extends ZkProgram.Proof(AddZkProgram) {}
