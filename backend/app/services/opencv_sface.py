from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import urlretrieve

import cv2
import numpy as np


MODELS_DIR = Path(__file__).resolve().parents[3] / "backend_models"
YUNET_MODEL = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
SFACE_MODEL = MODELS_DIR / "face_recognition_sface_2021dec.onnx"       

# NOTE: `raw.githubusercontent.com` serves Git LFS pointer files for these models.
# Use `media.githubusercontent.com` to download the actual ONNX binaries.
YUNET_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
SFACE_URL = "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx"


@dataclass(frozen=True)
class FaceInfo:
    box: tuple[int, int, int, int]  # x,y,w,h
    score: float

    @property
    def area(self) -> int:
        _, _, w, h = self.box
        return max(0, int(w)) * max(0, int(h))


def ensure_models() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    if not YUNET_MODEL.exists():
        urlretrieve(YUNET_URL, YUNET_MODEL)  # noqa: S310
    if not SFACE_MODEL.exists():
        urlretrieve(SFACE_URL, SFACE_MODEL)  # noqa: S310

    # Guard against accidentally downloading a Git LFS pointer.
    for p in (YUNET_MODEL, SFACE_MODEL):
        try:
            head = p.read_bytes()[:80]
        except OSError:
            continue
        if b"git-lfs" in head or head.startswith(b"version https://git-lfs"):
            # Remove the pointer file so we can retry download.
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass
            raise RuntimeError(
                f"Downloaded an invalid model pointer for {p.name}. Network may be blocking GitHub media downloads."
            )


