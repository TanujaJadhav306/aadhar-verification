# Free Deployment Guide - Aadhaar Verification App

This guide will help you deploy both the **Next.js frontend** and **Python backend** for free.

## Architecture

- **Frontend (Next.js)**: Deploy on **Vercel** (free tier)
- **Backend (Python FastAPI)**: Deploy on **Render** (free tier)

---

## Prerequisites

1. **GitHub Account** (free) - https://github.com
2. **Vercel Account** (free) - https://vercel.com
3. **Render Account** (free) - https://render.com

---

## Step 1: Push Code to GitHub

### 1.1 Create a GitHub Repository

1. Go to https://github.com/new
2. Create a new repository (e.g., `aadhar-verification`)
3. **Don't** initialize with README (we already have files)

### 1.2 Push Your Code

Open PowerShell/Terminal in your project folder and run:

```powershell
# Initialize git (if not already done)
git init

# Add all files
git add .

# Commit
git commit -m "Initial commit - ready for deployment"

# Add your GitHub repository (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push to GitHub
git branch -M main
git push -u origin main
```

**Important**: Make sure `.gitignore` excludes:
- `node_modules/`
- `.next/`
- `.venv/`
- `__pycache__/`
- `data/` (if it contains test images)

---

## Step 2: Deploy Python Backend on Render

### 2.1 Create Render Account

1. Go to https://render.com
2. Sign up with GitHub (recommended) or email
3. Verify your email

### 2.2 Create New Web Service

1. Click **"New +"** → **"Web Service"**
2. Connect your GitHub repository
3. Select your repository

### 2.3 Configure Backend Service

**Settings:**
- **Name**: `aadhar-verification-backend` (or any name)
- **Environment**: `Python 3`
- **Build Command**: 
  ```bash
  pip install -r backend/requirements.txt && python -c "from backend.app.services.opencv_sface import ensure_models; ensure_models()"
  ```
- **Start Command**: 
  ```bash
  uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT
  ```
- **Plan**: Select **"Free"**

### 2.4 Add Environment Variable

In the **Environment** section, add:
- **Key**: `FRONTEND_URL`
- **Value**: `https://your-app-name.vercel.app` (we'll update this after deploying frontend)

**Note**: You can leave this empty for now and update it later.

### 2.5 Deploy

1. Click **"Create Web Service"**
2. Wait for deployment (5-10 minutes for first build)
3. **Copy the service URL** (e.g., `https://aadhar-verification-backend.onrender.com`)

### 2.6 Test Backend

Visit: `https://your-backend-url.onrender.com/health`

Should return: `{"ok": true}`

---

## Step 3: Deploy Next.js Frontend on Vercel

### 3.1 Create Vercel Account

1. Go to https://vercel.com
2. Sign up with GitHub (recommended)

### 3.2 Import Project

1. Click **"Add New..."** → **"Project"**
2. Import your GitHub repository
3. Select your repository

### 3.3 Configure Frontend

**Settings:**
- **Framework Preset**: Next.js (auto-detected)
- **Root Directory**: `./` (root)
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)

### 3.4 Add Environment Variable

In **Environment Variables**, add:
- **Key**: `PY_BACKEND_URL`
- **Value**: `https://your-backend-url.onrender.com` (from Step 2.5)

**⚠️ CRITICAL**: 
- **DO NOT** include `/health` or any path in the URL
- Use only the base URL: `https://aadhar-verification.onrender.com` ✅
- **NOT**: `https://aadhar-verification.onrender.com/health` ❌
- The API routes automatically append `/v1/verify`, `/v1/detect`, etc.
- Make sure to add this for **Production**, **Preview**, and **Development** environments

### 3.5 Deploy

1. Click **"Deploy"**
2. Wait for build (2-5 minutes)
3. **Copy your frontend URL** (e.g., `https://aadhar-verification.vercel.app`)

---

## Step 4: Update CORS in Backend

### 4.1 Update Render Environment Variable

1. Go back to **Render Dashboard**
2. Select your backend service
3. Go to **Environment** tab
4. Update `FRONTEND_URL` to your Vercel URL:
   ```
   https://your-app-name.vercel.app
   ```
5. Click **"Save Changes"**
6. Render will automatically redeploy

---

