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
  out.append("file", file, "selfie.jpg");

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const res = await fetch(`${backendUrlValue}/v1/liveness`, {
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


