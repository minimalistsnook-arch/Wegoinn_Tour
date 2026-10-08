import { CONFIG } from "./config.js";
import { supabase } from "./supabase.js";

// Feed column is 760px wide, so 1280px stays sharp on 1.5x+ screens.
const MAX_EDGE = 1280;
const MIN_EDGE = 720;
// Aim for ~150 KB per photo (≈ 6,500 photos per GB of storage).
const TARGET_BYTES = 150 * 1024;
const QUALITIES = [0.72, 0.62, 0.52, 0.45];
const MAX_INPUT_BYTES = 25 * 1024 * 1024;

export const isImageUploadConfigured = () => Boolean(supabase && CONFIG.IMAGE_BUCKET);

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

function drawScaled(source, longEdge) {
  const scale = Math.min(1, longEdge / Math.max(source.width, source.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(source.width * scale);
  canvas.height = Math.round(source.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function encode(canvas, quality) {
  const webp = await canvasToBlob(canvas, "image/webp", quality);
  if (webp?.type === "image/webp") return webp;
  return canvasToBlob(canvas, "image/jpeg", quality);
}

/**
 * Shrinks a photo as far as it can while staying sharp in the feed:
 * long edge ≤ 1280px, re-encoded as WebP (JPEG fallback), stepping quality
 * down — then size down toward 720px — until it is ≤ ~150 KB.
 * Metadata (EXIF/GPS) is dropped. The original file is never uploaded.
 */
export async function compressImage(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("Please choose an image file.");
  if (file.size > MAX_INPUT_BYTES) throw new Error("That photo is too large (max 25 MB).");

  const source = await loadImage(file);
  let blob = null;
  try {
    for (let edge = MAX_EDGE; ; edge = Math.max(MIN_EDGE, Math.round(edge * 0.8))) {
      const canvas = drawScaled(source, edge);
      for (const quality of QUALITIES) {
        blob = await encode(canvas, quality);
        if (!blob || blob.size <= TARGET_BYTES) break;
      }
      if (!blob || blob.size <= TARGET_BYTES || edge === MIN_EDGE) break;
    }
  } finally {
    source.close?.();
  }
  if (!blob) throw new Error("Could not process this photo.");

  const ext = blob.type === "image/webp" ? "webp" : "jpg";
  const base = (file.name || "photo").replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 40) || "photo";
  return new File([blob], `${base}.${ext}`, { type: blob.type });
}

/**
 * Uploads an already-compressed image to Supabase Storage and returns its
 * public https URL. Only that URL is stored in posts.image_url.
 * Files go under <auth uid>/ — Storage policies only allow writing there.
 */
export async function uploadImage(file) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again to add a photo.");

  const ext = file.type === "image/webp" ? "webp" : "jpg";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const bucket = supabase.storage.from(CONFIG.IMAGE_BUCKET);

  const { error } = await bucket.upload(path, file, {
    contentType: file.type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw new Error("Photo upload failed. Please try again.");

  const { data: { publicUrl } } = bucket.getPublicUrl(path);
  return publicUrl;
}
