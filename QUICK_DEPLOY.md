# Quick Deployment Checklist

## Before You Start
- [ ] Code is pushed to GitHub
- [ ] You have accounts on Vercel and Render (both free)

## Backend (Render) - 10 minutes

1. **Go to**: https://render.com
2. **New** → **Web Service** → Connect GitHub repo
3. **Settings**:
   - Name: `aadhar-backend`
   - Build: `pip install -r backend/requirements.txt && python -c "from backend.app.services.opencv_sface import ensure_models; ensure_models()"`
   - Start: `uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT`
   - Plan: **Free**
4. **Deploy** → Wait 5-10 min
5. **Copy URL**: `https://your-backend.onrender.com` ✅

## Frontend (Vercel) - 5 minutes

1. **Go to**: https://vercel.com
2. **Add New** → **Project** → Import GitHub repo
3. **Environment Variable**:
   - Key: `PY_BACKEND_URL`
   - Value: `https://your-backend.onrender.com` (from step above)
4. **Deploy** → Wait 2-5 min
5. **Copy URL**: `https://your-app.vercel.app` ✅

## Update Backend CORS

1. **Render Dashboard** → Your backend service
2. **Environment** tab → Add/Update:
   - Key: `FRONTEND_URL`
   - Value: `https://your-app.vercel.app` (from Vercel)
3. **Save** → Auto-redeploys

## Test

Visit: `https://your-app.vercel.app`

Should work! 🎉

---

## Common Issues

**"Backend not found"**
- Check `PY_BACKEND_URL` in Vercel matches Render URL exactly

**CORS error**
- Update `FRONTEND_URL` in Render to match Vercel URL
- Wait for redeploy

**Slow first request**
- Render free tier spins down after 15 min inactivity
- First request takes 30-60 seconds (cold start)

