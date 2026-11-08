import { Router, type Request, type Response } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import type { PayPalAdapter } from "../paypal/adapter.js";
import { writeAudit } from "../audit/storage.js";
import {
  isWebhookEventProcessed,
  processAndRecordWebhookEvent,
  verifyWebhookSignature,
} from "../paypal/webhook.js";

async function handleWebhookRequest(
  req: Request,
  res: Response,
  db: DatabaseType,
  adapter: PayPalAdapter,
  mode: string,
  options?: { webhookId?: string },
): Promise<void> {
  if (mode === "mock") {
    res.status(404).json({
      error: {
        code: ERROR_CODES.NOT_FOUND,
        message: "Webhook endpoint not supported in mock mode",
      },
    });
    return;
  }

  const webhookId =
    options?.webhookId ?? process.env.PAYPAL_WEBHOOK_ID;

  if (!webhookId) {
    process.stderr.write("PAYPAL_WEBHOOK_ID environment variable is missing\n");
    res.status(500).json({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "An internal server error occurred",
      },
    });
    return;
  }

  const authAlgo = req.get("paypal-auth-algo");
  const certUrl = req.get("paypal-cert-url");
  const transmissionId = req.get("paypal-transmission-id");
  const transmissionSig = req.get("paypal-transmission-sig");
  const transmissionTime = req.get("paypal-transmission-time");

  if (
    !authAlgo ||
    !certUrl ||
    !transmissionId ||
    !transmissionSig ||
    !transmissionTime
  ) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Missing required PayPal transmission headers",
      },
    });
    return;
  }

  const rawBody = Buffer.isBuffer(req.body)
    ? req.body.toString("utf8")
    : typeof req.body === "string"
      ? req.body
      : "";

  if (!rawBody || rawBody.trim().length === 0) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Empty webhook body",
      },
    });
    return;
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed webhook body",
      },
    });
    return;
  }

  if (
    !event ||
    typeof event !== "object" ||
    typeof event.id !== "string" ||
    typeof event.event_type !== "string"
  ) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Malformed webhook event payload",
      },
    });
    return;
  }

  const verified = await verifyWebhookSignature(adapter, {
    authAlgo,
    certUrl,
    transmissionId,
    transmissionSig,
    transmissionTime,
    webhookId,
    rawEvent: rawBody,
    webhookEvent: event,
  });

  if (!verified) {
    res.status(400).json({
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: "Webhook signature verification failed",
      },
    });
    return;
  }

  const eventId = String(event.id);
  if (isWebhookEventProcessed(db, eventId)) {
    res.status(200).json({ status: "ok" });
    return;
  }

  try {
    processAndRecordWebhookEvent(db, event);
    res.status(200).json({ status: "ok" });
  } catch (err) {
    writeAudit(db, {
      event: "error",
      summary: `Webhook processing error for ${eventId}: ${err instanceof Error ? err.message : String(err)}`,
      details: {
        eventId,
        error: err instanceof Error ? err.message : String(err),
      },
    });

    res.status(500).json({
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: "An internal server error occurred",
      },
    });
  }
}

export function createWebhookRouter(
  db: DatabaseType,
  adapter: PayPalAdapter,
  mode: string = adapter.mode,
  options?: { webhookId?: string },
): Router {
  const router = Router();
  router.post("/api/paypal/webhook", (req: Request, res: Response) => {
    void handleWebhookRequest(req, res, db, adapter, mode, options);
  });
  return router;
}