def decode_image(file_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Upload a valid PNG/JPG.")
    return img


def _create_detector(
    input_size: tuple[int, int],
    *,
    score_threshold: float = 0.6,
    nms_threshold: float = 0.3,
    top_k: int = 5000,
) -> Any:
    # input_size is (w, h)
    return cv2.FaceDetectorYN.create(
        str(YUNET_MODEL),
        "",
        input_size,
        score_threshold=float(score_threshold),
        nms_threshold=float(nms_threshold),
        top_k=int(top_k),
    )


def _create_recognizer() -> Any:
    return cv2.FaceRecognizerSF.create(str(SFACE_MODEL), "")


def detect_faces(
    img_bgr: np.ndarray,
    *,
    score_threshold: float = 0.6,
) -> tuple[np.ndarray, list[FaceInfo]]:
    """
    Returns (faces_raw, faces_info)
    faces_raw rows: [x, y, w, h, score, l0x, l0y, ..., l4x, l4y]
    """
    ensure_models()
    h, w = img_bgr.shape[:2]
    detector = _create_detector((w, h), score_threshold=score_threshold)
    _, faces = detector.detect(img_bgr)
    if faces is None or len(faces) == 0:
        return np.empty((0, 15), dtype=np.float32), []

    infos: list[FaceInfo] = []
    for row in faces:
        x, y, bw, bh, score = row[:5].tolist()
        infos.append(FaceInfo(box=(int(x), int(y), int(bw), int(bh)), score=float(score)))
    return faces, infos


def _crop(img: np.ndarray, x: int, y: int, w: int, h: int) -> np.ndarray:
    ih, iw = img.shape[:2]
    x0 = max(0, min(iw - 1, x))
    y0 = max(0, min(ih - 1, y))
    x1 = max(x0 + 1, min(iw, x + w))
    y1 = max(y0 + 1, min(ih, y + h))
    return img[y0:y1, x0:x1]


def _resize(img: np.ndarray, scale: float) -> np.ndarray:
    if scale == 1.0:
        return img
    h, w = img.shape[:2]
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(img, (nw, nh), interpolation=cv2.INTER_CUBIC if scale > 1 else cv2.INTER_AREA)


def detect_best_face_for_document(
    img_bgr: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, list[FaceInfo], dict[str, Any]] | None:
    """
    Document images (Aadhaar/DL) often contain a tiny portrait.
    This function searches multiple strategies and returns the best face found.

    Returns:
      (img_used, face_row, infos_used, meta) OR None if no face found.
    """
    ensure_models()
    h, w = img_bgr.shape[:2]

    # Candidate regions: full image + common portrait regions (left/top-left).
    rois = [
        ("full", (0, 0, w, h)),
        ("top_left", (0, 0, int(w * 0.6), int(h * 0.75))),
        ("left", (0, 0, int(w * 0.65), h)),
        ("top", (0, 0, w, int(h * 0.7))),
        ("left_middle", (0, int(h * 0.12), int(w * 0.7), int(h * 0.8))),
    ]

    # Try lower score thresholds for small/low-res faces.
    score_thresholds = [0.6, 0.5, 0.4]
    scales = [1.0, 2.0, 3.0]

    best: tuple[float, np.ndarray, np.ndarray, list[FaceInfo], dict[str, Any]] | None = None

    for roi_name, (rx, ry, rw, rh) in rois:
        roi_img = _crop(img_bgr, rx, ry, rw, rh) if roi_name != "full" else img_bgr
        for scale in scales:
            scaled = _resize(roi_img, scale)
            for st in score_thresholds:
                faces_raw, infos = detect_faces(scaled, score_threshold=st)
                if not infos:
                    continue

                # Pick best face in this attempt by area*score.
                best_idx = max(range(len(infos)), key=lambda i: (infos[i].area * infos[i].score))
                info = infos[best_idx]
                metric = float(info.area * info.score)

                meta = {"roi": roi_name, "scale": scale, "scoreThreshold": st}
                candidate = (metric, scaled, faces_raw[best_idx], infos, meta)
                if best is None or metric > best[0]:
                    best = candidate

    if best is None:
        return None
    _, img_used, face_row, infos_used, meta = best
    return img_used, face_row, infos_used, meta


def pick_largest_face_index(infos: list[FaceInfo]) -> int | None:
    if not infos:
        return None
    best_i = max(range(len(infos)), key=lambda i: infos[i].area)
    return int(best_i)


def face_feature(img_bgr: np.ndarray, face_row: np.ndarray) -> np.ndarray:
    """
    Compute face embedding for one face (SFace). Returns a vector.
    """
    ensure_models()
    recognizer = _create_recognizer()
    aligned = recognizer.alignCrop(img_bgr, face_row)
    feat = recognizer.feature(aligned)
    return feat


def cosine_similarity_sface(feat1: np.ndarray, feat2: np.ndarray) -> float:
    """
    Use OpenCV's match function for cosine similarity.
    """
    ensure_models()
    recognizer = _create_recognizer()
    return float(recognizer.match(feat1, feat2, cv2.FaceRecognizerSF_FR_COSINE))


def _find_id_card_roi(img_bgr: np.ndarray) -> tuple[int, int, int, int] | None:
    """
    Best-effort ID-card detector using contours:
    - Find a large quadrilateral with a reasonable ID-card aspect ratio.
    Returns (x, y, w, h) in original image coordinates, or None.
    """
    h, w = img_bgr.shape[:2]
    if h < 60 or w < 60:
        return None

    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(gray, 60, 160)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    best = None  # (score, x,y,w,h)
    img_area = float(h * w)

    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if area < img_area * 0.04:  # too small to be the card
            continue
        peri = cv2.arcLength(cnt, True)
        approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
        if len(approx) != 4:
            continue
        x, y, bw, bh = cv2.boundingRect(approx)
        if bw <= 0 or bh <= 0:
            continue
        ar = float(max(bw, bh) / max(1, min(bw, bh)))
        # ID cards are usually around ~1.58, but allow wide range due to perspective.
        if not (1.2 <= ar <= 2.6):
            continue
        rect_area = float(bw * bh)
        fill = area / max(1.0, rect_area)  # how well contour fills its bounding rect
        score = rect_area * fill
        if best is None or score > best[0]:
            best = (score, x, y, bw, bh)

    if best is None:
        return None

    _, x, y, bw, bh = best
    # Add a small margin (helps when contour hugs border)
    mx = int(round(bw * 0.05))
    my = int(round(bh * 0.07))
    x2 = max(0, x - mx)
    y2 = max(0, y - my)
    x3 = min(w, x + bw + mx)
    y3 = min(h, y + bh + my)
    return (x2, y2, max(1, x3 - x2), max(1, y3 - y2))


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    ax2, ay2 = ax + aw, ay + ah
    bx2, by2 = bx + bw, by + bh
    ix1, iy1 = max(ax, bx), max(ay, by)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0, ix2 - ix1), max(0, iy2 - iy1)
    inter = float(iw * ih)
    if inter <= 0:
        return 0.0
    union = float(aw * ah + bw * bh) - inter
    return float(inter / max(1.0, union))


