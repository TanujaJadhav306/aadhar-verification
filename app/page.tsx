"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FaceBox = { x: number; y: number; w: number; h: number; score?: number };

type VerifyResult =
  | {
      ok: true;
      similarity?: number;
      threshold: number;
      isMatch: boolean;
      matchPercent: number;
      engine?: string;
      faceCount?: number;
      documentFaceCount?: number;
      selfieFaceCount?: number;
      // documentBox?: FaceBox;
      // candidateBox?: FaceBox;
    }
  | {
      ok: false;
      error: string;
    };

type DetectResult =
  | {
      ok: true;
      faceCount: number;
      boxes?: FaceBox[];
    }
  | {
      ok: false;
      faceCount: number;
      error: string;
    };

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function getImageSizeFromDataUrl(
  dataUrl: string
): Promise<{ w: number; h: number }> {
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
  });
  return {
    w: img.naturalWidth || img.width,
    h: img.naturalHeight || img.height,
  };
}

function captureFromVideoEl(
  v: HTMLVideoElement
): { url: string; w: number; h: number } | null {
  const w = v.videoWidth || 640;
  const h = v.videoHeight || 480;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(v, 0, 0, w, h);
  const url = canvas.toDataURL("image/jpeg", 0.92);
  return { url, w, h };
}

