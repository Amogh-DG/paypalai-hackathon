import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { Database as DatabaseType } from "better-sqlite3";
import type { PayPalAdapter } from "../paypal/adapter.js";
import { handleProposalReturn } from "../proposals/return.js";

const querySchema = z.object({
  proposalId: z.string().trim().min(1, 'Field "proposalId" is required'),
  token: z.string().trim().min(1, 'Field "token" is required'),
});

export function createPaypalReturnRouter(
  db: DatabaseType,
  adapter: PayPalAdapter,
  options?: {
    signingSecret?: string;
    clock?: () => Date;
    paypalMode?: string;
  },
): Router {
  const router = Router();

  router.get(
    "/api/paypal/return",
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { proposalId, token } = querySchema.parse(req.query);

        await handleProposalReturn(db, adapter, {
          proposalId,
          token,
          signingSecret: options?.signingSecret,
          clock: options?.clock,
          paypalMode: options?.paypalMode,
        });

        res.redirect(302, `/?proposal=${encodeURIComponent(proposalId)}`);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const paypalReturnRouter = Router();
paypalReturnRouter.get(
  "/api/paypal/return",
  (_req: Request, res: Response) => {
    res.status(501).json({
      error: {
        code: "not_implemented",
        message: "Not implemented",
      },
    });
  },
);