def _box_center_in_roi(box: tuple[int, int, int, int], roi: tuple[int, int, int, int]) -> bool:
    bx, by, bw, bh = box
    rx, ry, rw, rh = roi
    cx = bx + bw * 0.5
    cy = by + bh * 0.5
    return (rx <= cx <= rx + rw) and (ry <= cy <= ry + rh)


def _parse_box_json(box_json: str | None) -> tuple[int, int, int, int] | None:
    if not box_json:
        return None
    try:
        obj = json.loads(box_json)
        x = int(obj["x"])
        y = int(obj["y"])
        w = int(obj["w"])
        h = int(obj["h"])
        if w <= 0 or h <= 0:
            return None
        return (x, y, w, h)
    except Exception:
        return None


def _pick_face_by_box(
    img_bgr: np.ndarray,
    target_box: tuple[int, int, int, int],
    *,
    min_iou: float = 0.10,
) -> tuple[np.ndarray, np.ndarray, FaceInfo, dict[str, Any]] | None:
    """
    Detect faces and pick the face whose bbox best overlaps the user-selected target_box.
    Returns (img_used, face_row, face_info, meta) in the coordinate space of img_used.
    """
    scales = [1.0, 1.5, 2.0, 3.0]
    score_thresholds = [0.6, 0.5, 0.4]
    best = None  # (iou, scale, st, img_used, face_row, face_info)

    for scale in scales:
        scaled = _resize(img_bgr, scale)
        tb = (
            int(round(target_box[0] * scale)),
            int(round(target_box[1] * scale)),
            int(round(target_box[2] * scale)),
            int(round(target_box[3] * scale)),
        )
        for st in score_thresholds:
            faces_raw, infos = detect_faces(scaled, score_threshold=st)
            if not infos:
                continue
            for i, info in enumerate(infos):
                iou = _iou(tb, info.box)
                if best is None or iou > best[0]:
                    best = (float(iou), float(scale), float(st), scaled, faces_raw[i], info)

    if best is None:
        return None
    best_iou, scale, st, img_used, face_row, face_info = best
    if float(best_iou) < float(min_iou):
        return None
    return img_used, face_row, face_info, {"match": "iou", "iou": best_iou, "scale": scale, "scoreThreshold": st}

