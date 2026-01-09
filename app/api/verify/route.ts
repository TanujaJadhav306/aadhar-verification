export const runtime = "nodejs";

function backendUrl() {
  return process.env.PY_BACKEND_URL || "http://127.0.0.1:8001";
}

export async function POST(req: Request) {
  const incoming = await req.formData();
  const document = incoming.get("document");
  const selfie = incoming.get("selfie");
  const threshold = incoming.get("threshold");
  const runLiveness = incoming.get("run_liveness");

  if (!(document instanceof Blob) || !(selfie instanceof Blob)) {
    return Response.json(
      { ok: false, error: "Expected multipart form-data with fields: document, selfie" },
      { status: 400 }
    );
  }

  const out = new FormData();
  out.append("document", document, "document.jpg");
  out.append("selfie", selfie, "selfie.jpg");
  if (typeof threshold === "string") out.append("threshold", threshold);
  if (typeof runLiveness === "string") out.append("run_liveness", runLiveness);

  const res = await fetch(`${backendUrl()}/v1/verify`, {
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


