import { Router, type Request, type Response, type NextFunction } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import { AppError } from "../http/errors.js";
import { getProposal, listProposals } from "../proposals/storage.js";

export function createProposalsRouter(db: DatabaseType): Router {
  const router = Router();

  router.get(
    "/api/proposals",
    (_req: Request, res: Response, next: NextFunction) => {
      try {
        const proposals = listProposals(db);
        res.json(proposals);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    "/api/proposals/:id",
    (req: Request, res: Response, next: NextFunction) => {
      try {
        const proposal = getProposal(db, req.params.id);
        if (!proposal) {
          throw new AppError(
            ERROR_CODES.NOT_FOUND,
            `Proposal ${req.params.id} not found`,
          );
        }
        res.json(proposal);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}

export const proposalsRouter = Router();
proposalsRouter.get("/api/proposals", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
proposalsRouter.get("/api/proposals/:id", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
