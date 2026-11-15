import { configureUploadStorage } from "../src/lib/import/storage";

configureUploadStorage()
  .then((result) => console.log(JSON.stringify({ event: "upload_storage_configured", ...result })))
  .catch((error: unknown) => {
    console.error(JSON.stringify({ event: "upload_storage_configuration_failed",
      message: error instanceof Error ? error.message : "Storage configuration failed" }));
    process.exitCode = 1;
  });
