# Zcash ⇄ Mina Bridge - Demo

A privacy preserving bridge between Zcash and Mina Protocol using recursive zero-knowledge proofs.

---

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/SammyML/zcash-mina.git
cd zcash-mina
npm install
npm run build
```

### Run the Demo

**Terminal 1 - Backend:**
```bash
npm run demo:server  # takes approx 19mins for compilation on my local machine
```

**Terminal 2 - Frontend:**
```bash
npm run demo:ui
```

**Access:** Open http://localhost:5173

---

## Demo Features

### Minting zkZEC
1. Select a recipient (user1 or user2)
2. Enter amount in ZEC (e.g., 0.5)
3. Click "Mint zkZEC"
4. Watch the bridge verify the proof and mint tokens

### Burning zkZEC
1. Select a burner account
2. Enter amount to burn
3. Provide Zcash z-address
4. Click "Burn zkZEC"
5. Creates withdrawal request
6. **Note**: The demo simulates the 24h timelock by advancing the blockchain time automatically.

### Live Statistics
- **Nullifier Root**: Merkle root of spent nullifiers
- **Bridge Status**: Live/Paused
- **Total Minted**: Total zkZEC minted
- **Total Burned**: Total zkZEC burned
- **Net Locked**: ZEC locked in the bridge

---

## Technical Architecture

### Core Components

**1. ZkPrograms**
- `ZcashVerifier`: Verifies Zcash shielded transaction proofs
- `OrchardVerifier`: Native Pallas/Vesta verification circuit
- `LightClient`: Tracks Zcash blockchain headers

**2. Smart Contracts**
- `BridgeV3`: Main bridge contract with nullifier tracking
- `zkZECToken`: Mina token representing wrapped ZEC

**3. Privacy Features**
- Nullifier set prevents double-spending
- Merkle proofs for efficient verification
- Transaction hash tracking prevents replays

---

## Configuration

### Mock Mode (Default)
```bash
npm run demo:server
```
Generates mock Zcash proofs for quick, reliable testing.

### Testnet Mode (Optional)

**Note:** Zcash testnet integration requires an RPC endpoint. Public endpoints require API keys.

**To use testnet mode:**
1. Get a free API key from [Tatum.io](https://tatum.io) or [GetBlock.io](https://getblock.io)
2. Configure your endpoint:

```bash
# Windows PowerShell
$env:ZCASH_MODE="testnet"
$env:ZCASH_RPC_URL="YOUR_RPC_ENDPOINT_HERE"
npm run demo:server

# Linux/Mac
export ZCASH_MODE=testnet
export ZCASH_RPC_URL=YOUR_RPC_ENDPOINT_HERE
npm run demo:server
```

**The demo works perfectly in mock mode without testnet access.**


## Key Features

**Production-Ready Code:**
- Full ZkProgram implementation for recursive proofs
- Complete Zcash proof verification logic
- Nullifier tracking and double-spend prevention

**Demo Configuration:**
- Uses `proofsEnabled: false` for speed
- Mock proofs for reliable demonstration
- Automatic fallback if testnet RPC fails

**Why Mock Proofs for Demo:**
- Fast: Instant minting/burning
-  Reliable: No external dependencies
- Free: No API keys required
- Deployable: Works on free hosting tiers

---

## Troubleshooting

### Server Won't Start
- Check Node.js version: `node --version` (need 18+)
- Clear build: `rm -rf build && npm run build`
- Check port 8787 is free

### UI Can't Connect
- Verify backend is running on port 8787
- Check `VITE_API_URL` in production
- Look for CORS errors in browser console

### Mint/Burn Fails
- Check browser console for errors
- Verify backend logs for details
- Try resetting demo: POST to `/api/reset`

---



**What makes this POC special:**

1. **Real ZkProgram Code**: Production ready recursive proof verification
2. **Zcash Integration**: Parses real Zcash transaction structure
3. **Privacy Preservation**: Nullifier tracking prevents double-spends
4. **Live Demo**: Fully deployed and accessible
5. **Comprehensive Documentation**: Clear architecture and implementation

**Try it yourself:**
- Clone the repo
- Run `npm install && npm run build`
- Start demo: `npm run demo:server` (Terminal 1)
- Start UI: `npm run demo:ui` (Terminal 2)
- Mint and burn zkZEC

---

## Technical Highlights

### Recursive Proofs
- Batch verification support
- Constant-size proofs regardless of transaction count
- O(1) verification time

### State Management
- Off-chain Merkle maps sync with on-chain state
- Strict synchronization checks prevent errors
- Efficient witness generation

### Smart Contract Design
- Modular architecture
- Emergency pause mechanism
- Event emission for indexing

---

## Resources

- **Repository**: [GitHub](https://github.com/SammyML/zcash-mina)
- **Documentation**: See `README.md`
- **License**: Apache-2.0

---

## Notes

**Proof System:**
- The underlying ZkProgram code is production-ready
- Demo uses mock proofs for practical demonstration
- Can be switched to real proofs by setting `proofsEnabled: true`

**Testnet Integration:**
- Requires RPC endpoint with API key
- Automatic fallback to mock mode
- Parses real Zcash transaction bytes when available
