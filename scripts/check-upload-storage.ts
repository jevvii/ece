import assert from "node:assert/strict";
import { saveUpload, configureUploadStorage } from "../src/lib/import/storage";

async function main() {
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const originalFetch = globalThis.fetch;
const previousEnv = { STORAGE_BACKEND: process.env.STORAGE_BACKEND, SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
process.env.STORAGE_BACKEND = "supabase";
process.env.SUPABASE_URL = "https://storage.example.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "synthetic-test-key";
let bucket: { public: boolean; allowed_mime_types: string[] | null; file_size_limit: number } = {
  public: false, allowed_mime_types: ["text/csv", "application/vnd.oasis.opendocument.spreadsheet"], file_size_limit: 10 * 1024 * 1024,
};
const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
globalThis.fetch = async (input, init) => {
  const url = String(input); const method = init?.method ?? "GET";
  const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
  requests.push({ url, method, body });
  if (url.includes("/object/")) {
    if (!bucket.allowed_mime_types?.includes(XLSX)) return Response.json({ statusCode: "415", error: "InvalidMimeType", message: `mime type ${XLSX} is not supported` }, { status: 400 });
    assert.equal(new Headers(init?.headers).get("Content-Type"), XLSX, "the real MIME type must be sent");
    return Response.json({ Key: "test" });
  }
  if (method === "PUT") {
    assert.equal(body?.public, false, "bucket must stay private");
    assert.equal(body?.file_size_limit, bucket.file_size_limit, "size limit must be preserved");
    bucket = { ...bucket, allowed_mime_types: body?.allowed_mime_types as string[] };
    return Response.json({ message: "Updated" });
  }
  return Response.json(bucket);
};
try {
  await assert.rejects(saveUpload("tenant", "run", "xlsx", new Uint8Array([1])), (error: unknown) =>
    error instanceof Error && error.name === "UploadStorageError" && "code" in error && error.code === "file_type_not_allowed" && !error.message.includes("synthetic-test-key"));
  await configureUploadStorage();
  assert.ok(bucket.allowed_mime_types?.includes(XLSX), "deployment adds XLSX to the existing allowlist");
  await saveUpload("tenant", "run", "xlsx", new Uint8Array([1]));
  await configureUploadStorage();
  assert.equal(requests.filter((r) => r.method === "PUT").length, 1, "configuration is idempotent");
  bucket.allowed_mime_types = ["text/csv", "application/vnd.oasis.opendocument.spreadsheet", "application/vnd.oasis.opendocument.spreadsheet"];
  await configureUploadStorage();
  assert.ok(bucket.allowed_mime_types?.includes(XLSX), "duplicate existing entries cannot hide a missing type");
  assert.equal(requests.filter((r) => r.method === "PUT").length, 2);
  bucket.allowed_mime_types = null;
  await configureUploadStorage();
  assert.equal(requests.filter((r) => r.method === "PUT").length, 2, "an unrestricted bucket already accepts supported files");
  bucket.public = true;
  await assert.rejects(configureUploadStorage(), /private/, "public visibility is never silently changed");
  process.env.STORAGE_BACKEND = "local";
  const before = requests.length;
  await configureUploadStorage();
  assert.equal(requests.length, before, "local development never calls Supabase");
  console.log("upload storage checks passed");
} finally {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

}
main().catch((error) => { console.error(error); process.exitCode = 1; });
