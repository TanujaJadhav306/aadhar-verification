export const runtime = "nodejs";

function backendUrl() {
  return process.env.PY_BACKEND_URL || "http://127.0.0.1:8001";
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

  const out = new FormData();
  out.append("file", file, "selfie.jpg");

  const res = await fetch(`${backendUrl()}/v1/liveness`, {
    method: "POST",
    body: out
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { ok: false, error: text || "Backend returned non-JSON response." };
  }

  return Response.json(json, { status: res.status });
}


