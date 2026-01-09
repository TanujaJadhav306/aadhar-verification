import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "models");
const VENDOR_DIR = path.join(ROOT, "public", "vendor");

// Official face-api.js weights (GitHub raw)
const BASE =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights";
const FACE_API_JS =
  "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/dist/face-api.min.js";

const MANIFESTS = [
  // Face detection (from your list): MTCNN
  "mtcnn_model-weights_manifest.json",
  // Stronger detector for small faces in ID documents
  "ssd_mobilenetv1_model-weights_manifest.json",
  // Alternate lightweight detector (optional)
  "tiny_face_detector_model-weights_manifest.json",
  // Landmarks + recognition (descriptor)
  "face_landmark_68_model-weights_manifest.json",
  "face_recognition_model-weights_manifest.json",
];

async function downloadOne(name) {
  const url = `${BASE}/${name}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${name}: ${res.status} ${res.statusText}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(path.join(OUT_DIR, name), buf);
  process.stdout.write(`Downloaded ${name}\n`);
}

async function downloadFileTo(url, outPath) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download ${url}: ${res.status} ${res.statusText}`
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(outPath, buf);
  process.stdout.write(`Downloaded ${path.basename(outPath)}\n`);
}

async function readJson(filePath) {
  const txt = await fs.readFile(filePath, "utf8");
  return JSON.parse(txt);
}

await fs.mkdir(OUT_DIR, { recursive: true });
await fs.mkdir(VENDOR_DIR, { recursive: true });

// Download face-api browser bundle locally (avoids CDN restrictions).
await downloadFileTo(FACE_API_JS, path.join(VENDOR_DIR, "face-api.min.js"));

for (const m of MANIFESTS) {
  // eslint-disable-next-line no-await-in-loop
  await downloadOne(m);

  const manifestPath = path.join(OUT_DIR, m);
  // eslint-disable-next-line no-await-in-loop
  const json = await readJson(manifestPath);

  // Some face-api manifests are:
  // - { weightsManifest: [{ paths: [...] }] }
  // - OR just an array: [{ paths: [...] }]
  const weightsManifest = Array.isArray(json)
    ? json
    : Array.isArray(json?.weightsManifest)
    ? json.weightsManifest
    : [];

  const paths = weightsManifest.flatMap((wm) =>
    Array.isArray(wm?.paths) ? wm.paths : []
  );

  for (const p of paths) {
    // eslint-disable-next-line no-await-in-loop
    await downloadOne(p);
  }
}
process.stdout.write(`\nDone. Models saved to ${OUT_DIR}\n`);
