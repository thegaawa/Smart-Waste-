import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

import type { DraftPhoto } from "./reports";

/**
 * Photos are shrunk on the phone before upload: longest side 1280 px, JPEG
 * quality 0.7. That is roughly 150–400 KB per photo instead of 3–8 MB, which
 * matters on mobile data (Chapter 3.12 / Recommendation 3).
 */
const MAX_SIDE_PX = 1280;
const JPEG_QUALITY = 0.7;

export class PhotoPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoPermissionError";
  }
}

async function compress(asset: ImagePicker.ImagePickerAsset): Promise<DraftPhoto> {
  const context = ImageManipulator.manipulate(asset.uri);
  const longest = Math.max(asset.width, asset.height);
  if (longest > MAX_SIDE_PX && asset.width > 0 && asset.height > 0) {
    const scale = MAX_SIDE_PX / longest;
    context.resize({ width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return {
    uri: saved.uri,
    width: saved.width,
    height: saved.height,
    fileName: `photo-${Date.now()}-${Math.floor(Math.random() * 1000)}.jpg`,
    mimeType: "image/jpeg",
  };
}

/** Opens the camera. Returns null when the user backs out. */
export async function takePhoto(): Promise<DraftPhoto | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new PhotoPermissionError(
      "Camera access was not allowed. Allow it in your phone's Settings, then take the photo again",
    );
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9, exif: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return asset ? compress(asset) : null;
}
