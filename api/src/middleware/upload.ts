import { MAX_PHOTO_BYTES, MAX_REPORT_PHOTOS } from "@smart-waste/shared";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";

import { ApiError } from "../lib/errors.js";

/** A file received in a multipart request, held in memory until it is checked and stored. */
export interface UploadedFile {
  originalName: string;
  buffer: Buffer;
  size: number;
}

const MAX_PHOTO_MB = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));

const uploader = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_PHOTO_BYTES,
    files: MAX_REPORT_PHOTOS,
    fields: 30,
    fieldSize: 16 * 1024,
  },
});

function describeMulterError(error: multer.MulterError, fieldName: string): string {
  switch (error.code) {
    case "LIMIT_FILE_SIZE":
      return `Each photo must be smaller than ${MAX_PHOTO_MB} MB`;
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return `You can attach up to ${MAX_REPORT_PHOTOS} photos in the "${fieldName}" field`;
    case "LIMIT_FIELD_COUNT":
    case "LIMIT_FIELD_KEY":
    case "LIMIT_FIELD_VALUE":
    case "LIMIT_PART_COUNT":
      return "The form has too many or too large fields";
    default:
      return "The upload could not be read. Please try again";
  }
}

/**
 * Reads `multipart/form-data` with up to MAX_REPORT_PHOTOS files in `fieldName`.
 * Text fields end up in `req.body` (as strings); files in `req.files`.
 * Requests that are not multipart pass through untouched (JSON bodies were
 * already parsed by express.json()).
 */
export function photoUpload(fieldName = "photos"): RequestHandler {
  const handler = uploader.array(fieldName, MAX_REPORT_PHOTOS);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.is("multipart/form-data")) {
      next();
      return;
    }
    handler(req, res, (error: unknown) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof multer.MulterError) {
        next(ApiError.validation([{ field: fieldName, message: describeMulterError(error, fieldName) }]));
        return;
      }
      next(error);
    });
  };
}

/** The files multer attached to the request, in a stable shape. */
export function uploadedFiles(req: Request): UploadedFile[] {
  const files = Array.isArray(req.files) ? req.files : [];
  return files.map((file) => ({ originalName: file.originalname, buffer: file.buffer, size: file.size }));
}
