import { Router, Request, Response } from "express";

export const paypalCancelRouter = Router();

paypalCancelRouter.get("/api/paypal/cancel", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
