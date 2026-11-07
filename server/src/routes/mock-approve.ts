import { Router, Request, Response } from "express";

export const mockApproveRouter = Router();

mockApproveRouter.get("/api/mock/paypal/approve", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
