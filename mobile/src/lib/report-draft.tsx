import { MAX_REPORT_PHOTOS } from "@smart-waste/shared";
import * as Crypto from "expo-crypto";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { DraftLocation, DraftPhoto } from "./reports";

/**
 * The report being written. Lives above the form and the map screen so both
 * can read and change it. Reset after a successful submission.
 */
export interface ReportDraft {
  categoryId: string | null;
  description: string;
  photos: DraftPhoto[];
  location: DraftLocation | null;
  /**
   * Fixed for the life of one draft. If the phone retries the upload, the API
   * recognises the key and does not create a second report.
   */
  idempotencyKey: string;
}

interface ReportDraftContextValue {
  draft: ReportDraft;
  patch: (changes: Partial<Pick<ReportDraft, "categoryId" | "description">>) => void;
  addPhotos: (photos: DraftPhoto[]) => void;
  removePhoto: (uri: string) => void;
  setLocation: (location: DraftLocation | null) => void;
  reset: () => void;
}

function emptyDraft(): ReportDraft {
  return { categoryId: null, description: "", photos: [], location: null, idempotencyKey: Crypto.randomUUID() };
}

const ReportDraftContext = createContext<ReportDraftContextValue | null>(null);

export function ReportDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<ReportDraft>(emptyDraft);

  const patch = useCallback((changes: Partial<Pick<ReportDraft, "categoryId" | "description">>) => {
    setDraft((current) => ({ ...current, ...changes }));
  }, []);

  const addPhotos = useCallback((photos: DraftPhoto[]) => {
    setDraft((current) => ({
      ...current,
      photos: [...current.photos, ...photos].slice(0, MAX_REPORT_PHOTOS),
    }));
  }, []);

  const removePhoto = useCallback((uri: string) => {
    setDraft((current) => ({ ...current, photos: current.photos.filter((photo) => photo.uri !== uri) }));
  }, []);

  const setLocation = useCallback((location: DraftLocation | null) => {
    setDraft((current) => ({ ...current, location }));
  }, []);

  const reset = useCallback(() => setDraft(emptyDraft()), []);

  const value = useMemo<ReportDraftContextValue>(
    () => ({ draft, patch, addPhotos, removePhoto, setLocation, reset }),
    [draft, patch, addPhotos, removePhoto, setLocation, reset],
  );

  return <ReportDraftContext.Provider value={value}>{children}</ReportDraftContext.Provider>;
}

export function useReportDraft(): ReportDraftContextValue {
  const ctx = useContext(ReportDraftContext);
  if (!ctx) throw new Error("useReportDraft must be used inside <ReportDraftProvider>");
  return ctx;
}
