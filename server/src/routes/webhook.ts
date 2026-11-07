import { Router, Request, Response } from "express";

export const webhookRouter = Router();

webhookRouter.post("/api/paypal/webhook", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
