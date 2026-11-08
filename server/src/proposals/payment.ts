import type { Database as DatabaseType } from "better-sqlite3";
import {
  ERROR_CODES,
  type PaymentInfo,
  type Proposal,
} from "@leash/shared";
import type { PayPalAdapter } from "../paypal/adapter.js";
import { AppError } from "../http/errors.js";
import { setStatus } from "./transitions.js";
import { rowToProposal, type ProposalRow } from "./storage.js";
import { writeAudit } from "../audit/storage.js";

let currentDb: DatabaseType | null = null;
let currentAdapter: PayPalAdapter | null = null;

export function initPayment(db: DatabaseType, adapter: PayPalAdapter): void {
  currentDb = db;
  currentAdapter = adapter;
}

export async function startPayment(proposal: Proposal): Promise<Proposal> {
  if (proposal.status !== "approved") {
    throw new AppError(
      ERROR_CODES.INVALID_STATE,
      `Cannot start payment for proposal with status ${proposal.status}, expected approved`,
    );
  }

  if (!currentDb || !currentAdapter) {
    throw new AppError(
      ERROR_CODES.INTERNAL_ERROR,
      "Payment service is not initialized",
    );
  }

  const db = currentDb;
  const adapter = currentAdapter;

  try {
    const { orderId, approveUrl } = await adapter.createOrder(proposal);

    setStatus("approved", "awaiting_buyer");

    const payment: PaymentInfo = {
      mode: adapter.mode,
      orderId,
      approveUrl,
    };

    db.prepare(`
      UPDATE proposals
      SET status = 'awaiting_buyer', payment = ?
      WHERE id = ?
    `).run(JSON.stringify(payment), proposal.id);

    writeAudit(db, {
      proposalId: proposal.id,
      event: "order_created",
      summary: `Order ${orderId} created`,
      amount: proposal.total,
      details: {
        orderId,
        approveUrl,
        amount: proposal.total,
        mode: adapter.mode,
      },
    });

    const updatedRow = db
      .prepare("SELECT * FROM proposals WHERE id = ?")
      .get(proposal.id) as ProposalRow;
    return rowToProposal(updatedRow);
  } catch (err) {
    setStatus("approved", "failed");

    db.prepare(`
      UPDATE proposals
      SET status = 'failed'
      WHERE id = ?
    `).run(proposal.id);

    writeAudit(db, {
      proposalId: proposal.id,
      event: "error",
      summary: `Failed to create payment order: ${err instanceof Error ? err.message : String(err)}`,
      amount: proposal.total,
      details: {
        error: err instanceof Error ? err.message : String(err),
      },
    });

    const failedRow = db
      .prepare("SELECT * FROM proposals WHERE id = ?")
      .get(proposal.id) as ProposalRow;
    return rowToProposal(failedRow);
  }
}
