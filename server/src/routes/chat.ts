import { Router, Request, Response } from "express";

export const chatRouter = Router();

chatRouter.post("/api/chat", (_req: Request, res: Response) => {
  res.status(501).json({
    error: {
      code: "not_implemented",
      message: "Not implemented",
    },
  });
});
