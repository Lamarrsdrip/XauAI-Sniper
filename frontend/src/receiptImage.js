/** Prepare a checkout receipt so phone photos upload quickly and reliably. */

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 1_500_000;

export function describeReceiptFile(file) {
  if (!file) return { ok: false, error: "Choose a photo of your receipt." };
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const image = type.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|gif|bmp)$/.test(name);
  if (!image) {
    // iPhone sometimes hands back a photo with an empty MIME type and a generic name.
    if (!type && file.size > 0 && file.size <= MAX_SOURCE_BYTES) return { ok: true };
    return { ok: false, error: "Choose a photo or screenshot of your receipt." };
  }
  if (file.size > MAX_SOURCE_BYTES) return { ok: false, error: "That photo is too large. Use one under 25 MB." };
  return { ok: true };
}

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      img.onload = null;
      img.onerror = null;
      reject(new Error("That photo took too long to open. Try a screenshot of the receipt."));
    }, 15000);
    img.onload = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Couldn't read that photo. Try a screenshot of the receipt."));
        return;
      }
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error("Couldn't open that photo. On iPhone, screenshot the receipt and attach the screenshot."));
    };
    img.src = url;
  });
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Couldn't prepare the receipt. Try a screenshot instead."));
      }, "image/jpeg", quality);
      return;
    }
    try {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      const body = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/jpeg" }));
    } catch {
      reject(new Error("Couldn't prepare the receipt. Try a screenshot instead."));
    }
  });
}

async function renderJpeg(img, edge, quality) {
  const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Couldn't prepare the receipt. Try a screenshot instead.");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return canvasToJpeg(canvas, quality);
}

export async function compressReceipt(file) {
  const img = await loadImage(file);
  let edge = 1600;
  let quality = 0.74;
  let out = await renderJpeg(img, edge, quality);
  for (let attempt = 0; attempt < 6 && out.size > 850_000; attempt += 1) {
    if (quality > 0.46) quality = Math.round((quality - 0.12) * 100) / 100;
    else edge = Math.max(800, Math.round(edge * 0.75));
    out = await renderJpeg(img, edge, quality);
  }
  if (out.size > MAX_UPLOAD_BYTES) {
    throw new Error("That receipt is still too large. Crop it to the transfer and try again.");
  }
  return out;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      const comma = value.indexOf(",");
      if (comma < 0) reject(new Error("Couldn't encode the receipt."));
      else resolve(value.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Couldn't encode the receipt."));
    reader.readAsDataURL(blob);
  });
}

/** Snapshot the file before any UI update disables the input. iOS drops the File if you don't. */
export async function prepareReceipt(file) {
  const check = describeReceiptFile(file);
  if (!check.ok) throw new Error(check.error);
  const jpeg = await compressReceipt(file);
  return { mime_type: "image/jpeg", data_base64: await blobToBase64(jpeg) };
}
