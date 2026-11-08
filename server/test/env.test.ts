import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
const serverDir = path.resolve(import.meta.dirname, "..");
const indexFile = path.resolve(serverDir, "src", "index.ts");

describe("environment and server startup", () => {
  it("exits with code 1 and required message when MANDATE_SIGNING_SECRET is missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-no-env-"));
    const missingEnv = path.join(tempDir, "missing.env");
    try {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, indexFile],
        {
          cwd: tempDir,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            ENV_FILE: missingEnv,
            MANDATE_SIGNING_SECRET: "",
          },
        },
      );

      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const exitCode = await new Promise<number | null>((resolve) => {
        child.on("close", resolve);
      });

      expect(exitCode).toBe(1);
      expect(stderr).toContain(
        "MANDATE_SIGNING_SECRET environment variable is required",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("starts successfully without a .env file when MANDATE_SIGNING_SECRET is in process.env", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-missing-env-"));
    const missingEnv = path.join(tempDir, "missing.env");
    try {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, indexFile],
        {
          cwd: tempDir,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            ENV_FILE: missingEnv,
            MANDATE_SIGNING_SECRET: "test_secret_without_env_file",
            PORT: "3891",
            DATABASE_PATH: ":memory:",
          },
        },
      );

      const started = await new Promise<boolean>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("Server listening on port 3891")) {
            resolve(true);
          }
        });
        child.on("close", () => {
          resolve(false);
        });
      });

      child.kill();
      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      expect(started).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("loads MANDATE_SIGNING_SECRET and port from custom .env file when starting", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-with-env-"));
    const envPath = path.join(tempDir, ".env");
    fs.writeFileSync(
      envPath,
      "MANDATE_SIGNING_SECRET=secret_from_env_file\nPORT=3892\nDATABASE_PATH=:memory:\n",
    );

    try {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, indexFile],
        {
          cwd: tempDir,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            ENV_FILE: envPath,
          },
        },
      );

      const started = await new Promise<boolean>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("Server listening on port 3892")) {
            resolve(true);
          }
        });
        child.on("close", () => {
          resolve(false);
        });
      });

      child.kill();
      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      expect(started).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("loads values from the repository root .env file by default", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-root-env-"));
    try {
      const child = spawn(
        process.execPath,
        ["--import", tsxLoader, indexFile],
        {
          cwd: tempDir,
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            PORT: "3893",
            DATABASE_PATH: ":memory:",
          },
        },
      );

      const started = await new Promise<boolean>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("Server listening on port 3893")) {
            resolve(true);
          }
        });
        child.on("close", () => {
          resolve(false);
        });
      });

      child.kill();
      await new Promise<void>((resolve) => {
        child.on("close", () => resolve());
      });

      expect(started).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });
});
