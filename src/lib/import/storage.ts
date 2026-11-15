import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Uploaded time-report files are stored in one of two places:
 *
 * - `local`    — a project-owned directory (`.data/uploads`), used in development.
 * - `supabase` — a private Supabase Storage bucket, used in staging and production.
 *
 * The backend is chosen from the environment. Render's filesystem is ephemeral,
 * so a deployed instance must never fall back to local disk silently: if
 * `STORAGE_BACKEND=supabase` is set and the Supabase credentials are missing,
 * every call fails loudly instead of writing files that will disappear.
 */

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");
const SUPABASE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "ece-uploads";
const TIMEOUT_MS = 15_000;

/**
 * Supabase enforces a bucket's `allowedMimeTypes` against the Content-Type we
 * send, so the header has to describe the real file. Anything unrecognised is
 * sent as octet-stream and will be rejected by a restricted bucket — which is
 * the intended outcome.
 */
const CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type SupabaseConfig = { url: string; key: string };

function supabaseConfig(): SupabaseConfig | null {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return { url, key };
}

export function storageBackend(): "local" | "supabase" {
  const configured = process.env.STORAGE_BACKEND?.trim().toLowerCase();
  if (configured && configured !== "local" && configured !== "supabase") {
    throw new Error(`STORAGE_BACKEND must be "local" or "supabase", received "${configured}"`);
  }
  if (configured === "supabase") {
    if (!supabaseConfig()) {
      throw new Error(
        "STORAGE_BACKEND=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
      );
    }
    return "supabase";
  }
  return configured === "local" ? "local" : supabaseConfig() ? "supabase" : "local";
}

function objectUrl({ url }: SupabaseConfig, key: string) {
  const object = key.split("/").map(encodeURIComponent).join("/");
  return `${url}/storage/v1/object/${encodeURIComponent(SUPABASE_BUCKET)}/${object}`;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function storageError(action: string, status: number, detail: string) {
  if (action === "upload") {
    const code = (status === 400 || status === 415) && /mime|content.?type/i.test(detail) ? "file_type_not_allowed" : "unavailable";
    return new UploadStorageError(code, status);
  }
  return new Error(`Supabase Storage ${action} failed (${status})`);
}

export class UploadStorageError extends Error {
  constructor(readonly code: "file_type_not_allowed" | "unavailable", readonly status?: number) {
    super(code === "file_type_not_allowed"
      ? "This file type is temporarily unavailable. Save the spreadsheet as CSV or ODS and try again."
      : "The file could not be saved. Please try again in a moment.");
    this.name = "UploadStorageError";
  }
}

/** Deployment check: add supported formats without changing privacy or size limits. */
export async function configureUploadStorage() {
  if (storageBackend() === "local") return { backend: "local", updated: false };
  const config = supabaseConfig()!;
  const url = `${config.url}/storage/v1/bucket/${encodeURIComponent(SUPABASE_BUCKET)}`;
  const headers = { Authorization: `Bearer ${config.key}`, "Content-Type": "application/json" };
  const response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) throw storageError("bucket configuration read", response.status, "");
  const bucket = await response.json() as { public: unknown; allowed_mime_types: unknown; file_size_limit?: number | null };
  if (bucket.public !== false) throw new Error("The upload storage bucket must be private.");
  if (bucket.allowed_mime_types === null) return { backend: "supabase", updated: false };
  if (!Array.isArray(bucket.allowed_mime_types) || bucket.allowed_mime_types.some((value) => typeof value !== "string")) {
    throw new Error("The upload bucket returned an invalid file type configuration.");
  }
  const current: string[] = bucket.allowed_mime_types;
  const required = Object.values(CONTENT_TYPES);
  if (required.every((type) => current.includes(type))) return { backend: "supabase", updated: false };
  const allowed = [...new Set([...current, ...required])];
  const update = await fetch(url, {
    method: "PUT", headers, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    body: JSON.stringify({ id: SUPABASE_BUCKET, name: SUPABASE_BUCKET, public: false,
      allowed_mime_types: allowed, file_size_limit: bucket.file_size_limit }),
  });
  if (!update.ok) throw storageError("bucket configuration update", update.status, "");
  return { backend: "supabase", updated: true };
}

function normaliseKey(storageKey: string) {
  const key = storageKey.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!key || key.split("/").some((segment) => segment === "" || segment === ".." || segment === ".")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

export async function saveUpload(
  tenantId: string,
  runId: string,
  extension: string,
  data: Uint8Array,
) {
  const key = normaliseKey(`${tenantId}/${runId}.${extension}`);

  if (storageBackend() === "local") {
    const directory = path.join(LOCAL_ROOT, tenantId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(LOCAL_ROOT, key), data);
    return key;
  }

  const config = supabaseConfig()!;
  const response = await fetch(objectUrl(config, key), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.key}`,
      "Content-Type": CONTENT_TYPES[extension.toLowerCase()] ?? "application/octet-stream",
      "x-upsert": "true",
    },
    body: toArrayBuffer(data),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw storageError("upload", response.status, (await response.text()).slice(0, 200));
  }
  return key;
}

export async function readUpload(storageKey: string): Promise<Uint8Array> {
  const key = normaliseKey(storageKey);

  if (storageBackend() === "local") {
    const root = path.resolve(LOCAL_ROOT);
    const resolved = path.resolve(root, key);
    if (!resolved.startsWith(root + path.sep)) {
      throw new Error("Invalid storage key");
    }
    return readFile(resolved);
  }

  const config = supabaseConfig()!;
  const response = await fetch(objectUrl(config, key), {
    headers: { Authorization: `Bearer ${config.key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw storageError("download", response.status, (await response.text()).slice(0, 200));
  }
  return new Uint8Array(await response.arrayBuffer());
}

/** True when the deployment is configured to persist uploads off-instance. */
export function usesPersistentStorage() {
  return storageBackend() === "supabase";
}
