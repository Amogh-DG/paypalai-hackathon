import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createDb } from "../src/db.js";
import { createApp } from "../src/app.js";
import { AppError } from "../src/http/errors.js";
import { runAgent } from "../src/agent/index.js";

vi.mock("../src/agent/index.js", () => ({ runAgent: vi.fn() }));

describe("POST /api/chat", () => {
  let server: Server;
  let baseUrl: string;
  let db: ReturnType<typeof createDb>;
  const result = {
    reply: "Found a gift.",
    proposalIds: ["prop-1"],
    toolTrace: [{ tool: "search_products", summary: "Found products" }],
  };

  beforeEach(async () => {
    vi.mocked(runAgent).mockReset();
    vi.mocked(runAgent).mockResolvedValue(result);
    db = createDb(":memory:");
    const app = createApp(db, { signingSecret: "chat-test-secret" });
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
    db.close();
  });

  function post(body: unknown) {
    return fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns exactly the contract fields, preserves sessionId and trims the message", async () => {
    vi.mocked(runAgent).mockResolvedValue({
      ...result,
      extra: "excluded",
    } as typeof result);
    const response = await post({
      sessionId: "existing-session",
      message: "  Find a gift.  ",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      sessionId: "existing-session",
      ...result,
    });
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(runAgent).toHaveBeenCalledWith("existing-session", "Find a gift.");
  });

  it("generates a UUID session id and passes that same id to the agent", async () => {
    const response = await post({ message: "Hello" });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.sessionId).toMatch(
      /^sess_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(body).toEqual({ sessionId: body.sessionId, ...result });
    expect(runAgent).toHaveBeenCalledWith(body.sessionId, "Hello");
  });

  it.each([
    {},
    { message: "" },
    { message: " \n\t " },
    { message: "a".repeat(4001) },
    { message: 123 },
    { message: null },
    { message: "Hello", sessionId: 123 },
    { message: "Hello", sessionId: "" },
    { message: "Hello", sessionId: "s".repeat(101) },
    { message: "Hello", sessionId: null },
    { message: "Hello", extra: true },
    [],
  ])("rejects invalid input %# without calling the agent", async (input) => {
    const response = await post(input);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "validation_error", message: expect.any(String) },
    });
    expect(runAgent).not.toHaveBeenCalled();
  });

  it("accepts the maximum lengths after trimming the message", async () => {
    const sessionId = "s".repeat(100);
    const message = "a".repeat(4000);
    const response = await post({ sessionId, message: ` ${message} ` });
    expect(response.status).toBe(200);
    expect(runAgent).toHaveBeenCalledWith(sessionId, message);
  });

  it("uses the standard model_busy status and error body", async () => {
    vi.mocked(runAgent).mockRejectedValue(
      new AppError("model_busy", "Model is busy."),
    );
    const response = await post({ message: "Hello" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: { code: "model_busy", message: "Model is busy." },
    });
  });

  it.each([
    new Error("secret-key-123"),
    new AppError("validation_error", "secret-key-123"),
    { code: "model_busy", message: "secret-key-123" },
  ])("sanitizes all other agent failures %#", async (error) => {
    vi.mocked(runAgent).mockRejectedValue(error);
    const response = await post({ message: "Hello" });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: { code: "internal_error", message: "Agent failed." },
    });
    expect(JSON.stringify(body)).not.toContain("secret-key-123");
  });
});
