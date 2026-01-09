export const runtime = "nodejs";

function backendUrl() {
  return process.env.PY_BACKEND_URL || "http://127.0.0.1:8001";
}

export async function POST(req: Request) {
  const incoming = await req.formData();
  const file = incoming.get("file");
  const threshold = incoming.get("threshold");
  const candidateBox = incoming.get("candidate_box");
  const documentBox = incoming.get("document_box");

  if (!(file instanceof Blob)) {
    return Response.json(
      { ok: false, error: "Expected multipart form-data with fields: file" },
      { status: 400 }
    );
  }

  const out = new FormData();
  out.append("file", file, "image.jpg");
  if (typeof threshold === "string") out.append("threshold", threshold);
  if (typeof candidateBox === "string") out.append("candidate_box", candidateBox);
  if (typeof documentBox === "string") out.append("document_box", documentBox);

  const res = await fetch(`${backendUrl()}/v1/verify_single`, {
    method: "POST",
    body: out,
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


