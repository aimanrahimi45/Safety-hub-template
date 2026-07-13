// =====================================================================
// Client-side image resize utility.
//
// Used by:
//   * /app/contractors/<id>/induct  — worker photo + signature pad
//   * /app/first-aid/new            — signature pad
//
// Goal: keep Supabase Storage buckets small by re-encoding photos
// and signature canvases to a max dimension + JPEG/PNG quality
// before upload. A 4MB phone-camera photo typically compresses to
// < 100KB at 800x800 / quality 0.7, and a signature canvas to
// < 10KB at 200x100 / quality 0.7.
//
// Works for:
//   * File objects (from <input type="file">)
//   * dataURL strings (from canvas.toDataURL() for signatures)
//   * Blob objects (programmatic, e.g. from fetch)
//
// Returns both a Blob (for upload) and a dataURL (for preview).
// Returns the original dimensions, the new dimensions, and the
// original/new byte sizes so the UI can show "Reduced from 2.4MB
// to 95KB" hints.
// =====================================================================

export interface ResizeOptions {
  maxWidth: number;
  maxHeight: number;
  quality: number;
  outputType: 'image/jpeg' | 'image/png' | 'image/webp';
}

export interface ResizeResult {
  blob: Blob;
  dataUrl: string;
  width: number;
  height: number;
  originalSize: number;
  newSize: number;
}

export class ResizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResizeError';
  }
}

async function blobFromInput(input: File | Blob | string): Promise<{ blob: Blob; size: number }> {
  if (typeof input === 'string') {
    // Assume data URL: "data:<mime>;base64,<payload>"
    const m = input.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) {
      throw new ResizeError('Invalid data URL input');
    }
    const isBase64 = !!m[2];
    const payload = m[3] ?? '';
    if (!isBase64) {
      // URL-encoded form (rare) — fall back to fetch.
      const resp = await fetch(input);
      if (!resp.ok) throw new ResizeError(`Failed to fetch data URL: ${resp.status}`);
      const blob = await resp.blob();
      return { blob, size: blob.size };
    }
    const binary = atob(payload);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const mime = m[1] || 'application/octet-stream';
    return { blob: new Blob([bytes], { type: mime }), size: bytes.byteLength };
  }
  return { blob: input, size: input.size };
}

function loadImageFromBlob(blob: Blob): Promise<{ image: HTMLImageElement; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;
      URL.revokeObjectURL(url);
      resolve({ image, width, height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ResizeError('Failed to decode image (unsupported format or corrupt data)'));
    };
    image.src = url;
  });
}

function computeTarget(width: number, height: number, maxW: number, maxH: number): { width: number; height: number } {
  if (width <= maxW && height <= maxH) return { width, height };
  const ratioW = maxW / width;
  const ratioH = maxH / height;
  const ratio = Math.min(ratioW, ratioH);
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new ResizeError('Canvas toBlob returned null (browser refused the encode)'));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

export async function resizeImage(
  input: File | Blob | string,
  options: ResizeOptions,
): Promise<ResizeResult> {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    throw new ResizeError('resizeImage requires a browser environment (document)');
  }
  if (!options || !options.outputType) {
    throw new ResizeError('resizeImage: options.outputType is required');
  }
  const quality = Math.min(1, Math.max(0, options.quality));

  const { blob: sourceBlob, size: originalSize } = await blobFromInput(input);
  const { image, width: srcW, height: srcH } = await loadImageFromBlob(sourceBlob);
  const { width: dstW, height: dstH } = computeTarget(srcW, srcH, options.maxWidth, options.maxHeight);

  const canvas = document.createElement('canvas');
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new ResizeError('Canvas 2D context not available in this browser');
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, dstW, dstH);
  ctx.drawImage(image, 0, 0, dstW, dstH);

  const blob = await canvasToBlob(canvas, options.outputType, quality);
  const dataUrl = canvas.toDataURL(options.outputType, quality);
  return {
    blob,
    dataUrl,
    width: dstW,
    height: dstH,
    originalSize,
    newSize: blob.size,
  };
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
