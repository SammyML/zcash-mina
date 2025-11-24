# Quick Testing Guide

## Step 1: Verify Demo Server is Running

The demo server should be running on port 8787. You should see:
```
Demo server listening on http://localhost:8787
```

## Step 2: Test the Server API

Open a new terminal and test the API:

```bash
# Test status endpoint
curl http://localhost:8787/api/status
```

You should see JSON with bridge information.

## Step 3: Start the Demo UI

In a **new terminal** (keep the server running):

```bash
cd apps/demo-ui
npm run dev
```

Wait for Vite to start, then open your browser to **http://localhost:5173**

## Step 4: Test Minting

In the browser UI:
1. Select **Recipient**: user1
2. Enter **Amount**: 0.5
3. Click **"Mint zkZEC"**
4. Wait for transaction to complete (~5 seconds)
5. Verify the stats update

## Step 5: Test Burning

1. Select **Burner**: user1 (who now has zkZEC)
2. Enter **Amount**: 0.25
3. Enter **Zcash Address**: zs1demoaddress... (default is fine)
4. Click **"Burn zkZEC"**
5. Verify the stats update

## Step 6: Verify State Changes

After minting and burning, check:
- **Total Minted** should show the minted amount
- **Total Burned** should show the burned amount
- **Net Locked** should show the difference
- **Nullifier Root** should have changed (not all zeros)

## Step 7: Test Reset

Click **"Reset Demo"** button and verify:
- All stats reset to initial state
- You can mint/burn again

## Alternative: Test Without UI

If you prefer command-line testing:

```bash
# In a new terminal
npm run verify
```

This runs the interaction test which:
- Deploys contracts
- Mints zkZEC
- Burns zkZEC
- Shows bridge statistics

## Troubleshooting

**Server won't start:**
- Check if port 8787 is already in use
- Kill the process: `Get-Process | Where-Object {$_.ProcessName -like "*node*"} | Stop-Process`

**UI won't connect:**
- Make sure server is running on port 8787
- Check browser console for errors
- Verify proxy settings in `apps/demo-ui/vite.config.ts`

**Compilation takes too long:**
- This is normal! First compilation takes 2-3 minutes
- Subsequent operations are faster

## Expected Results

✅ **Server starts** - "Demo server listening on http://localhost:8787"
✅ **UI loads** - Modern interface with bridge stats
✅ **Mint works** - Stats update, no errors
✅ **Burn works** - Stats update, withdrawal event created
✅ **Reset works** - Clean state, can repeat

## Success Criteria

If all of the above work, your POC is **fully functional** and ready for hackathon submission! 🎉
