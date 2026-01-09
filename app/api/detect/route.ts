export const runtime = "nodejs";

function backendUrl() {
  return process.env.PY_BACKEND_URL || "http://127.0.0.1:8001";
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

  const out = new FormData();
  out.append("file", file, "image.jpg");
  if (typeof scoreThreshold === "string") out.append("score_threshold", scoreThreshold);

  const res = await fetch(`${backendUrl()}/v1/detect`, { method: "POST", body: out });
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
}


