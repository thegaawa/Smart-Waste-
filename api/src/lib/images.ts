import type { AllowedPhotoMimeType } from "@smart-waste/shared";

export interface ImageInfo {
  mimeType: AllowedPhotoMimeType;
  extension: "jpg" | "png" | "webp";
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Identifies an image by its first bytes rather than by the file name or the
 * Content-Type the client claims, so a renamed script can never be stored as
 * a "photo". Returns null for anything that is not JPEG, PNG or WebP.
 */
export function sniffImage(data: Buffer): ImageInfo | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}
