# Aadhar-Verification (Next.js UI + Python ArcFace Service)

Next.js demo UI to verify a candidate **before starting an assessment** by:
- Uploading an **ID document image** (India: Aadhaar card, US: Driving License)
- Capturing a **live selfie** (webcam)
- Running **face detection** in the browser (optional UX)
- Running **face match (ArcFace embeddings)** + **basic liveness checks** in a Python service

## Run (Windows / PowerShell)

### 1) Start Python face-match service (OpenCV YuNet + SFace)

```powershell
cd "C:\Users\tanuja.jadhav\OneDrive - Ampcus Tech Pvt Ltd\Desktop\Aadhar-Verification"

py -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
.\.venv\Scripts\python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8001
```

Health check: `http://127.0.0.1:8001/health`

### 2) Start Next.js UI

Open a second terminal:

```powershell
cd "C:\Users\tanuja.jadhav\OneDrive - Ampcus Tech Pvt Ltd\Desktop\Aadhar-Verification"
npm install
npm run download-models
npm run dev
```

Open UI: `http://localhost:3000`

## Notes

- The Python service uses **OpenCV YuNet (face detection) + SFace (face embeddings)** and returns:
  - `similarity` (cosine similarity)
  - `isMatch` + `threshold`
  - `matchPercent` (UI-friendly percent)
  - `liveness` (basic passive checks: blur/brightness/face-size + single-face)
- The UI supports **two modes**:
  - **Two images**: upload document image + capture selfie → calls `POST /v1/verify`
  - **Single image (selfie holding ID)**: upload/capture one photo containing both faces (candidate + ID portrait) → calls `POST /v1/verify_single`
- For production you'll want: a real anti-spoof model, stronger liveness, audited thresholds, retention policies, and legal/compliance review (Aadhaar is regulated).

## Deployment

**Want to deploy this for free?** See [DEPLOYMENT.md](./DEPLOYMENT.md) for step-by-step instructions.

Quick deploy:
- **Frontend**: Deploy on [Vercel](https://vercel.com) (free)
- **Backend**: Deploy on [Render](https://render.com) (free)

See [QUICK_DEPLOY.md](./QUICK_DEPLOY.md) for a fast checklist.

## If you get `EINVAL ... readlink .next\\server\\...` on Windows

1) Run:

```powershell
npm run clean
```

2) Run `npm run dev` again.

If you specifically want to auto-clean once before starting dev, use:

```powershell
npm run dev:clean
```

3) If the error still happens, move the project **out of OneDrive** (example `C:\Projects\Aadhar-Verification`) and run the commands again. OneDrive sync/virtualization can break `.next` file operations on some machines.

## Configure backend URL (optional)

By default the UI calls the Python service at `http://127.0.0.1:8001`.

To change it, set an environment variable before `npm run dev`:

```powershell
$env:PY_BACKEND_URL="http://127.0.0.1:8001"
npm run dev
```