def best_match_same_image_selfie_with_card(
    img_bgr: np.ndarray,
    *,
    threshold: float,
    max_doc_to_selfie_area_ratio: float = 0.35,
    min_doc_face_size: int = 20,
    candidate_box_json: str | None = None,
    document_box_json: str | None = None,
) -> dict[str, Any]:
    """
    Single-image mode (selfie holding ID card).

    We expect at least 2 faces in the same image:
    - candidate face: largest detected face
    - document face: a smaller face (ID portrait), best similarity among candidates

    The function runs multi-scale detection to reliably find small ID portraits.
    """
    ensure_models()

    selected_candidate_box = _parse_box_json(candidate_box_json)
    selected_document_box = _parse_box_json(document_box_json)

    # If user clicked a document face (and/or candidate face), honor that first.
    cand_pick = None
    if selected_candidate_box is not None:
        cand_pick = _pick_face_by_box(img_bgr, selected_candidate_box)
        if cand_pick is None:
            return {"ok": False, "error": "Could not match your selected candidate face box to a detected face. Please re-capture and click the face again."}

    doc_pick = None
    if selected_document_box is not None:
        doc_pick = _pick_face_by_box(img_bgr, selected_document_box)
        if doc_pick is None:
            return {"ok": False, "error": "Could not match your selected document face box to a detected face. Please re-capture and click the Aadhaar portrait again."}

    if cand_pick is not None or doc_pick is not None:
        if cand_pick is None:
            # default candidate = largest face
            faces_raw, infos = detect_faces(img_bgr, score_threshold=0.5)
            i = pick_largest_face_index(infos)
            if i is None:
                return {"ok": False, "error": "No candidate face detected."}
            cand_pick = (img_bgr, faces_raw[i], infos[i], {"match": "largest"})
        if doc_pick is None:
            # Best effort document:
            # - Prefer ID-card ROI, and search inside it.
            # - DO NOT search the full selfie frame (it can pick the candidate face again -> always match).
            card_roi = _find_id_card_roi(img_bgr)
            if card_roi is None:
                return {
                    "ok": False,
                    "error": "Could not auto-detect the ID card region. Please click the document portrait face box after Analyze (or move the card closer).",
                }
            doc_img = img_bgr
            if card_roi is not None:
                rx, ry, rw, rh = card_roi
                doc_img = _crop(img_bgr, rx, ry, rw, rh)
            found = detect_best_face_for_document(doc_img)
            if found is None:
                return {"ok": False, "error": "Could not find the Aadhaar/PAN/DL portrait face. Please click the portrait face box after Analyze."}
            doc_used_img, doc_row, doc_infos, doc_search = found
            # We don't have a FaceInfo here; synthesize minimal info.
            x, y, w, h = [int(v) for v in doc_row[:4].tolist()]
            doc_pick = (doc_used_img, doc_row, FaceInfo(box=(x, y, w, h), score=float(doc_row[4])), {"match": "document_search", "search": doc_search})

        cand_img, cand_row, cand_info, cand_meta = cand_pick
        doc_img, doc_row, doc_info, doc_meta = doc_pick

        cand_feat = face_feature(cand_img, cand_row)
        doc_feat = face_feature(doc_img, doc_row)
        sim = cosine_similarity_sface(cand_feat, doc_feat)
        is_match = bool(float(sim) >= float(threshold))
        match_percent = int(round(max(0.0, min(1.0, (float(sim) + 1.0) / 2.0)) * 100))

        return {
            "ok": True,
            "engine": "OpenCV YuNet + SFace (opencv_zoo ONNX)",
            "mode": "single_image_selfie_with_card",
            "similarity": float(sim),
            "threshold": float(threshold),
            "isMatch": bool(is_match),
            "matchPercent": int(match_percent),
            "faces": {
                "faceCount": int(len(detect_faces(img_bgr, score_threshold=0.5)[1])),
                "candidateBox": {"x": cand_info.box[0], "y": cand_info.box[1], "w": cand_info.box[2], "h": cand_info.box[3]},
                "documentBox": {"x": doc_info.box[0], "y": doc_info.box[1], "w": doc_info.box[2], "h": doc_info.box[3]},
            },
            "selection": {"candidate": cand_meta, "document": doc_meta},
            "note": "User-selected face(s) were used for matching.",
        }

    # 1) Detect candidate face on full image (multi-scale helps if camera image is small).
    scales = [1.0, 1.5, 2.0]
    score_thresholds = [0.6, 0.5, 0.4]

    best_candidate = None  # (scale, st, scaled_img, face_row, face_info, face_count)
    for scale in scales:
        scaled = _resize(img_bgr, scale)
        for st in score_thresholds:
            faces_raw, infos = detect_faces(scaled, score_threshold=st)
            if not infos:
                continue
            i = pick_largest_face_index(infos)
            if i is None:
                continue
            # prefer larger face area and better score
            metric = float(infos[i].area * infos[i].score)
            if best_candidate is None or metric > float(best_candidate[0]):
                best_candidate = (metric, scale, st, scaled, faces_raw[i], infos[i], len(infos))

    if best_candidate is None:
        return {"ok": False, "error": "No face detected for candidate in the captured image."}

    _, cand_scale, cand_st, cand_scaled, cand_row, cand_info, cand_face_count = best_candidate
    cand_feat = face_feature(cand_scaled, cand_row)

    # 2) Prefer picking the "document portrait" from other detected faces in the SAME image.
    # If we fall back to document-style search on the full selfie frame, it can accidentally
    # select the candidate face again (largest), causing similarity ~ 1.0 and "always match".
    def _unscale_box_from_candidate(box: tuple[int, int, int, int]) -> dict[str, int]:
        x, y, w, h = box
        inv = 1.0 / float(cand_scale)
        return {
            "x": int(round(x * inv)),
            "y": int(round(y * inv)),
            "w": int(round(w * inv)),
            "h": int(round(h * inv)),
        }

    best_sameframe: dict[str, Any] | None = None

    # If we can find the ID card in the original image, prefer document-face candidates that lie inside it.
    card_roi = _find_id_card_roi(img_bgr)
    card_roi_scaled: tuple[int, int, int, int] | None = None
    if card_roi is not None:
        rx, ry, rw, rh = card_roi
        s = float(cand_scale)
        card_roi_scaled = (
            int(round(rx * s)),
            int(round(ry * s)),
            int(round(rw * s)),
            int(round(rh * s)),
        )

    # Try multiple score thresholds to pick up tiny ID portraits.
    try_thresholds = [0.6, 0.5, 0.4, 0.3]
    for st in try_thresholds:
        try_faces_raw, try_infos = detect_faces(cand_scaled, score_threshold=st)
        if len(try_infos) < 2:
            continue

        # Find which detection corresponds to the candidate box (highest IoU).
        cand_i = max(range(len(try_infos)), key=lambda i: _iou(try_infos[i].box, cand_info.box))
        cand_box = try_infos[cand_i].box
        cand_area = float(max(1, try_infos[cand_i].area))

        # Document candidates: other faces that don't overlap candidate and are reasonably smaller.
        # NOTE: keep this lenient; ID portrait size varies a lot.
        area_ratio_limit = max(0.60, float(max_doc_to_selfie_area_ratio))
        # In practice, very tiny boxes (e.g. 18x22) are almost always false positives.
        # Require a minimum size for the ID portrait to avoid "always true" matches.
        min_doc_face_size_effective = max(int(min_doc_face_size), 60)
        doc_candidates = [
            i
            for i, info in enumerate(try_infos)
            if i != cand_i
            and _iou(info.box, cand_box) < 0.20
            and float(info.area) <= cand_area * float(area_ratio_limit)
            and min(info.box[2], info.box[3]) >= int(min_doc_face_size_effective)
            and (card_roi_scaled is None or _box_center_in_roi(info.box, card_roi_scaled))
        ]
        if not doc_candidates:
            continue

        # If multiple candidates exist, choose the one with highest similarity (not just smallest).
        best_sim = None
        best_doc_i = None
        for doc_i in doc_candidates:
            doc_row = try_faces_raw[doc_i]
            doc_feat = face_feature(cand_scaled, doc_row)
            sim = cosine_similarity_sface(cand_feat, doc_feat)
            if best_sim is None or sim > best_sim:
                best_sim = float(sim)
                best_doc_i = int(doc_i)

        if best_sim is None or best_doc_i is None:
            continue

        sim = float(best_sim)
        is_match = bool(sim >= float(threshold))
        match_percent = int(round(max(0.0, min(1.0, (sim + 1.0) / 2.0)) * 100))

        # Extra guard: if the selected "document face" is still too small, skip.
        if best_doc_i is not None:
            bw, bh = try_infos[best_doc_i].box[2], try_infos[best_doc_i].box[3]
            if min(bw, bh) < 60:
                continue

        candidate = {
            "ok": True,
            "engine": "OpenCV YuNet + SFace (opencv_zoo ONNX)",
            "mode": "single_image_selfie_with_card",
            "similarity": float(sim),
            "threshold": float(threshold),
            "isMatch": bool(is_match),
            "matchPercent": int(match_percent),
            "faces": {
                "faceCount": int(len(try_infos)),
                "candidateBox": _unscale_box_from_candidate(cand_box),
                "documentBox": _unscale_box_from_candidate(try_infos[best_doc_i].box),
            },
            "note": "Matched candidate (largest) against another face detected in the same frame (likely ID portrait).",
            "sameFrame": {"scoreThreshold": float(st), "docCandidates": int(len(doc_candidates))},
        }

        if best_sameframe is None or float(candidate["similarity"]) > float(best_sameframe["similarity"]):
            best_sameframe = candidate

    # 3) Find ID-card region and detect portrait face inside it (this avoids matching with random small faces).
    if card_roi is None:
        # No card ROI => ROI search is unsafe (can pick candidate face). Use same-frame only.
        if best_sameframe is not None:
            return best_sameframe
        return {
            "ok": False,
            "error": "Could not locate the ID card and could not find a reliable portrait face. Move the card closer and click the portrait face after Analyze.",
        }

    rx, ry, rw, rh = card_roi
    doc_img = _crop(img_bgr, rx, ry, rw, rh)
    doc_meta: dict[str, Any] = {"strategy": "card_roi", "roi": {"x": rx, "y": ry, "w": rw, "h": rh}}

    found = detect_best_face_for_document(doc_img)
    if found is None:
        # If same-frame produced a candidate, use it instead of failing.
        if best_sameframe is not None:
            return best_sameframe
        return {
            "ok": False,
            "error": "Detected your face, but could not find the Aadhaar/PAN/DL portrait face. Bring the card closer and ensure the portrait is clear.",
        }
    doc_used_img, doc_row, doc_infos, doc_search = found
    doc_feat = face_feature(doc_used_img, doc_row)

    sim = cosine_similarity_sface(cand_feat, doc_feat)
    is_match = bool(float(sim) >= float(threshold))
    match_percent = int(round(max(0.0, min(1.0, (float(sim) + 1.0) / 2.0)) * 100))

    def unscale_box_from_candidate(box: tuple[int, int, int, int]) -> dict[str, int]:
        x, y, w, h = box
        inv = 1.0 / float(cand_scale)
        return {"x": int(round(x * inv)), "y": int(round(y * inv)), "w": int(round(w * inv)), "h": int(round(h * inv))}

    roi_result = {
        "ok": True,
        "engine": "OpenCV YuNet + SFace (opencv_zoo ONNX)",
        "mode": "single_image_selfie_with_card",
        "similarity": float(sim),
        "threshold": float(threshold),
        "isMatch": bool(is_match),
        "matchPercent": int(match_percent),
        "faces": {
            "faceCount": int(cand_face_count),
            "candidateBox": unscale_box_from_candidate(cand_info.box),
            "documentFaceCountInSearch": int(len(doc_infos)),
        },
        "documentSearch": {"roi": doc_meta, "search": doc_search},
        "note": "Improved pairing: match candidate face (largest) with portrait detected inside the ID-card ROI when possible.",
    }

    # Choose the better similarity between same-frame and ROI-search.
    if best_sameframe is not None and float(best_sameframe["similarity"]) > float(roi_result["similarity"]):
        return best_sameframe

    return roi_result


def blur_score(img_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    return float(cv2.Laplacian(gray, cv2.CV_64F).var())


def brightness_score(img_bgr: np.ndarray) -> float:
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    return float(gray.mean())


def basic_liveness(img_bgr: np.ndarray) -> dict[str, Any]:
    """
    Basic passive checks (NOT full liveness):
    - exactly 1 face
    - face area is reasonably large
    - image not too blurry
    - brightness in a sane range
    """
    h, w = img_bgr.shape[:2]
    image_area = float(max(1, h * w))
    _, infos = detect_faces(img_bgr)
    face_count = len(infos)
    largest = max(infos, key=lambda f: f.area) if infos else None
    face_ratio = (largest.area / image_area) if largest else 0.0

    blur = blur_score(img_bgr)
    bright = brightness_score(img_bgr)

    passed = face_count == 1 and face_ratio >= 0.03 and blur >= 60.0 and 40.0 <= bright <= 220.0

    return {
        "passed": bool(passed),
        "faceCount": int(face_count),
        "faceAreaRatio": float(face_ratio),
        "blurScore": float(blur),
        "brightness": float(bright),
        "note": "Basic passive checks only (not full anti-spoof/liveness).",
    }


