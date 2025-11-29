# Zcash-Mina Bridge 

> **Hackathon Submission**: Working POC of a Privacy-Preserving Bridge Between Zcash and Mina

## Quick Demo (Start Here!)

**Want to see it in action? Run the demo in 3 commands:**

```bash
npm install && npm run build
npm run demo:server          # Terminal 1: Start backend
```

Then in a new terminal:
```bash
cd apps/demo-ui && npm install && npm run dev    # Terminal 2: Start UI
```

Open **http://localhost:5173** and try minting/burning zkZEC

> **Update**: The "Invalid nullifier witness" error has been resolved. The demo server now includes robust state synchronization checks to ensure smooth minting operations.

**Full demo guide**: See [walkthrough.md](walkthrough.md) for detailed walkthrough.

---

## What This POC Demonstrates

- **Production-Ready ZK Implementation** - Real recursive ZkPrograms (demo uses mock proofs for speed)
- **Privacy Preservation** - Zcash nullifier tracking prevents double-spends  
- **Mina's Unique Features** - Recursive ZkPrograms for constant-size proofs  
- **Zcash Testnet Integration** - Fetches and parses real Zcash testnet transactions
- **Working Code** - Full mint/burn flow works end-to-end  
- **Easy to Demo** - Browser-based UI, no complex setup  

## Architecture

![Zcash-Mina Bridge Architecture](docs/architecture.png)

Privacy preserving asset bridge that lets shielded Zcash value flow into Mina's zk-smart-contract ecosystem. The diagram above shows the complete flow of the bridge system, including:

- **Zcash Chain**: Shielded transactions with blocks
- **ZcashVerifier**: Recursive ZkProgram for proof verification (verifySingle/verifyBatch)
- **LightClient**: ZkProgram for tracking Zcash headers and blocks
- **Bridge Smart Contract**: State management (token, totals, nullifier root, processed root, withdrawal queue, pause flag)
- **zkZECToken**: Token contract for internal mint/burn operations
- **Guardians**: Off-chain operations monitoring events and releasing ZEC
- **Mina Users**: Hold/spend zkZEC in zkApps

## Project Structure
| Path | Description |
| --- | --- |
| `src/bridge-contracts.ts` | zkZEC token contract |
| `src/bridge.ts` | BridgeV3 contract with full verification |
| `src/zcash-verifier.ts` | Recursive ZkProgram for Zcash proof verification |
| `src/light-client.ts` | Recursive light client for Zcash blockchain |
| `src/zcash-rpc.ts` | **NEW:** RPC client for Zcash testnet integration |
| `src/demo-server.ts` | Demo server with mock/testnet modes |
| `src/test-interaction.ts` | Interactive demo script |
| `apps/demo-ui` | React UI for the bridge |
| `DEPLOYMENT.md` | **NEW:** Deployment guide for Railway + Vercel |

## Quickstart

```bash
npm install
npm run build        # TypeScript -> build/
npm run interact     # deploy/mint/burn on LocalBlockchain
```

The interaction script logs each step (accounts, deploys, mint/burn, bridge stats).

## Zcash Testnet Integration

The bridge supports two modes:

### Mock Mode (Default)
```bash
export ZCASH_MODE=mock
npm run demo:server
```
Generates mock Zcash proofs for quick testing.

### Testnet Mode (Optional)

**Note:** Zcash testnet integration requires an RPC endpoint. Public endpoints require API keys.

**To use testnet mode:**
1. Get a free API key from [Tatum.io](https://tatum.io) or [GetBlock.io](https://getblock.io)
2. Set your RPC endpoint:

```bash
export ZCASH_MODE=testnet
export ZCASH_RPC_URL=YOUR_RPC_ENDPOINT_HERE
npm run demo:server
```

**The demo works perfectly in mock mode without testnet access.**

**Features:**
- Real transaction fetching via RPC (when configured)
- Automatic fallback to mock mode if RPC fails
- Parses raw Zcash transaction bytes
- Extracts nullifiers and commitments from real data

## CLI Commands

The deployment and management workflows are exposed via `npm run bridge -- <command>`:

```
npm run bridge -- deploy local
npm run bridge -- deploy devnet
npm run bridge -- mint devnet <zcashTxHash> <recipient>
npm run bridge -- burn devnet <amount> <zcashAddr> <keyPath>
npm run bridge -- update devnet <startHeight> <endHeight>
npm run bridge -- stats devnet
```

- `deploy local` spins up the initial bridge (`zkZECToken` + basic `Bridge`) on Mina’s `LocalBlockchain`.
- `deploy devnet` (and other remote networks) compiles `Bridge`, the recursive verifier, and the light client; make sure `config/<network>.json` plus key files exist.
- The `mint`, `burn`, `update`, and `stats` commands are disabled on the mock local network because that chain is reset each run. Use `npm run interact` locally instead.


## Demo Dashboard

CLI:

```
npm install
npm run build
npm run demo:server        # spins up the Mina LocalBlockchain + REST API on :8787

# in a new terminal
cd apps/demo-ui
npm install
npm run dev                # launches the Vite dashboard on :5173 (proxied to :8787)
```

The dashboard lets you:

- Inspect live contract addresses, minted/burned totals, and queue depth.
- Mint zkZEC into the bridge with one click (server signs with the operator key).
- Burn zkZEC into a withdrawal request tied to a Sapling/Unified address string.
- Reset the sandbox to replay the full flow.
- The UI targets the `Bridge` contract on Mina’s `LocalBlockchain`, so every click maps to the same operator-signed mint/burn transactions used in `src/test-interaction.ts`.

**Note:** The demo runs with `proofsEnabled: false` for speed and resource efficiency. The underlying ZkPrograms are production ready and can generate real proofs when `proofsEnabled: true`.

## Technical Details

**Proof System:**
- Production ready recursive ZkPrograms
- Demo uses `proofsEnabled: false` for speed (mock proofs)
- Set `proofsEnabled: true` for real cryptographic proofs
- Batch verification for efficiency
- Nullifier set tracking

**The demo uses mock proofs for:**
- Fast demonstrations (instant vs 30-60s per transaction)
- Low resource requirements (1GB vs 4-8GB RAM)
- Deployment on free hosting tiers( ran out of memory using railway free tier)

**The code supports real proofs:**
- Full ZkProgram implementations in `src/zcash-verifier.ts` and `src/light-client.ts`
- Cryptographic proof verification in `BridgeV3.mintWithFullVerification()`
- Test suite with `RUN_FULL_TESTS=true` runs with real proofs

## Architecture Highlights

1. `zkZECToken` extends Mina’s `TokenContract`, enforcing proof-only mint/burn hooks.
2. The recursive `ZcashVerifier` now hashes raw transaction bytes into deterministic nullifiers, commitments, and the minted amount, preventing callers from forging arbitrary values.
3. `BridgeV3.mintWithFullVerification` derives the mint amount from the proof and enforces nullifier/tx-set membership before minting, keeping double spends out of the Mina side.
4. The light client path supports JSON-RPC fed Zcash headers so you can point the PoC at either a local zebra/zcashd node or the default deterministic mock generator.
5. The React dashboard + REST shim provide the “easily demoable” UX 

## License

[Apache-2.0](LICENSE)
