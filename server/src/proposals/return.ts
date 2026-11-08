import type { Database as DatabaseType } from "better-sqlite3";
import {
  ERROR_CODES,
  type PolicyDecision,
  type ProposalStatus,
  dollarsToCents,
} from "@leash/shared";
import type { PayPalAdapter } from "../paypal/adapter.js";
import { AppError } from "../http/errors.js";
import { getMandate } from "../mandate/storage.js";
import { evaluate } from "../policy/evaluate.js";
import { getProposal } from "./storage.js";
import { getSpent } from "./spent.js";
import { setStatus } from "./transitions.js";
import { writeAudit } from "../audit/storage.js";

const inFlightLocks = new Map<string, Promise<void>>();

async function withProposalLock<T>(
  proposalId: string,
  fn: () => Promise<T>,
): Promise<T> {
  while (inFlightLocks.has(proposalId)) {
    await inFlightLocks.get(proposalId);
  }
  let resolveLock!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  inFlightLocks.set(proposalId, promise);
  try {
    return await fn();
  } finally {
    inFlightLocks.delete(proposalId);
    resolveLock();
  }
}

export type ReturnOptions = {
  proposalId: string;
  token: string;
  signingSecret?: string;
  clock?: () => Date;
  paypalMode?: string;
};

export async function handleProposalReturn(
  db: DatabaseType,
  adapter: PayPalAdapter,
  options: ReturnOptions,
): Promise<void> {
  const { proposalId, token, signingSecret, clock, paypalMode } = options;

  await withProposalLock(proposalId, async () => {
    const proposal = getProposal(db, proposalId);
    if (!proposal) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        `Proposal ${proposalId} not found`,
      );
    }

    if (
      proposal.status === "blocked" ||
      proposal.status === "needs_approval" ||
      proposal.status === "rejected"
    ) {
      throw new AppError(
        ERROR_CODES.INVALID_STATE,
        `Cannot return proposal with status ${proposal.status}`,
      );
    }

    if (!proposal.payment?.orderId || proposal.payment.orderId !== token) {
      throw new AppError(
        ERROR_CODES.VALIDATION_ERROR,
        "Token does not match stored orderId",
      );
    }

    if (proposal.status !== "awaiting_buyer") {
      return;
    }

    let currentStatus: ProposalStatus = "awaiting_buyer";
    let authorizationId: string | undefined;
    let isCaptured = false;
    let isVoided = false;

    try {
      const authResult = await adapter.authorizeOrder(proposal.payment.orderId);
      authorizationId = authResult.authorizationId;

      currentStatus = setStatus(
        "awaiting_buyer",
        "authorized",
      ) as ProposalStatus;
      const updatedPayment = { ...proposal.payment, authorizationId };

      db.prepare(`
        UPDATE proposals
        SET status = 'authorized', payment = ?
        WHERE id = ?
      `).run(JSON.stringify(updatedPayment), proposal.id);

      writeAudit(db, {
        proposalId: proposal.id,
        event: "authorized",
        summary: `Order ${proposal.payment.orderId} authorized`,
        amount: authResult.amount,
        details: {
          authorizationId,
          amount: authResult.amount,
          currency: authResult.currency,
        },
      });

      if (paypalMode === "mock") {
        writeAudit(db, {
          proposalId: proposal.id,
          event: "webhook",
          summary: "PAYMENT.AUTHORIZATION.CREATED",
          details: {
            eventType: "PAYMENT.AUTHORIZATION.CREATED",
            mode: "mock",
          },
        });
      }

      const reasons: string[] = [];
      let recheckPassed = true;

      const authCents = dollarsToCents(authResult.amount);
      const proposalCents = dollarsToCents(proposal.total);
      if (authCents !== proposalCents) {
        recheckPassed = false;
        reasons.push(
          `Authorized amount ${authResult.amount} does not match proposal total ${proposal.total}`,
        );
      }
      if (authResult.currency !== proposal.currency) {
        recheckPassed = false;
        reasons.push(
          `Authorized currency ${authResult.currency} does not match proposal currency ${proposal.currency}`,
        );
      }

      const mandate = getMandate(db);
      let policyResult: PolicyDecision | undefined;

      if (!mandate) {
        recheckPassed = false;
        reasons.push("No mandate found");
      } else {
        const spent = getSpent(db, proposal.id);
        const now = clock ? clock() : new Date();

        policyResult = evaluate(
          proposal,
          mandate,
          {
            spent,
            now,
            signingSecret: signingSecret || "",
          },
        );

        for (const result of policyResult.results) {
          if (result.severity === "block" && !result.passed) {
            recheckPassed = false;
            reasons.push(result.message);
          } else if (result.severity === "ask" && !result.passed) {
            if (proposal.userDecision?.action !== "approve") {
              recheckPassed = false;
              reasons.push(result.message);
            }
          }
        }
      }

      writeAudit(db, {
        proposalId: proposal.id,
        event: "recheck",
        summary: recheckPassed
          ? "Re-check passed"
          : `Re-check failed: ${reasons.join("; ")}`,
        amount: proposal.total,
        decision: recheckPassed ? "allow" : "block",
        details: {
          outcome: recheckPassed ? "passed" : "failed",
          reasons,
          results: policyResult?.results ?? [],
        },
      });

      if (recheckPassed) {
        const { captureId } =
          await adapter.captureAuthorization(authorizationId);
        isCaptured = true;

        currentStatus = setStatus(
          "authorized",
          "captured",
        ) as ProposalStatus;
        const finalPayment = { ...updatedPayment, captureId };

        db.prepare(`
          UPDATE proposals
          SET status = 'captured', payment = ?
          WHERE id = ?
        `).run(JSON.stringify(finalPayment), proposal.id);

        writeAudit(db, {
          proposalId: proposal.id,
          event: "captured",
          summary: `Authorization ${authorizationId} captured`,
          amount: proposal.total,
          details: {
            captureId,
            authorizationId,
            amount: proposal.total,
          },
        });

        if (paypalMode === "mock") {
          writeAudit(db, {
            proposalId: proposal.id,
            event: "webhook",
            summary: "PAYMENT.CAPTURE.COMPLETED",
            details: {
              eventType: "PAYMENT.CAPTURE.COMPLETED",
              mode: "mock",
            },
          });
        }
      } else {
        await adapter.voidAuthorization(authorizationId);
        isVoided = true;

        currentStatus = setStatus(
          "authorized",
          "voided",
        ) as ProposalStatus;

        db.prepare(`
          UPDATE proposals
          SET status = 'voided'
          WHERE id = ?
        `).run(proposal.id);

        writeAudit(db, {
          proposalId: proposal.id,
          event: "voided",
          summary: `Re-check failed: ${reasons.join("; ")}`,
          amount: proposal.total,
          details: {
            reasons,
            authorizationId,
          },
        });

        if (paypalMode === "mock") {
          writeAudit(db, {
            proposalId: proposal.id,
            event: "webhook",
            summary: "PAYMENT.AUTHORIZATION.VOIDED",
            details: {
              eventType: "PAYMENT.AUTHORIZATION.VOIDED",
              mode: "mock",
            },
          });
        }
      }
    } catch (err) {
      let voidAttemptError: string | undefined;
      if (authorizationId && !isCaptured && !isVoided) {
        try {
          await adapter.voidAuthorization(authorizationId);
          isVoided = true;
        } catch (vErr) {
          voidAttemptError =
            vErr instanceof Error ? vErr.message : String(vErr);
        }
      }

      currentStatus = setStatus(currentStatus, "failed") as ProposalStatus;

      db.prepare(`
        UPDATE proposals
        SET status = 'failed'
        WHERE id = ?
      `).run(proposal.id);

      writeAudit(db, {
        proposalId: proposal.id,
        event: "error",
        summary: `Payment processing error: ${err instanceof Error ? err.message : String(err)}`,
        amount: proposal.total,
        details: {
          error: err instanceof Error ? err.message : String(err),
          voidAttempt: voidAttemptError
            ? `Failed to void: ${voidAttemptError}`
            : authorizationId
              ? "Void succeeded"
              : "No authorization to void",
        },
      });
    }
  });
}
