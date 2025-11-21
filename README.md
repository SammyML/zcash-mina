# Zcash ⇄ Mina Bridge (proof of concept for zypherpunk hackathon)

Privacy preserving asset bridge that lets shielded Zcash value flow into Mina’s zk-smart-contract ecosystem:

1. **phase 1:** `zkZECToken` + simple `Bridge` contract for mint/burn with operator signatures.
2. **phase 2:** `ZcashVerifier` ZkProgram verifies shielded proofs (nullifiers, commitments, value balance) recursively.
3. **phase 3:** `LightClient` ZkProgram tracks Zcash headers inside Mina; `Bridge` ties light-client state, nullifier sets, and withdrawal queue into one trust-minimized contract.

## Repos
| Path | use |
| --- | --- |
| `src/bridge-contracts.ts` | Phase‑1 `zkZECToken` + simple bridge. |
| `src/zcash-verifier.ts` | Recursive ZkProgram for shielded proof batches. |
| `src/light-client.ts` | Recursive light client for Zcash headers/transactions. |
| `src/bridge.ts` | bridge with light-client inputs, nullifier sets, processed tx root, withdrawal queue. |
| `src/test-interaction.ts` | demo of the initial flow (deploy -> mint -> burn -> stats). |
| `src/test.ts` | Jest-style test harness covering all phases (compiles; Windows Node flags still pending for runtime). |

## Quickstart

```bash
npm install
npm run build        # TypeScript -> build/
npm run interact     # deploy/mint/burn on LocalBlockchain
```

The interaction script logs each step (accounts, deploys, mint/burn, bridge stats).

## CLI Commands

The deployment and management workflows are exposed via `npm run bridge -- <command>`:

```
npm run bridge -- deploy local
npm run bridge -- deploy devnet
npm run bridge -- mint devnet <zcashTxHash> <recipient> <amount>
npm run bridge -- burn devnet <amount> <zcashAddr> <keyPath>
npm run bridge -- update devnet <startHeight> <endHeight>
npm run bridge -- stats devnet
```

- `deploy local` spins up the initial bridge (`zkZECToken` + basic `Bridge`) on Mina’s `LocalBlockchain`.
- `deploy devnet` (and other remote networks) compiles `Bridge`, the recursive verifier, and the light client; make sure `config/<network>.json` plus key files exist.
- The `mint`, `burn`, `update`, and `stats` commands are disabled on the mock local network because that chain is reset each run. Use `npm run interact` locally instead.

## Tests

- `npm test` runs lightweight checks and skips the heavy recursive-proof suite.
- `RUN_FULL_TESTS=true npm test` executes the entire suite (expect multi-minute runs and high CPU usage).



## Architecture Highlights

1. `zkZECToken` extends Mina’s `TokenContract`, enforcing proof only mint/burn.
2. Phase 1 uses operator signatures, Phase 2 swaps signatures for recursive Zcash proof verification, Phase 3 adds a recursive light client plus nullifier and withdrawal bookkeeping.
3. Zcash privacy is preserved end-to-end: Mina only sees proof outputs and minted zkZEC, never shielded transaction contents.
4. Once zkZEC exists on Mina, any zkApp can integrate it for lending, swaps, or more advanced zk workflows without trusting a custodian.

## License

[Apache-2.0](LICENSE)
