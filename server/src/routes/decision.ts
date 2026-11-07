import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import {
  ERROR_CODES,
  type Proposal,
  type ProposalStatus,
  type UserDecision,
} from "@leash/shared";
import { AppError } from "../http/errors.js";
import { rowToProposal, type ProposalRow } from "../proposals/storage.js";
import { setStatus } from "../proposals/transitions.js";
import { writeAudit } from "../audit/storage.js";
import { startPayment } from "../proposals/payment.js";

const decisionSchema = z.object({
  action: z.enum(["approve", "reject"], {
    errorMap: () => ({ message: 'Field "action" must be "approve" or "reject"' }),
  }),
});

export function handleDecision(
  db: DatabaseType,
  id: string,
  action: "approve" | "reject",
): Proposal {
  const targetStatus: ProposalStatus =
    action === "approve" ? "approved" : "rejected";

  const executeTx = db.transaction(() => {
    const row = db
      .prepare("SELECT * FROM proposals WHERE id = ?")
      .get(id) as ProposalRow | undefined;

    if (!row) {
      throw new AppError(
        ERROR_CODES.NOT_FOUND,
        `Proposal ${id} not found`,
      );
    }

    if (row.status !== "needs_approval") {
      throw new AppError(
        ERROR_CODES.INVALID_STATE,
        `Proposal ${id} is in status ${row.status}, expected needs_approval`,
      );
    }

    setStatus(row.status as ProposalStatus, targetStatus);

    const decidedAt = new Date().toISOString();
    const userDecision: UserDecision = { action, decidedAt };

    db.prepare(`
      UPDATE proposals
      SET status = ?, user_decision = ?
      WHERE id = ?
    `).run(targetStatus, JSON.stringify(userDecision), id);

    writeAudit(db, {
      proposalId: id,
      event: "user_decision",
      summary: `Proposal ${id} ${action}d by user`,
      amount: row.total,
      details: {
        action,
        decidedAt,
      },
    });

    const updatedRow = db
      .prepare("SELECT * FROM proposals WHERE id = ?")
      .get(id) as ProposalRow;

    return rowToProposal(updatedRow);
  });

  return executeTx();
}

export function createDecisionRouter(db: DatabaseType): Router {
  const router = Router();

  router.post(
    "/api/proposals/:id/decision",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { action } = decisionSchema.parse(req.body);
        const proposal = handleDecision(db, req.params.id, action);
        if (action === "approve") {
          const updatedWithPayment = await startPayment(proposal);
          res.json(updatedWithPayment);
          return;
        }
        res.json(proposal);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const decisionRouter = Router();
decisionRouter.post(
  "/api/proposals/:id/decision",
  (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "not_implemented",
        message: "Not implemented",
      },
    });
  },
);
