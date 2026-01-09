from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from backend.app.services.opencv_sface import (
    basic_liveness,
    decode_image,
    cosine_similarity_sface,
    detect_faces,
    detect_best_face_for_document,
    best_match_same_image_selfie_with_card,
    face_feature,
    pick_largest_face_index,
)


def create_app() -> FastAPI:
    app = FastAPI(title="Face Match Service (ArcFace)", version="0.1.0")

    # If you call this service directly from Next.js in the browser, enable CORS.
    # (If you use a Next.js API proxy, you can remove/lock this down.)
    import os
    allowed_origins = [
        "http://localhost:3000",
        os.getenv("FRONTEND_URL", ""),
    ]
    # Filter out empty strings
    allowed_origins = [origin for origin in allowed_origins if origin]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins if allowed_origins else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/v1/liveness")
    async def liveness(file: UploadFile = File(...)) -> dict:
        try:
            img = decode_image(await file.read())
            return basic_liveness(img)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

    @app.post("/v1/detect")
    async def detect(file: UploadFile = File(...), score_threshold: float = 0.6) -> dict:
        """
        Face detection only (for UI feedback).
        """
        try:
            img = decode_image(await file.read())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        faces_raw, infos = detect_faces(img, score_threshold=score_threshold)
        boxes = []
        for i, info in enumerate(infos):
            x, y, w, h = info.box
            boxes.append(
                {
                    "x": int(x),
                    "y": int(y),
                    "w": int(w),
                    "h": int(h),
                    "score": float(info.score),
                }
            )

        return {"ok": True, "faceCount": len(infos), "boxes": boxes}

    @app.post("/v1/verify")
    async def verify(
        document: UploadFile = File(...),
        selfie: UploadFile = File(...),
        threshold: float = 0.363,
        run_liveness: bool = True,
    ) -> dict:
        try:
            doc_img = decode_image(await document.read())
            selfie_img = decode_image(await selfie.read())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        doc_raw, doc_infos = detect_faces(doc_img)
        selfie_raw, selfie_infos = detect_faces(selfie_img)
        doc_i = pick_largest_face_index(doc_infos)
        selfie_i = pick_largest_face_index(selfie_infos)

        doc_used_meta = None
        doc_used_img = doc_img
        doc_used_infos = doc_infos

        if doc_i is None:
            found = detect_best_face_for_document(doc_img)
            if found is None:
                raise HTTPException(status_code=422, detail="No face detected in document image.")
            doc_used_img, doc_face_row, doc_used_infos, doc_used_meta = found
        else:
            doc_face_row = doc_raw[doc_i]

        if selfie_i is None:
            raise HTTPException(status_code=422, detail="No face detected in selfie image.")

        doc_feat = face_feature(doc_used_img, doc_face_row)
        selfie_feat = face_feature(selfie_img, selfie_raw[selfie_i])
        sim = cosine_similarity_sface(doc_feat, selfie_feat)
        is_match = sim >= threshold

        # UI %: cosine similarity is in [-1..1], clamp to [0..1]
        match_percent = int(round(max(0.0, min(1.0, (sim + 1.0) / 2.0)) * 100))

        liveness_result = basic_liveness(selfie_img) if run_liveness else None

        return {
            "ok": True,
            "engine": "OpenCV YuNet + SFace (opencv_zoo ONNX)",
            "similarity": float(sim),
            "threshold": float(threshold),
            "isMatch": bool(is_match),
            "matchPercent": match_percent,
            "faces": {
                "documentFaceCount": len(doc_used_infos),
                "selfieFaceCount": len(selfie_infos),
            },
            "documentSearch": doc_used_meta,
            "liveness": liveness_result,
            "note": "For production, use a real liveness/anti-spoof model + audited thresholds.",
        }

    @app.post("/v1/verify_single")
    async def verify_single(
        file: UploadFile = File(...),
        threshold: float = 0.363,
        candidate_box: str | None = Form(default=None),
        document_box: str | None = Form(default=None),
    ) -> dict:
        """
        Single image mode: user holds Aadhaar/PAN/DL card in the same photo.
        We detect multiple faces and match the largest face (candidate) with a smaller face (ID portrait).
        """
        try:
            img = decode_image(await file.read())
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e

        result = best_match_same_image_selfie_with_card(
            img,
            threshold=threshold,
            candidate_box_json=candidate_box,
            document_box_json=document_box,
        )
        if not result.get("ok", False):
            raise HTTPException(status_code=422, detail=result.get("error", "Verify failed."))
        return result

    return app


app = create_app()


