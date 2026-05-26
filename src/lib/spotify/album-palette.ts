"use client";

/**
 * Extract a dominant color from an album-art image URL and convert it to
 * an `hsl()` string suitable for use as a CSS variable.
 *
 * The result is intentionally low-saturation and pegged to a high
 * lightness so it can be composed as a tint layer (the consumer applies
 * its own alpha via the sanctioned translucency scale). This avoids the
 * "lava-lamp" failure mode where vivid album art drowns the foreground
 * text contrast inside sprint canvases.
 *
 * Returns `null` when:
 *  - SSR (no window)
 *  - the image fails CORS / 404s
 *  - the image is effectively monochrome black/white (no useful tint)
 *
 * The Spotify CDN serves album art with `Access-Control-Allow-Origin: *`,
 * so the canvas read-back works without taint. If a future provider
 * doesn't, the image.crossOrigin="anonymous" load will fail and we
 * return null — callers handle that as "no tint" gracefully.
 */
export async function extractAlbumPalette(
  url: string
): Promise<{ hsl: string; raw: { h: number; s: number; l: number } } | null> {
  if (typeof window === "undefined") return null;
  try {
    const img = await loadImage(url);
    const sample = sampleDownscaled(img, 24);
    if (!sample) return null;
    const dominant = pickDominant(sample);
    if (!dominant) return null;
    // Push into a calm range so it tints rather than dominates.
    const h = dominant.h;
    const s = clamp(dominant.s * 0.7, 12, 55);
    const l = clamp(dominant.l, 38, 68);
    return { hsl: `hsl(${h.toFixed(0)} ${s.toFixed(0)}% ${l.toFixed(0)}%)`, raw: { h, s, l } };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

interface RGBA {
  r: number;
  g: number;
  b: number;
}

function sampleDownscaled(img: HTMLImageElement, size: number): RGBA[] | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }
  const out: RGBA[] = [];
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 200) continue;
    out.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  return out.length > 0 ? out : null;
}

/**
 * Pick the dominant chromatic color via coarse hue bucketing. We weight
 * each sample by its saturation so a black-and-white album art doesn't
 * report "black" as dominant — instead the small amount of color present
 * wins, which gives a usable tint. If the whole image is achromatic we
 * return null.
 */
function pickDominant(samples: RGBA[]): { h: number; s: number; l: number } | null {
  const buckets = new Map<number, { count: number; h: number; s: number; l: number }>();
  let totalChromaWeight = 0;
  for (const px of samples) {
    const hsl = rgbToHsl(px.r, px.g, px.b);
    if (hsl.s < 8) continue;
    if (hsl.l < 6 || hsl.l > 94) continue;
    const bucket = Math.floor(hsl.h / 15) * 15;
    const weight = hsl.s / 100;
    totalChromaWeight += weight;
    const prev = buckets.get(bucket);
    if (prev) {
      prev.count += weight;
      prev.h = (prev.h * (prev.count - weight) + hsl.h * weight) / prev.count;
      prev.s = (prev.s * (prev.count - weight) + hsl.s * weight) / prev.count;
      prev.l = (prev.l * (prev.count - weight) + hsl.l * weight) / prev.count;
    } else {
      buckets.set(bucket, { count: weight, h: hsl.h, s: hsl.s, l: hsl.l });
    }
  }
  if (totalChromaWeight < 1) return null;
  let best: { count: number; h: number; s: number; l: number } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rN = r / 255;
  const gN = g / 255;
  const bN = b / 255;
  const max = Math.max(rN, gN, bN);
  const min = Math.min(rN, gN, bN);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: l * 100 };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case rN:
      h = ((gN - bN) / d + (gN < bN ? 6 : 0)) * 60;
      break;
    case gN:
      h = ((bN - rN) / d + 2) * 60;
      break;
    default:
      h = ((rN - gN) / d + 4) * 60;
      break;
  }
  return { h, s: s * 100, l: l * 100 };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
