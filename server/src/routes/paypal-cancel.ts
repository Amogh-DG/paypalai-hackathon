import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import { AppError } from "../http/errors.js";
import { getProposal } from "../proposals/storage.js";
import { setStatus } from "../proposals/transitions.js";
import { writeAudit } from "../audit/storage.js";

const cancelQuerySchema = z.object({
  proposalId: z.string().trim().min(1, 'Field "proposalId" is required'),
});

export function createPaypalCancelRouter(db: DatabaseType): Router {
  const router = Router();

  router.get(
    "/api/paypal/cancel",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const { proposalId } = cancelQuerySchema.parse(req.query);

        const proposal = getProposal(db, proposalId);
        if (!proposal) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            `Proposal ${proposalId} not found`,
          );
        }

        if (proposal.status === "awaiting_buyer") {
          setStatus("awaiting_buyer", "voided");

          db.prepare(`
            UPDATE proposals
            SET status = 'voided'
            WHERE id = ?
          `).run(proposal.id);

          writeAudit(db, {
            proposalId: proposal.id,
            event: "voided",
            summary: "Buyer cancelled at PayPal",
            amount: proposal.total,
            details: {
              reason: "Buyer cancelled at PayPal",
            },
          });
        }

        res.redirect(302, `/?proposal=${encodeURIComponent(proposalId)}`);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const paypalCancelRouter = Router();
paypalCancelRouter.get(
  "/api/paypal/cancel",
  (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "not_implemented",
        message: "Not implemented",
      },
    });
  },
);
