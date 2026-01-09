export const runtime = "nodejs";

function backendUrl() {
  const url = process.env.PY_BACKEND_URL || "http://127.0.0.1:8001";
  
  // Check if we're in production and backend URL is not configured
  if (process.env.VERCEL && !process.env.PY_BACKEND_URL) {
    throw new Error(
      "PY_BACKEND_URL environment variable is not set. " +
      "Please configure it in Vercel: Settings → Environment Variables → Add PY_BACKEND_URL with your backend URL (e.g., https://your-backend.onrender.com)"
    );
  }
  
  return url;
}

export async function POST(req: Request) {
  const incoming = await req.formData();
  const file = incoming.get("file");
  const scoreThreshold = incoming.get("score_threshold");

  if (!(file instanceof Blob)) {
    return Response.json(
      { ok: false, error: "Expected multipart form-data with field: file" },
      { status: 400 }
    );
  }

  let backendUrlValue: string;
  try {
    backendUrlValue = backendUrl();
  } catch (error: any) {
    return Response.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const out = new FormData();
  out.append("file", file, "image.jpg");
  if (typeof scoreThreshold === "string") out.append("score_threshold", scoreThreshold);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const res = await fetch(`${backendUrlValue}/v1/detect`, { 
      method: "POST", 
      body: out,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { ok: false, error: text || "Backend returned non-JSON response." };
    }

    // Add labels for which detected face is which:
    // - candidate = largest face box
    // - document = smallest face box (often ID portrait)
    if (res.ok && json?.ok && Array.isArray(json.boxes)) {
      const boxes = json.boxes
        .map((b: any) => ({
          x: Number(b.x),
          y: Number(b.y),
          w: Number(b.w),
          h: Number(b.h),
          score: typeof b.score === "number" ? b.score : Number(b.score),
        }))
        .filter((b: any) => Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.w) && Number.isFinite(b.h));

      const areas = boxes.map((b: any) => b.w * b.h);
      const faceCount = Number(json.faceCount ?? boxes.length ?? 0);

      let candidateIndex: number | null = null;
      let documentIndex: number | null = null;
      if (boxes.length >= 1) {
        candidateIndex = areas.indexOf(Math.max(...areas));
      }
      if (boxes.length >= 2) {
        documentIndex = areas.indexOf(Math.min(...areas));
      }

      return Response.json(
        {
          ok: true,
          faceCount,
          boxes,
          candidateIndex,
          documentIndex,
          candidateBox: candidateIndex != null ? boxes[candidateIndex] : null,
          documentBox: documentIndex != null ? boxes[documentIndex] : null,
        },
        { status: res.status }
      );
    }

    return Response.json(json, { status: res.status });
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return Response.json(
        { ok: false, error: "Request timeout: Backend did not respond within 30 seconds. The backend service might be spinning up (cold start). Please try again." },
        { status: 504 }
      );
    }
    
    if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')) {
      return Response.json(
        { 
          ok: false, 
          error: `Cannot connect to backend at ${backendUrlValue}. ` +
                 `Please verify that PY_BACKEND_URL is set correctly and the backend service is running. ` +
                 `If using Render free tier, the service may be spinning up (first request takes 30-60 seconds).`
        },
        { status: 503 }
      );
    }
    
    return Response.json(
      { ok: false, error: error.message || "Failed to connect to backend service." },
      { status: 500 }
    );
  }
}


