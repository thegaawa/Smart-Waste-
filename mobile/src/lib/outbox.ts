import { Directory, File, Paths } from "expo-file-system";
import { useEffect, useState } from "react";
import { Platform } from "react-native";

import type { DraftLocation, DraftPhoto } from "./reports";

/**
 * The outbox: reports saved on the phone that the server has not confirmed yet
 * (Chapter 4.6 connectivity handling, T09).
 *
 * Rule: a report is written here *before* it is sent and removed only when the
 * API answers 201. If the network drops, the app is closed, or the answer is
 * lost, the report is still here, marked "Not sent yet", ready to retry with
 * the same idempotency key — so the server never stores it twice.
 *
 * Storage: a JSON index plus a copy of each photo in the app's document
 * folder (safe from cache clean-ups). In a web browser (development only) the
 * index lives in localStorage and photos are not copied.
 */
export interface PendingReport {
  /** Same value as `idempotencyKey`. */
  id: string;
  categoryId: string;
  categoryName: string;
  description: string;
  location: DraftLocation;
  photos: DraftPhoto[];
  idempotencyKey: string;
  savedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export type PendingReportInput = Pick<
  PendingReport,
  "categoryId" | "categoryName" | "description" | "location" | "photos" | "idempotencyKey"
>;

const WEB_STORAGE_KEY = "smart-waste.outbox";
const isWeb = Platform.OS === "web";

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function outboxDirectory(): Directory {
  return new Directory(Paths.document, "outbox");
}

function indexFile(): File {
  return new File(outboxDirectory(), "outbox.json");
}

function photoDirectory(id: string): Directory {
  return new Directory(outboxDirectory(), id);
}

function parseIndex(text: string | null): PendingReport[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as PendingReport[]) : [];
  } catch {
    return [];
  }
}

async function readIndex(): Promise<PendingReport[]> {
  if (isWeb) {
    return parseIndex(typeof localStorage === "undefined" ? null : localStorage.getItem(WEB_STORAGE_KEY));
  }
  const file = indexFile();
  if (!file.exists) return [];
  return parseIndex(await file.text());
}

async function writeIndex(items: PendingReport[]): Promise<void> {
  const text = JSON.stringify(items);
  if (isWeb) {
    if (typeof localStorage !== "undefined") localStorage.setItem(WEB_STORAGE_KEY, text);
    return;
  }
  outboxDirectory().create({ intermediates: true, idempotent: true });
  indexFile().write(text);
}

/** Copies photos out of the cache into the outbox folder so they survive until sent. */
async function persistPhotos(id: string, photos: DraftPhoto[]): Promise<DraftPhoto[]> {
  if (isWeb || photos.length === 0) return photos;
  const dir = photoDirectory(id);
  dir.create({ intermediates: true, idempotent: true });
  const result: DraftPhoto[] = [];
  for (const photo of photos) {
    if (photo.uri.startsWith(dir.uri)) {
      result.push(photo);
      continue;
    }
    const destination = new File(dir, photo.fileName);
    try {
      if (!destination.exists) await new File(photo.uri).copy(destination);
      result.push({ ...photo, uri: destination.uri });
    } catch {
      // The original is still readable for now; keep pointing at it.
      result.push(photo);
    }
  }
  return result;
}

function deletePhotos(id: string): void {
  if (isWeb) return;
  try {
    const dir = photoDirectory(id);
    if (dir.exists) dir.delete();
  } catch {
    // Best effort: a leftover folder is harmless.
  }
}

// ---------------------------------------------------------------------------
// In-memory copy + change notifications
// ---------------------------------------------------------------------------

let cache: PendingReport[] | null = null;
let loading: Promise<PendingReport[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

async function commit(items: PendingReport[]): Promise<void> {
  cache = items;
  await writeIndex(items);
  notify();
}

/** Everything waiting to be sent, oldest first. Loaded from disk once. */
export async function getOutbox(): Promise<PendingReport[]> {
  if (cache) return cache;
  if (!loading) {
    loading = readIndex()
      .then((items) => {
        cache = items;
        return items;
      })
      .finally(() => {
        loading = null;
      });
  }
  return loading;
}

/** Saves (or refreshes) a report in the outbox. Call this right before sending. */
export async function savePending(input: PendingReportInput): Promise<PendingReport> {
  const items = await getOutbox();
  const existing = items.find((item) => item.id === input.idempotencyKey);
  const photos = await persistPhotos(input.idempotencyKey, input.photos);
  const entry: PendingReport = {
    id: input.idempotencyKey,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    description: input.description,
    location: input.location,
    photos,
    idempotencyKey: input.idempotencyKey,
    savedAt: existing?.savedAt ?? new Date().toISOString(),
    attempts: existing?.attempts ?? 0,
    lastAttemptAt: existing?.lastAttemptAt ?? null,
    lastError: existing?.lastError ?? null,
  };
  await commit(existing ? items.map((item) => (item.id === entry.id ? entry : item)) : [...items, entry]);
  return entry;
}

/** Records that a send was tried and why it did not succeed. */
export async function recordAttempt(id: string, error: string): Promise<void> {
  const items = await getOutbox();
  if (!items.some((item) => item.id === id)) return;
  const now = new Date().toISOString();
  await commit(
    items.map((item) =>
      item.id === id ? { ...item, attempts: item.attempts + 1, lastAttemptAt: now, lastError: error } : item,
    ),
  );
}

/** Removes a report from the outbox (confirmed by the server, or discarded by the user). */
export async function removePending(id: string): Promise<void> {
  const items = await getOutbox();
  if (!items.some((item) => item.id === id)) return;
  deletePhotos(id);
  await commit(items.filter((item) => item.id !== id));
}

/** Live view of the outbox for screens. `null` until loaded. */
export function useOutbox(): PendingReport[] | null {
  const [items, setItems] = useState<PendingReport[] | null>(cache);

  useEffect(() => {
    let active = true;
    const listener = () => {
      if (active) setItems(cache ? [...cache] : []);
    };
    listeners.add(listener);
    getOutbox().then(
      (loaded) => {
        if (active) setItems([...loaded]);
      },
      () => {
        if (active) setItems([]);
      },
    );
    return () => {
      active = false;
      listeners.delete(listener);
    };
  }, []);

  return items;
}
