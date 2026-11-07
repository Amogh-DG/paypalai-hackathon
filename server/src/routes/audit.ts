import { Router, type Request, type Response, type NextFunction } from "express";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import { listAudit } from "../audit/index.js";
import { AppError } from "../http/errors.js";

export function createAuditRouter(db: DatabaseType): Router {
  const router = Router();

  router.get("/api/audit", (req: Request, res: Response, next: NextFunction) => {
    try {
      let limit = 200;
      if (req.query.limit !== undefined) {
        const rawLimit = String(req.query.limit);
        const parsed = Number(rawLimit);
        if (
          !Number.isInteger(parsed) ||
          parsed < 1 ||
          parsed > 1000 ||
          rawLimit !== String(parsed)
        ) {
          throw new AppError(
            ERROR_CODES.VALIDATION_ERROR,
            'Field "limit" must be an integer between 1 and 1000',
          );
        }
        limit = parsed;
      }

      const entries = listAudit(db, limit);
      res.json(entries);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const auditRouter = Router();
auditRouter.get("/api/audit", (_req, res) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
