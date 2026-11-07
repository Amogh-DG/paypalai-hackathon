import { Router, Request, Response } from "express";

export const decisionRouter = Router();

decisionRouter.post("/api/proposals/:id/decision", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