export default function HomePage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const docImgRef = useRef<HTMLImageElement | null>(null);

  const [captureDataUrl, setCaptureDataUrl] = useState<string | null>(null);
  const [captureSize, setCaptureSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [docDataUrl, setDocDataUrl] = useState<string | null>(null);
  const [docSize, setDocSize] = useState<{ w: number; h: number } | null>(null);
  const [selfieDataUrl, setSelfieDataUrl] = useState<string | null>(null);
  const [selfieSize, setSelfieSize] = useState<{ w: number; h: number } | null>(
    null
  );
  const [docDetectResult, setDocDetectResult] = useState<DetectResult | null>(
    null
  );
  const [selfieDetectResult, setSelfieDetectResult] =
    useState<DetectResult | null>(null);
  const [docSelectedBox, setDocSelectedBox] = useState<FaceBox | null>(null);
  const [docFacePreview, setDocFacePreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [detectResult, setDetectResult] = useState<DetectResult | null>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [selectedDocumentBox, setSelectedDocumentBox] =
    useState<FaceBox | null>(null);
  const [selectedCandidateBox, setSelectedCandidateBox] =
    useState<FaceBox | null>(null);
  const [selectMode, setSelectMode] = useState<"document" | "candidate">(
    "document"
  );
  const [docPreview, setDocPreview] = useState<string | null>(null);
  const [focusInfo, setFocusInfo] = useState<{
    supported: boolean;
    message?: string;
    x?: number; // 0..1
    y?: number; // 0..1
  }>({ supported: false });

  // SFace cosine similarity threshold. Higher = stricter (harder to match).
  // Typical starting point: ~0.35-0.45 depending on capture quality.
  // NOTE: 0.363 was too permissive in real-world captures and caused false positives.
  const [threshold, setThreshold] = useState(0.55);
  const [flowMode, setFlowMode] = useState<"single" | "two_step">("single");

  const getVideoTrack = useCallback((): MediaStreamTrack | null => {
    const s = streamRef.current;
    if (!s) return null;
    const t = s.getVideoTracks?.()?.[0];
    return t ?? null;
  }, []);

  const refreshFocusSupport = useCallback(() => {
    const t = getVideoTrack();
    const caps = (t as any)?.getCapabilities?.() as any;
    const focusModes = caps?.focusMode as string[] | undefined;
    const supports = Array.isArray(focusModes) && focusModes.length > 0;
    setFocusInfo((prev) => ({
      ...prev,
      supported: Boolean(supports),
      message: supports
        ? "Tip: tap/click on the document area in the video to focus (device support varies)."
        : "Tap-to-focus not supported by this camera/browser (many laptops/webcams are fixed-focus).",
    }));
  }, [getVideoTrack]);

  const applyTapToFocus = useCallback(
    async (nx: number, ny: number) => {
      const t = getVideoTrack();
      if (!t || !(t as any).applyConstraints) {
        setFocusInfo((prev) => ({
          ...prev,
          supported: false,
          message: "Tap-to-focus not supported by this camera/browser.",
        }));
        return;
      }

      const caps = (t as any)?.getCapabilities?.() as any;
      const focusModes = caps?.focusMode as string[] | undefined;
      const supportsPOI = Boolean(caps?.pointsOfInterest);

      // Prefer continuous AF if available, otherwise try single-shot, otherwise fallback.
      const preferred = focusModes?.includes("continuous")
        ? "continuous"
        : focusModes?.includes("single-shot")
        ? "single-shot"
        : focusModes?.[0];

      try {
        const advanced: any = [];
        if (preferred) advanced.push({ focusMode: preferred });
        if (supportsPOI)
          advanced.push({ pointsOfInterest: [{ x: nx, y: ny }] });

        if (advanced.length > 0) {
          await (t as any).applyConstraints({ advanced });
        }

        setFocusInfo((prev) => ({
          ...prev,
          supported: true,
          x: nx,
          y: ny,
          message:
            "Focusing… (if supported). Now capture when the document looks sharp.",
        }));
      } catch {
        setFocusInfo((prev) => ({
          ...prev,
          supported: false,
          message:
            "This camera/browser does not allow programmatic focus control. Try better lighting, hold the card closer, or use a phone/rear camera.",
        }));
      }
    },
    [getVideoTrack]
  );

  const resetAutoFocus = useCallback(async () => {
    const t = getVideoTrack();
    if (!t || !(t as any).applyConstraints) return;
    try {
      await (t as any).applyConstraints({
        advanced: [{ focusMode: "continuous" }],
      });
      setFocusInfo((prev) => ({
        ...prev,
        x: undefined,
        y: undefined,
        message: "Autofocus reset (continuous), if supported.",
      }));
    } catch {
      // ignore
    }
  }, [getVideoTrack]);

  const startCamera = useCallback(async () => {
    setVerifyResult(null);
    setDetectResult(null);

    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }, // better for document focus on phones
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    refreshFocusSupport();
  }, [refreshFocusSupport]);

  const onUpload = useCallback(async (file: File | null) => {
    setVerifyResult(null);
    setDetectResult(null);
    setSelectedDocumentBox(null);
    setSelectedCandidateBox(null);
    setDocPreview(null);

    if (!file) return;
    const url = await fileToDataUrl(file);
    const size = await getImageSizeFromDataUrl(url);
    setCaptureDataUrl(url);
    setCaptureSize(size);
  }, []);

  const onUploadDocument = useCallback(async (file: File | null) => {
    setVerifyResult(null);
    setDocDetectResult(null);
    setDocSelectedBox(null);
    setDocFacePreview(null);
    if (!file) return;
    const url = await fileToDataUrl(file);
    const size = await getImageSizeFromDataUrl(url);
    setDocDataUrl(url);
    setDocSize(size);
  }, []);

  const analyzeSelfie = useCallback(
    async (selfieUrl?: string) => {
      const url = selfieUrl || selfieDataUrl;
      if (!url) return;
      setLoading(true);
      try {
        const fd = new FormData();
        fd.append("file", await dataUrlToBlob(url), "selfie.jpg");
        const res = await fetch("/api/detect", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          setSelfieDetectResult({
            ok: false,
            faceCount: 0,
            error: json?.detail || json?.error || "Detect failed.",
          });
        } else {
          const boxes: FaceBox[] = Array.isArray(json.boxes)
            ? json.boxes.map((b: any) => ({
                x: Number(b.x),
                y: Number(b.y),
                w: Number(b.w),
                h: Number(b.h),
                score: typeof b.score === "number" ? b.score : undefined,
              }))
            : [];
          setSelfieDetectResult({
            ok: true,
            faceCount: Number(json.faceCount ?? boxes.length),
            boxes,
          });
        }
      } catch {
        setSelfieDetectResult({
          ok: false,
          faceCount: 0,
          error: "Detect failed. Is the backend running?",
        });
      } finally {
        setLoading(false);
      }
    },
    [selfieDataUrl]
  );

  const onUploadSelfie = useCallback(
    async (file: File | null) => {
      setVerifyResult(null);
      setSelfieDetectResult(null);
      if (!file) return;
      const url = await fileToDataUrl(file);
      const size = await getImageSizeFromDataUrl(url);
      setSelfieDataUrl(url);
      setSelfieSize(size);
      // Auto-detect faces in selfie
      void analyzeSelfie(url);
    },
    [analyzeSelfie]
  );

  const stopCamera = useCallback(() => {
    setVerifyResult(null);
    if (streamRef.current) {
      for (const t of streamRef.current.getTracks()) t.stop();
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setFocusInfo({ supported: false });
  }, []);

  const capture = useCallback(() => {
    setVerifyResult(null);
    setDetectResult(null);
    setSelectedDocumentBox(null);
    setSelectedCandidateBox(null);
    setDocPreview(null);

    const v = videoRef.current;
    if (!v) return;
    const shot = captureFromVideoEl(v);
    if (!shot) return;
    setCaptureDataUrl(shot.url);
    setCaptureSize({ w: shot.w, h: shot.h });
  }, []);

  const captureDocument = useCallback(() => {
    setVerifyResult(null);
    setDocDetectResult(null);
    setDocSelectedBox(null);
    setDocFacePreview(null);

    const v = videoRef.current;
    if (!v) return;
    const shot = captureFromVideoEl(v);
    if (!shot) return;
    setDocDataUrl(shot.url);
    setDocSize({ w: shot.w, h: shot.h });
  }, []);

  const captureSelfie = useCallback(() => {
    setVerifyResult(null);
    setSelfieDetectResult(null);
    const v = videoRef.current;
    if (!v) return;
    const shot = captureFromVideoEl(v);
    if (!shot) return;
    setSelfieDataUrl(shot.url);
    setSelfieSize({ w: shot.w, h: shot.h });
    // Auto-detect faces in selfie
    void analyzeSelfie(shot.url);
  }, [analyzeSelfie]);

  // Ensure camera is stopped on page unload/unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        for (const t of streamRef.current.getTracks()) t.stop();
        streamRef.current = null;
      }
    };
  }, []);

  const analyze = useCallback(async () => {
    setVerifyResult(null);
    setSelectedDocumentBox(null);
    setSelectedCandidateBox(null);
    setDocPreview(null);
    if (!captureDataUrl) {
      setDetectResult({
        ok: false,
        faceCount: 0,
        error: "Capture an image first.",
      });
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", await dataUrlToBlob(captureDataUrl), "capture.jpg");
      const res = await fetch("/api/detect", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setDetectResult({
          ok: false,
          faceCount: 0,
          error: json?.detail || json?.error || "Detect failed.",
        });
      } else {
        const boxes: FaceBox[] = Array.isArray(json.boxes)
          ? json.boxes.map((b: any) => ({
              x: Number(b.x),
              y: Number(b.y),
              w: Number(b.w),
              h: Number(b.h),
              score: typeof b.score === "number" ? b.score : undefined,
            }))
          : [];

        setDetectResult({
          ok: true,
          faceCount: Number(json.faceCount || 0),
          boxes,
        });

        // Auto-select faces to make Verify work without extra clicks:
        // - candidate: largest face
        // - document: smallest face (usually ID portrait)
        if (boxes.length >= 1) {
          const byArea = [...boxes].sort((a, b) => a.w * a.h - b.w * b.h);
          const smallest = byArea[0];
          const largest = byArea[byArea.length - 1];
          setSelectedCandidateBox(largest);
          if (boxes.length >= 2) {
            setSelectedDocumentBox(smallest);
            void cropPreview(smallest);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [captureDataUrl]);

  const analyzeDocument = useCallback(async () => {
    setVerifyResult(null);
    setDocSelectedBox(null);
    setDocFacePreview(null);
    if (!docDataUrl) {
      setDocDetectResult({
        ok: false,
        faceCount: 0,
        error: "Capture the document first.",
      });
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", await dataUrlToBlob(docDataUrl), "document.jpg");
      const res = await fetch("/api/detect", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok || !json?.ok) {
        setDocDetectResult({
          ok: false,
          faceCount: 0,
          error: json?.detail || json?.error || "Detect failed.",
        });
      } else {
        const boxes: FaceBox[] = Array.isArray(json.boxes)
          ? json.boxes.map((b: any) => ({
              x: Number(b.x),
              y: Number(b.y),
              w: Number(b.w),
              h: Number(b.h),
              score: typeof b.score === "number" ? b.score : undefined,
            }))
          : [];
        setDocDetectResult({
          ok: true,
          faceCount: Number(json.faceCount ?? boxes.length),
          boxes,
        });
      }
    } catch {
      setDocDetectResult({
        ok: false,
        faceCount: 0,
        error: "Detect failed. Is the backend running?",
      });
    } finally {
      setLoading(false);
    }
  }, [docDataUrl]);

  const cropPreview = useCallback(
    async (box: FaceBox) => {
      if (!captureDataUrl) return;
      const img = new Image();
      img.src = captureDataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load capture"));
      });
      const pad = 8;
      const x = Math.max(0, Math.floor(box.x - pad));
      const y = Math.max(0, Math.floor(box.y - pad));
      const w = Math.max(1, Math.floor(box.w + pad * 2));
      const h = Math.max(1, Math.floor(box.h + pad * 2));
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(420, w * 3);
      canvas.height = Math.min(420, h * 3);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      setDocPreview(canvas.toDataURL("image/jpeg", 0.92));
    },
    [captureDataUrl]
  );

  const cropDocFacePreview = useCallback(
    async (box: FaceBox) => {
      if (!docDataUrl) return;
      const img = new Image();
      img.src = docDataUrl;
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load document image"));
      });
      const pad = Math.max(10, Math.round(Math.min(box.w, box.h) * 0.12));
      const x = Math.max(0, Math.floor(box.x - pad));
      const y = Math.max(0, Math.floor(box.y - pad));
      const w = Math.max(1, Math.floor(box.w + pad * 2));
      const h = Math.max(1, Math.floor(box.h + pad * 2));
      const canvas = document.createElement("canvas");
      canvas.width = Math.min(420, w * 3);
      canvas.height = Math.min(420, h * 3);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      setDocFacePreview(canvas.toDataURL("image/jpeg", 0.92));
    },
    [docDataUrl]
  );

  const verify = useCallback(async () => {
    setVerifyResult(null);
    if (!captureDataUrl) {
      setVerifyResult({ ok: false, error: "Capture an image first." });
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", await dataUrlToBlob(captureDataUrl), "capture.jpg");
      fd.append("threshold", String(threshold));
      // Optional: if the user clicked/selects faces, send them to improve accuracy.
      // Not required for verification (backend will fallback to best-effort heuristics).
      if (selectedDocumentBox)
        fd.append("document_box", JSON.stringify(selectedDocumentBox));
      if (selectedCandidateBox)
        fd.append("candidate_box", JSON.stringify(selectedCandidateBox));
      const res = await fetch("/api/verify-single", {
        method: "POST",
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) {
        setVerifyResult({
          ok: false,
          error:
            json?.detail ||
            json?.error ||
            "Verify failed. If you recently changed the Python backend, restart it.",
        });
        return;
      }
      setVerifyResult({
        ok: true,
        engine: json.engine,
        similarity: json.similarity,
        threshold: json.threshold ?? threshold,
        isMatch: Boolean(json.isMatch),
        matchPercent: Number(json.matchPercent ?? 0),
        faceCount: Number(json?.faces?.faceCount ?? 0),
        // candidateBox: json?.faces?.candidateBox,
        // documentBox: json?.faces?.documentBox,
      });
    } catch {
      setVerifyResult({
        ok: false,
        error:
          "Verification failed. Make sure Python backend is running on http://127.0.0.1:8001 (or set PY_BACKEND_URL).",
      });
    } finally {
      setLoading(false);
    }
  }, [captureDataUrl, threshold]);

  const verifyTwoStep = useCallback(async () => {
    setVerifyResult(null);
    if (!docDataUrl) {
      setVerifyResult({ ok: false, error: "Capture the document first." });
      return;
    }
    if (!selfieDataUrl) {
      setVerifyResult({ ok: false, error: "Capture the selfie second." });
      return;
    }

    setLoading(true);
    try {
      const fd = new FormData();
      const docToSend = docFacePreview || docDataUrl;
      fd.append("document", await dataUrlToBlob(docToSend), "document.jpg");
      fd.append("selfie", await dataUrlToBlob(selfieDataUrl), "selfie.jpg");
      fd.append("threshold", String(threshold));
      fd.append("run_liveness", "false");

      const res = await fetch("/api/verify", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) {
        setVerifyResult({
          ok: false,
          error:
            json?.detail ||
            json?.error ||
            "Verify failed. If you recently changed the Python backend, restart it.",
        });
        return;
      }
      setVerifyResult({
        ok: true,
        engine: json.engine,
        similarity: json.similarity,
        threshold: json.threshold ?? threshold,
        isMatch: Boolean(json.isMatch),
        matchPercent: Number(json.matchPercent ?? 0),
        documentFaceCount: Number(json?.faces?.documentFaceCount ?? 0),
        selfieFaceCount: Number(json?.faces?.selfieFaceCount ?? 0),
      });
    } catch {
      setVerifyResult({
        ok: false,
        error:
          "Verification failed. Make sure Python backend is running on http://127.0.0.1:8001 (or set PY_BACKEND_URL).",
      });
    } finally {
      setLoading(false);
    }
  }, [docDataUrl, selfieDataUrl, docFacePreview, threshold]);

  return (
    <div className="container">
      <h2>Aadhaar Face Verification (Capture Only)</h2>
      <p className="muted">Choose a flow below.</p>

      <div style={{ marginBottom: 14 }}>
        <div className="muted" style={{ marginBottom: 8 }}>
          Flow:
        </div>
        <label
          style={{
            display: "inline-flex",
            gap: 8,
            alignItems: "center",
            marginRight: 16,
          }}
        >
          <input
            type="radio"
            name="flowMode"
            checked={flowMode === "single"}
            onChange={() => setFlowMode("single")}
          />
          Single image (selfie with card)
        </label>
        <label style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <input
            type="radio"
            name="flowMode"
            checked={flowMode === "two_step"}
            onChange={() => setFlowMode("two_step")}
          />
          Two-step (document first → selfie second)
        </label>
      </div>

      <div className="row">
        {flowMode === "single" ? (
          <>
            <div className="card">
              <h3>1) Camera</h3>
              <div className="muted" style={{ marginBottom: 8 }}>
                Option: Upload an image of the candidate holding the document
                (or use camera below).
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => void onUpload(e.target.files?.[0] ?? null)}
              />
              <div style={{ position: "relative" }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  onPointerDown={(e) => {
                    // Tap-to-focus: best effort. Works on many phones; many webcams are fixed-focus.
                    e.preventDefault();
                    const el = videoRef.current;
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    const nx = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width)
                    );
                    const ny = Math.max(
                      0,
                      Math.min(1, (e.clientY - rect.top) / rect.height)
                    );
                    void applyTapToFocus(nx, ny);
                  }}
                  style={{ cursor: "crosshair", touchAction: "none" }}
                />

                {typeof focusInfo.x === "number" &&
                typeof focusInfo.y === "number" ? (
                  <div
                    style={{
                      position: "absolute",
                      left: `calc(${(focusInfo.x * 100).toFixed(2)}% - 18px)`,
                      top: `calc(${(focusInfo.y * 100).toFixed(2)}% - 18px)`,
                      width: 36,
                      height: 36,
                      border: "2px solid #22c55e",
                      borderRadius: 10,
                      pointerEvents: "none",
                      boxShadow: "0 0 0 2px rgba(0,0,0,0.15)",
                    }}
                  />
                ) : null}
              </div>
              <div
                style={{
                  marginTop: 12,
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <button onClick={() => void startCamera()}>Start camera</button>
                <button onClick={stopCamera}>Stop camera</button>
                <button onClick={capture}>Capture</button>
                <button onClick={() => void resetAutoFocus()}>
                  Reset autofocus
                </button>
              </div>
              {focusInfo.message ? (
                <div className="muted" style={{ marginTop: 8 }}>
                  {focusInfo.message}
                </div>
              ) : null}

              {captureDataUrl ? (
                <div style={{ marginTop: 12 }}>
                  <div
                    style={{
                      position: "relative",
                      display: "inline-block",
                      maxWidth: "100%",
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={captureDataUrl}
                      alt="capture preview"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        display: "block",
                        borderRadius: 12,
                      }}
                    />

                    {detectResult?.ok &&
                    Array.isArray(detectResult.boxes) &&
                    detectResult.boxes.length > 0
                      ? detectResult.boxes.map((b, idx) => {
                          const isDoc =
                            selectedDocumentBox &&
                            b.x === selectedDocumentBox.x &&
                            b.y === selectedDocumentBox.y &&
                            b.w === selectedDocumentBox.w &&
                            b.h === selectedDocumentBox.h;
                          const isCand =
                            selectedCandidateBox &&
                            b.x === selectedCandidateBox.x &&
                            b.y === selectedCandidateBox.y &&
                            b.w === selectedCandidateBox.w &&
                            b.h === selectedCandidateBox.h;

                          const cw = captureSize?.w ?? 1;
                          const ch = captureSize?.h ?? 1;
                          const leftPct = (b.x / cw) * 100;
                          const topPct = (b.y / ch) * 100;
                          const wPct = (b.w / cw) * 100;
                          const hPct = (b.h / ch) * 100;

                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                if (selectMode === "document") {
                                  setSelectedDocumentBox(b);
                                  void cropPreview(b);
                                } else {
                                  setSelectedCandidateBox(b);
                                }
                              }}
                              title={
                                selectMode === "document"
                                  ? "Click to select as Document face"
                                  : "Click to select as Candidate face"
                              }
                              style={{
                                position: "absolute",
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${wPct}%`,
                                height: `${hPct}%`,
                                border: `2px solid ${
                                  isDoc
                                    ? "#22c55e"
                                    : isCand
                                    ? "#a855f7"
                                    : "#00a3ff"
                                }`,
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                borderRadius: 8,
                              }}
                            />
                          );
                        })
                      : null}
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 12 }}>
                  No capture yet.
                </div>
              )}
            </div>

            <div className="card">
              <h3>2) Analyze + Verify</h3>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button disabled={loading} onClick={() => void analyze()}>
                  {loading ? "Working..." : "Analyze image (expect 2 faces)"}
                </button>
                <button
                  className="primary"
                  disabled={loading}
                  onClick={() => void verify()}
                >
                  {loading ? "Verifying..." : "Verify face match"}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ marginBottom: 8 }}>
                  Optional: click <b>Analyze</b> to show face boxes, then click
                  the <b>document portrait face</b> for better accuracy.
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <div className="muted">Click mode:</div>
                  <label
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <input
                      type="radio"
                      name="selectMode"
                      checked={selectMode === "document"}
                      onChange={() => setSelectMode("document")}
                    />
                    Document face (Aadhaar portrait)
                  </label>
                  <label
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <input
                      type="radio"
                      name="selectMode"
                      checked={selectMode === "candidate"}
                      onChange={() => setSelectMode("candidate")}
                    />
                    Candidate face (your face)
                  </label>
                </div>

                {docPreview ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted">Selected document face (zoomed)</div>
                    <img
                      src={docPreview}
                      alt="document face preview"
                      style={{ marginTop: 6, borderRadius: 12 }}
                    />
                  </div>
                ) : null}
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Threshold tuning (higher = stricter)
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={0.7}
                  step={0.01}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ width: "100%", maxWidth: 420 }}
                />
                <div className="muted" style={{ marginTop: 6 }}>
                  Current threshold: {threshold}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted">Detect result</div>
                <pre style={{ marginTop: 6 }}>
                  {detectResult
                    ? (() => {
                        if (
                          !detectResult.ok ||
                          !Array.isArray(detectResult.boxes)
                        ) {
                          return JSON.stringify(detectResult, null, 2);
                        }
                        const boxes = detectResult.boxes;
                        const byArea = [...boxes].sort(
                          (a, b) => a.w * a.h - b.w * b.h
                        );
                        const documentBox =
                          byArea.length >= 2 ? byArea[0] : null;
                        const candidateBox =
                          byArea.length >= 1 ? byArea[byArea.length - 1] : null;
                        return JSON.stringify(
                          {
                            ok: true,
                            faceCount: detectResult.faceCount,
                            candidateBox,
                            documentBox,
                          },
                          null,
                          2
                        );
                      })()
                    : "Not run yet."}
                </pre>
                l
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted">Verify result</div>
                <pre style={{ marginTop: 6 }}>
                  {verifyResult
                    ? JSON.stringify(verifyResult, null, 2)
                    : "Not run yet. Expected fields: faceCount, threshold, matchPercent, isMatch."}
                </pre>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="card">
              <h3>1) Capture document (ID card)</h3>
              <div className="muted" style={{ marginBottom: 8 }}>
                First: capture the ID card clearly (portrait visible). You can
                tap-to-focus on the video.
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                }}
              >
                <button onClick={() => void startCamera()}>Start camera</button>
                <button onClick={stopCamera}>Stop camera</button>
                <button onClick={captureDocument}>Capture document</button>
                <button onClick={() => void resetAutoFocus()}>
                  Reset autofocus
                </button>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Or upload document image:
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    void onUploadDocument(e.target.files?.[0] ?? null)
                  }
                />
              </div>

              <div style={{ marginTop: 12, position: "relative" }}>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const el = videoRef.current;
                    if (!el) return;
                    const rect = el.getBoundingClientRect();
                    const nx = Math.max(
                      0,
                      Math.min(1, (e.clientX - rect.left) / rect.width)
                    );
                    const ny = Math.max(
                      0,
                      Math.min(1, (e.clientY - rect.top) / rect.height)
                    );
                    void applyTapToFocus(nx, ny);
                  }}
                  style={{ cursor: "crosshair", touchAction: "none" }}
                />
              </div>

              {docDataUrl ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted" style={{ marginBottom: 8 }}>
                    Click <b>Analyze document</b> to show face boxes, then click
                    the <b>portrait</b>.
                  </div>
                  <div
                    style={{
                      position: "relative",
                      display: "inline-block",
                      maxWidth: "100%",
                    }}
                  >
                    <img
                      ref={docImgRef}
                      src={docDataUrl}
                      alt="document preview"
                      style={{
                        maxWidth: "100%",
                        height: "auto",
                        display: "block",
                        borderRadius: 12,
                      }}
                    />
                    {docDetectResult?.ok &&
                    Array.isArray(docDetectResult.boxes) &&
                    docDetectResult.boxes.length > 0
                      ? docDetectResult.boxes.map((b, idx) => {
                          const isSel =
                            docSelectedBox &&
                            b.x === docSelectedBox.x &&
                            b.y === docSelectedBox.y &&
                            b.w === docSelectedBox.w &&
                            b.h === docSelectedBox.h;
                          const cw = docSize?.w ?? 1;
                          const ch = docSize?.h ?? 1;
                          const leftPct = (b.x / cw) * 100;
                          const topPct = (b.y / ch) * 100;
                          const wPct = (b.w / cw) * 100;
                          const hPct = (b.h / ch) * 100;
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setDocSelectedBox(b);
                                void cropDocFacePreview(b);
                              }}
                              title="Click to select portrait face"
                              style={{
                                position: "absolute",
                                left: `${leftPct}%`,
                                top: `${topPct}%`,
                                width: `${wPct}%`,
                                height: `${hPct}%`,
                                border: `2px solid ${
                                  isSel ? "#22c55e" : "#00a3ff"
                                }`,
                                background: "transparent",
                                padding: 0,
                                cursor: "pointer",
                                borderRadius: 8,
                              }}
                            />
                          );
                        })
                      : null}
                  </div>
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 12 }}>
                  No document captured yet.
                </div>
              )}

              {docFacePreview ? (
                <div style={{ marginTop: 12 }}>
                  <div className="muted">
                    Selected document portrait (zoomed)
                  </div>
                  <img
                    src={docFacePreview}
                    alt="document face preview"
                    style={{ marginTop: 6, borderRadius: 12 }}
                  />
                </div>
              ) : null}
            </div>

            <div className="card">
              <h3>2) Capture selfie + Match</h3>
              <div className="muted" style={{ marginBottom: 8 }}>
                Second: capture a clear selfie (face visible). Then verify
                against the document portrait.
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  disabled={loading}
                  onClick={() => void analyzeDocument()}
                >
                  {loading ? "Working..." : "Analyze document (find portrait)"}
                </button>
                <button onClick={captureSelfie}>Capture selfie</button>
              </div>
              <div style={{ marginTop: 10 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Or upload selfie:
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    void onUploadSelfie(e.target.files?.[0] ?? null)
                  }
                />
              </div>

              {selfieDataUrl ? (
                <div style={{ marginTop: 12 }}>
                  <img
                    src={selfieDataUrl}
                    alt="selfie preview"
                    style={{ maxWidth: "100%", borderRadius: 12 }}
                  />
                  {selfieDetectResult?.ok &&
                  selfieDetectResult.faceCount > 1 ? (
                    <div
                      style={{
                        marginTop: 12,
                        padding: 12,
                        backgroundColor: "#fef3c7",
                        border: "1px solid #fbbf24",
                        borderRadius: 8,
                        color: "#92400e",
                      }}
                    >
                      <strong>⚠️ Warning:</strong> More than one face detected
                      in selfie ({selfieDetectResult.faceCount} faces). For best
                      accuracy, capture only your face. Please recapture the
                      selfie.
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 12 }}>
                  No selfie captured yet.
                </div>
              )}

              <div style={{ marginTop: 12 }}>
                <div className="muted" style={{ marginBottom: 6 }}>
                  Threshold tuning (higher = stricter)
                </div>
                <input
                  type="range"
                  min={0.2}
                  max={0.8}
                  step={0.01}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  style={{ width: "100%", maxWidth: 420 }}
                />
                <div className="muted" style={{ marginTop: 6 }}>
                  Current threshold: {threshold}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <button
                  className="primary"
                  disabled={loading}
                  onClick={() => void verifyTwoStep()}
                >
                  {loading ? "Verifying..." : "Verify (document ↔ selfie)"}
                </button>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted">Document detect result</div>
                <pre style={{ marginTop: 6 }}>
                  {docDetectResult
                    ? JSON.stringify(docDetectResult, null, 2)
                    : "Not run yet."}
                </pre>
              </div>

              <div style={{ marginTop: 12 }}>
                <div className="muted">Verify result</div>
                <pre style={{ marginTop: 6 }}>
                  {verifyResult
                    ? JSON.stringify(verifyResult, null, 2)
                    : "Not run yet."}
                </pre>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
