import { CONFIG } from "./config.js";
import { supabase } from "./supabase.js";

const MAX_EDGE = 1600;
const QUALITY = 0.78;
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const isImageUploadConfigured = () => Boolean(CONFIG.R2_UPLOAD_ENDPOINT);

async function loadImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch { /* fall back to <img> (e.g. older Safari) */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Resizes so the long edge is ≤ 1600px (aspect ratio kept) and re-encodes
 * as WebP (~0.78). Falls back to JPEG on browsers that can't encode WebP.
 * The original high-resolution file is never uploaded.
 */
export async function compressImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That photo is too large (max 25 MB).");

  const source = await loadImage(file);
  const width = source.width;
  const height = source.height;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, w, h);
  source.close?.();

  let blob = await canvasToBlob(canvas, "image/webp", QUALITY);
  if (!blob || blob.type !== "image/webp") blob = await canvasToBlob(canvas, "image/jpeg", QUALITY);
  if (!blob) throw new Error("Could not process this photo.");

  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const base = (file.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 40) || "photo";
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

/**
 * Uploads an already-compressed image and returns its public https URL.
 * Only that URL is stored in posts.image_url.
 *
 * Expected server contract (e.g. a Cloudflare Worker bound to an R2 bucket):
 *   POST <R2_UPLOAD_ENDPOINT>
 *   Authorization: Bearer <Supabase access token>   ← Worker must verify it
 *   Content-Type: image/webp | image/jpeg
 *   body: the compressed file
 *   → 200 { "url": "https://images.example.com/posts/<uuid>.webp" }
 * R2 credentials stay inside the Worker; never in this file.
 */
export async function uploadImageToR2(file) {
  // TODO: Connect Cloudflare R2 upload API
  if (!isImageUploadConfigured()) {
    throw new Error("Photo upload isn't connected yet. You can post text for now.");
  }

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(CONFIG.R2_UPLOAD_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": file.type,
    },
    body: file,
  });
  if (!res.ok) throw new Error("Photo upload failed. Please try again.");
  const { url } = await res.json();
  if (!/^https:\/\//.test(url || "")) throw new Error("Upload returned an invalid URL.");
  return url;
}
