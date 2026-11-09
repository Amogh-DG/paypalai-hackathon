import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";

const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
const serverDir = fileURLToPath(new URL("..", import.meta.url));
const indexFile = path.resolve(serverDir, "src", "index.ts");
const realShadyDir = path.resolve(serverDir, "public", "shady");

describe("production serving and startup", () => {
  let server: Server;
  let baseUrl: string;
  let tempWebDir: string;
  let tempShadyDir: string;
  let initialRealShadyFiles: string[];

  beforeAll(async () => {
    initialRealShadyFiles = fs.readdirSync(realShadyDir).sort();

    tempWebDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-prod-web-"));
    fs.writeFileSync(
      path.join(tempWebDir, "index.html"),
      "<!DOCTYPE html><html><head><title>Leash App</title></head><body><div id=\"root\"></div></body></html>",
    );

    tempShadyDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-prod-shady-"));
    fs.writeFileSync(
      path.join(tempShadyDir, "test-shady.html"),
      "<html><body>Shady Deal</body></html>",
    );
    fs.writeFileSync(path.join(tempShadyDir, ".gitkeep"), "");

    const db = createDb(":memory:");
    const app = createApp(db, {
      signingSecret: "test-secret-prod",
      isProduction: true,
      webDist: tempWebDir,
      shadyDir: tempShadyDir,
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
    if (fs.existsSync(tempWebDir)) {
      fs.rmSync(tempWebDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempShadyDir)) {
      fs.rmSync(tempShadyDir, { recursive: true, force: true });
    }
    const finalRealShadyFiles = fs.readdirSync(realShadyDir).sort();
    expect(finalRealShadyFiles).toEqual(initialRealShadyFiles);
  });

  it("serves index.html at root path /", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<title>Leash App</title>");
  });

  it("serves index.html for deep SPA routes", async () => {
    const res = await fetch(`${baseUrl}/some/deep/path?proposal=123`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("<title>Leash App</title>");
  });

  it("returns JSON 404 for nonexistent /api/* routes", async () => {
    const res = await fetch(`${baseUrl}/api/nonexistent`);
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/json");
    const json = await res.json();
    expect(json).toEqual({
      error: {
        code: "not_found",
        message: "Route not found",
      },
    });
  });

  it("serves static content from /shady from the temporary folder", async () => {
    const res = await fetch(`${baseUrl}/shady/test-shady.html`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Shady Deal");
  });

  it("returns 404 for a missing file under /shady", async () => {
    const res = await fetch(`${baseUrl}/shady/missing-file.html`);
    expect(res.status).toBe(404);
  });

  it("does not serve .gitkeep under /shady", async () => {
    const res = await fetch(`${baseUrl}/shady/.gitkeep`);
    expect(res.status).toBe(404);
  });

  it("leaves the real server/public/shady listing unchanged", () => {
    const currentFiles = fs.readdirSync(realShadyDir).sort();
    expect(currentFiles).toEqual(initialRealShadyFiles);
  });

  it("serves from the real folder by default when shadyDir is not specified", async () => {
    const defaultApp = createApp(createDb(":memory:"));
    let defaultServer!: Server;
    let defaultUrl = "";
    await new Promise<void>((resolve) => {
      defaultServer = defaultApp.listen(0, "127.0.0.1", () => {
        const addr = defaultServer.address() as AddressInfo;
        defaultUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    try {
      const missingRes = await fetch(`${defaultUrl}/shady/nonexistent.html`);
      expect(missingRes.status).toBe(404);
      const gitkeepRes = await fetch(`${defaultUrl}/shady/.gitkeep`);
      expect(gitkeepRes.status).toBe(404);
    } finally {
      await new Promise<void>((resolve) => {
        defaultServer.close(() => resolve());
      });
    }
  });

  it("responds to /health quickly without touching database", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: "ok" });
  });

  it("fails to start in production if PUBLIC_BASE_URL is missing", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-prod-missing-url-"));
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
            NODE_ENV: "production",
            MANDATE_SIGNING_SECRET: "prod-secret-test",
            PUBLIC_BASE_URL: "",
            PORT: "3941",
            DATABASE_PATH: ":memory:",
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
        "PUBLIC_BASE_URL environment variable is required in production",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 20000);

  it("fails to start in production if PUBLIC_BASE_URL does not start with https://", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-prod-http-url-"));
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
            NODE_ENV: "production",
            MANDATE_SIGNING_SECRET: "prod-secret-test",
            PUBLIC_BASE_URL: "http://insecure.example.com",
            PORT: "3942",
            DATABASE_PATH: ":memory:",
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
        "PUBLIC_BASE_URL must be an https URL in production",
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 20000);

  it("starts in production when PUBLIC_BASE_URL is a valid https URL", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-prod-valid-url-"));
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
            NODE_ENV: "production",
            MANDATE_SIGNING_SECRET: "prod-secret-test",
            PUBLIC_BASE_URL: "https://leash.onrender.com",
            PORT: "3943",
            DATABASE_PATH: ":memory:",
          },
        },
      );

      const started = await new Promise<boolean>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("Server listening on port 3943")) {
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
  }, 20000);

  it("preserves development behavior when NODE_ENV is not production", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "leash-dev-start-"));
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
            NODE_ENV: "development",
            MANDATE_SIGNING_SECRET: "dev-secret-test",
            PUBLIC_BASE_URL: "http://localhost:3001",
            PORT: "3944",
            DATABASE_PATH: ":memory:",
          },
        },
      );

      const started = await new Promise<boolean>((resolve) => {
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("Server listening on port 3944")) {
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
  }, 20000);
});