## Step 5: Test Your Deployment

1. Visit your **Vercel frontend URL**
2. Try capturing/uploading an image
3. Check if face detection and verification work

### Troubleshooting

**If you see CORS errors:**
- Make sure `FRONTEND_URL` in Render matches your Vercel URL exactly
- Wait for backend to redeploy after updating environment variable

**If backend returns 404 (especially `/health/v1/verify` or `/health/v1/detect`):**
- **This means `PY_BACKEND_URL` includes `/health` in the URL** ❌
- Check your Vercel environment variable: `PY_BACKEND_URL`
- It should be: `https://aadhar-verification.onrender.com` ✅
- **NOT**: `https://aadhar-verification.onrender.com/health` ❌
- The API routes automatically append `/v1/verify`, `/v1/detect`, etc.
- Fix: Update `PY_BACKEND_URL` in Vercel → Settings → Environment Variables
- After updating, redeploy your Vercel app

**If backend returns 404 (general):**
- Check that the backend URL in Vercel environment variable is correct
- Make sure backend service is running (check Render dashboard)

**If API routes return 404 (e.g., `/api/verify` not found):**
1. **Check Vercel Build Logs:**
   - Go to your Vercel project → Deployments → Click on the latest deployment
   - Check the "Build Logs" tab for any errors
   - Look for TypeScript compilation errors or build failures

2. **Verify Route Files Exist:**
   - Ensure `app/api/verify/route.ts` and other route files are committed to Git
   - Check that routes are in the correct location: `app/api/[route-name]/route.ts`

3. **Redeploy:**
   - Go to Vercel Dashboard → Your Project → Deployments
   - Click "Redeploy" on the latest deployment
   - Or push a new commit to trigger a fresh build

4. **Check Build Output:**
   - After deployment, check if `.next/server/app/api/verify` exists in build output
   - You can check this in Vercel's build logs

5. **Test Route Directly:**
   - Try accessing `https://your-app.vercel.app/api/verify` with GET request (should return a health check)
   - This helps verify if the route is deployed

6. **Clear Vercel Cache:**
   - In Vercel Dashboard → Settings → General
   - Try "Clear Build Cache" and redeploy

7. **Verify Next.js Version:**
   - Ensure you're using Next.js 13+ (App Router is required)
   - Check `package.json` for correct Next.js version

**If models fail to download:**
- Render free tier may have network restrictions
- Check Render logs for download errors
- Models should auto-download on first build

---

## Step 6: Share with Your Senior

Send them:
1. **Frontend URL**: `https://your-app-name.vercel.app`
2. **Backend URL** (optional): `https://your-backend-url.onrender.com/health`

---

## Free Tier Limitations

### Vercel (Frontend)
- ✅ Unlimited deployments
- ✅ 100GB bandwidth/month
- ⚠️ Functions timeout: 10 seconds (Hobby plan)
- ⚠️ No serverless function logs after 24 hours

### Render (Backend)
- ✅ 750 hours/month free
- ⚠️ **Service spins down after 15 minutes of inactivity**
- ⚠️ First request after spin-down takes ~30-60 seconds (cold start)
- ⚠️ Auto-spins down to save free tier hours

**Note**: For production/demo, consider upgrading to paid plans or use alternative free services like Railway, Fly.io, or PythonAnywhere.

---

## Alternative: Railway (Both Services)

Railway offers a simpler deployment for both services:

1. Go to https://railway.app
2. Sign up with GitHub
3. Create new project → Deploy from GitHub
4. Add two services:
   - **Frontend**: Select `package.json` → Auto-detects Next.js
   - **Backend**: Select `backend/requirements.txt` → Auto-detects Python

Railway free tier: $5 credit/month (usually enough for small demos).

---

## Quick Reference: URLs to Update

After deployment, update these:

1. **Vercel Environment Variable**:
   - `PY_BACKEND_URL` = `https://your-backend.onrender.com`

2. **Render Environment Variable**:
   - `FRONTEND_URL` = `https://your-app.vercel.app`

---

## Need Help?

- **Vercel Docs**: https://vercel.com/docs
- **Render Docs**: https://render.com/docs
- **Check logs**: Both platforms provide build and runtime logs

---

**Good luck with your deployment! 🚀**

