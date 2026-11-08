import type { Database as DatabaseType } from "better-sqlite3";
import type { PaymentInfo } from "@leash/shared";
import { writeAudit } from "../audit/storage.js";

export const SUPPORTED_WEBHOOK_EVENTS = new Set([
  "PAYMENT.AUTHORIZATION.CREATED",
  "PAYMENT.CAPTURE.COMPLETED",
  "PAYMENT.AUTHORIZATION.VOIDED",
]);

export type WebhookTransmissionHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

export function extractEventIds(event: Record<string, unknown>): {
  eventType: string;
  eventId: string;
  orderId?: string;
  authorizationId?: string;
  captureId?: string;
} {
  const eventType = String(event.event_type ?? "");
  const eventId = String(event.id ?? "");
  const resource = (
    event.resource && typeof event.resource === "object"
      ? event.resource
      : {}
  ) as Record<string, unknown>;

  const suppData = resource.supplementary_data as
    | Record<string, unknown>
    | undefined;
  const relatedIds = (
    suppData &&
    typeof suppData === "object" &&
    suppData.related_ids &&
    typeof suppData.related_ids === "object"
      ? suppData.related_ids
      : {}
  ) as Record<string, unknown>;

  let orderId: string | undefined =
    typeof relatedIds.order_id === "string"
      ? (relatedIds.order_id as string)
      : typeof resource.order_id === "string"
        ? (resource.order_id as string)
        : typeof resource.parent_payment === "string"
          ? (resource.parent_payment as string)
          : undefined;

  let authorizationId: string | undefined;
  let captureId: string | undefined;

  if (
    eventType === "PAYMENT.AUTHORIZATION.CREATED" ||
    eventType === "PAYMENT.AUTHORIZATION.VOIDED"
  ) {
    authorizationId =
      typeof resource.id === "string" ? (resource.id as string) : undefined;
  } else if (eventType === "PAYMENT.CAPTURE.COMPLETED") {
    captureId =
      typeof resource.id === "string" ? (resource.id as string) : undefined;
    authorizationId =
      typeof relatedIds.authorization_id === "string"
        ? (relatedIds.authorization_id as string)
        : typeof resource.authorization_id === "string"
          ? (resource.authorization_id as string)
          : undefined;
  }

  return {
    eventType,
    eventId,
    orderId,
    authorizationId,
    captureId,
  };
}

export function isWebhookEventProcessed(
  db: DatabaseType,
  eventId: string,
): boolean {
  const row = db
    .prepare("SELECT event_id FROM processed_webhook_events WHERE event_id = ?")
    .get(eventId);
  return Boolean(row);
}

export function recordWebhookEventProcessed(
  db: DatabaseType,
  eventId: string,
): void {
  db.prepare(
    "INSERT INTO processed_webhook_events (event_id, received_at) VALUES (?, ?)",
  ).run(eventId, new Date().toISOString());
}

export function processAndRecordWebhookEvent(
  db: DatabaseType,
  event: Record<string, unknown>,
): { matched: boolean; proposalId?: string; ignored?: boolean } {
  const { eventType, eventId, orderId, authorizationId, captureId } =
    extractEventIds(event);

  const tx = db.transaction(() => {
    if (!SUPPORTED_WEBHOOK_EVENTS.has(eventType)) {
      writeAudit(db, {
        event: "webhook",
        summary: `PayPal webhook ${eventType} ignored`,
        details: {
          eventType,
          eventId,
          mode: "sandbox",
        },
      });
      db.prepare(
        "INSERT INTO processed_webhook_events (event_id, received_at) VALUES (?, ?)",
      ).run(eventId, new Date().toISOString());
      return { matched: false, ignored: true };
    }

    const rows = db
      .prepare(
        "SELECT id, status, payment FROM proposals WHERE payment IS NOT NULL",
      )
      .all() as Array<{ id: string; status: string; payment: string }>;

    let matchedRow: { id: string; status: string; payment: string } | null = null;
    let parsedPayment: PaymentInfo | null = null;

    for (const row of rows) {
      try {
        const pay = JSON.parse(row.payment) as PaymentInfo;
        if (
          (orderId && pay.orderId === orderId) ||
          (authorizationId && pay.authorizationId === authorizationId) ||
          (captureId && pay.captureId === captureId)
        ) {
          matchedRow = row;
          parsedPayment = pay;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!matchedRow) {
      writeAudit(db, {
        event: "webhook",
        summary: `PayPal webhook ${eventType} unmatched`,
        details: {
          eventType,
          eventId,
          mode: "sandbox",
        },
      });
      db.prepare(
        "INSERT INTO processed_webhook_events (event_id, received_at) VALUES (?, ?)",
      ).run(eventId, new Date().toISOString());
      return { matched: false };
    }

    writeAudit(db, {
      proposalId: matchedRow.id,
      event: "webhook",
      summary: `PayPal webhook ${eventType} for proposal ${matchedRow.id}`,
      details: {
        eventType,
        eventId,
        mode: "sandbox",
      },
    });

    if (parsedPayment) {
      let paymentChanged = false;
      if (!parsedPayment.authorizationId && authorizationId) {
        parsedPayment.authorizationId = authorizationId;
        paymentChanged = true;
      }
      if (!parsedPayment.captureId && captureId) {
        parsedPayment.captureId = captureId;
        paymentChanged = true;
      }
      if (paymentChanged) {
        db.prepare("UPDATE proposals SET payment = ? WHERE id = ?").run(
          JSON.stringify(parsedPayment),
          matchedRow.id,
        );
      }
    }

    db.prepare(
      "INSERT INTO processed_webhook_events (event_id, received_at) VALUES (?, ?)",
    ).run(eventId, new Date().toISOString());

    return { matched: true, proposalId: matchedRow.id };
  });

  return tx();
}

export function processWebhookEvent(
  db: DatabaseType,
  event: Record<string, unknown>,
): { matched: boolean; proposalId?: string; ignored?: boolean } {
  return processAndRecordWebhookEvent(db, event);
}

export async function verifyWebhookSignature(
  adapter: unknown,
  params: {
    authAlgo: string;
    certUrl: string;
    transmissionId: string;
    transmissionSig: string;
    transmissionTime: string;
    webhookId: string;
    webhookEvent?: Record<string, unknown>;
    rawEvent?: string;
  },
): Promise<boolean> {
  if (
    adapter &&
    typeof (adapter as { verifyWebhookSignature?: unknown })
      .verifyWebhookSignature === "function"
  ) {
    return (
      adapter as {
        verifyWebhookSignature: (p: typeof params) => Promise<boolean>;
      }
    ).verifyWebhookSignature(params);
  }
  return false;
}
