# Zcash ⇄ Mina Bridge

Privacy preserving asset bridge that lets shielded Zcash value flow into Mina’s zk-smart-contract ecosystem. Built in phases:

1. **Phase 1:** Custom `zkZECToken` + simple `Bridge` contract for mint/burn with operator signatures.
2. **Phase 2:** `ZcashVerifier` ZkProgram verifies shielded proofs (nullifiers, commitments, value balance) recursively.
3. **Phase 3:** `LightClient` ZkProgram tracks Zcash headers inside Mina; `BridgeV3` ties light-client state, nullifier sets, and withdrawal queue into one trust-minimized contract.

## Repo Tour
| Path | Purpose |
| --- | --- |
| `src/bridge-contracts.ts` | Phase‑1 `zkZECToken` + simple bridge. |
| `src/zcash-verifier.ts` | Recursive ZkProgram for shielded proof batches. |
| `src/light-client.ts` | Recursive light client for Zcash headers/transactions. |
| `src/bridge-v3-complete.ts` | Full Phase‑3 bridge with light-client inputs, nullifier sets, processed tx root, withdrawal queue. |
| `src/test-interaction.ts` | Scripted demo of the Phase‑1 flow (deploy → mint → burn → stats). |
| `src/test.ts` | Jest-style test harness covering all phases (compiles; Windows Node flags still pending for runtime). |

## Quickstart

```bash
npm install
npm run build        # TypeScript → build/
npm run interact     # deploy/mint/burn on LocalBlockchain
```

[Apache-2.0](LICENSE)
