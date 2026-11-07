import { Router, Request, Response } from "express";

export const auditRouter = Router();

auditRouter.get("/api/audit", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
