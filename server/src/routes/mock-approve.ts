import { Router, type Request, type Response, type NextFunction } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import { AppError } from "../http/errors.js";
import { getProposal } from "../proposals/storage.js";
import { writeAudit } from "../audit/storage.js";

export function createMockApproveRouter(
  db: DatabaseType,
  paypalMode: string = "mock",
): Router {
  const router = Router();

  router.get(
    "/api/mock/paypal/approve",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        if (paypalMode !== "mock") {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            "Mock approve endpoint is only available in mock mode",
          );
        }

        const proposalId = req.query.proposalId;
        const token = req.query.token;

        if (
          typeof proposalId !== "string" ||
          proposalId.trim().length === 0 ||
          typeof token !== "string" ||
          token.trim().length === 0
        ) {
          throw new AppError(
            ERROR_CODES.VALIDATION_ERROR,
            'Query parameters "proposalId" and "token" are required',
          );
        }

        const proposal = getProposal(db, proposalId);
        if (!proposal) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            `Proposal ${proposalId} not found`,
          );
        }

        if (proposal.status !== "awaiting_buyer") {
          throw new AppError(
            ERROR_CODES.INVALID_STATE,
            `Proposal ${proposalId} is in status ${proposal.status}, expected awaiting_buyer`,
          );
        }

        if (!proposal.payment?.orderId || proposal.payment.orderId !== token) {
          throw new AppError(
            ERROR_CODES.VALIDATION_ERROR,
            `Token ${token} does not match stored orderId`,
          );
        }

        writeAudit(db, {
          proposalId: proposal.id,
          event: "buyer_approved",
          summary: `Buyer approved order ${token} for proposal ${proposal.id}`,
          amount: proposal.total,
          details: {
            orderId: token,
            proposalId: proposal.id,
          },
        });

        res.redirect(
          302,
          `/api/paypal/return?proposalId=${encodeURIComponent(proposalId)}&token=${encodeURIComponent(token)}`,
        );
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const mockApproveRouter = Router();
mockApproveRouter.get(
  "/api/mock/paypal/approve",
  (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "not_implemented",
        message: "Not implemented",
      },
    });
  },
);
