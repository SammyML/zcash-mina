# Deployment Guide

## Prerequisites
- GitHub account
- Railway account (https://railway.app) - Free tier available
- Vercel account (https://vercel.com) - Free tier available

## Step 1: Deploy Backend to Railway

1. **Push Code to GitHub**
   ```bash
   git add .
   git commit -m "Add testnet integration and deployment configs"
   git push origin main
   ```

2. **Create Railway Project**
   - Go to https://railway.app
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your `zcash-mina` repository

3. **Configure Environment Variables**
   In Railway dashboard, add:
   ```
   DEMO_PORT=8787
   ZCASH_MODE=mock
   NODE_VERSION=18
   ```

4. **Deploy**
   - Railway will auto-deploy
   - Note your backend URL (e.g., `https://zcash-mina-production.up.railway.app`)

## Step 2: Deploy Frontend to Vercel

1. **Create Vercel Project**
   - Go to https://vercel.com
   - Click "Add New Project"
   - Import your GitHub repository

2. **Configure Build Settings**
   - Framework Preset: Vite
   - Root Directory: `apps/demo-ui`
   - Build Command: `npm run build`
   - Output Directory: `dist`

3. **Add Environment Variable**
   ```
   VITE_API_URL=<your-railway-backend-url>
   ```

4. **Deploy**
   - Vercel will auto-deploy
   - Your frontend URL: `https://zcash-mina.vercel.app`

## Step 3: Test Deployment

1. Visit your Vercel URL
2. Try minting zkZEC
3. Verify statistics update
4. Check Railway logs for any errors

## Troubleshooting

**Backend won't start:**
- Check Railway logs
- Verify `NODE_VERSION=18` is set
- Ensure build completed successfully

**Frontend can't connect to backend:**
- Verify `VITE_API_URL` is set correctly
- Check CORS headers in `demo-server.ts`
- Ensure Railway backend is running

**Testnet mode not working:**
- Set `ZCASH_MODE=testnet` in Railway
- Add `ZCASH_RPC_URL` if using custom endpoint
- Check logs for RPC connection errors

## Enable Testnet Mode (Optional)

To use real Zcash testnet data in production:

1. In Railway, update environment variables:
   ```
   ZCASH_MODE=testnet
   ZCASH_RPC_URL=https://testnet.zcash.com
   ```

2. Redeploy the backend

3. Monitor logs to verify testnet transactions are being fetched

## Next Steps

- Add your deployment URL to README.md
- Share the live demo link with hackathon judges
- Monitor Railway usage (free tier has limits)
