import { randomUUID } from "node:crypto";
import {
  Router,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z } from "zod";
import { ERROR_CODES } from "@leash/shared";
import { AppError } from "../http/errors.js";
import { runAgent } from "../agent/index.js";

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
    sessionId: z.string().min(1).max(100).optional(),
  })
  .strict();

export const chatRouter = Router();

chatRouter.post(
  "/api/chat",
  async (req: Request, res: Response, next: NextFunction) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new AppError(
          ERROR_CODES.VALIDATION_ERROR,
          "Expected a message of 1 to 4000 trimmed characters and an optional sessionId of 1 to 100 characters, with no extra fields.",
        ),
      );
      return;
    }
    const sessionId = parsed.data.sessionId ?? `sess_${randomUUID()}`;
    try {
      const { reply, proposalIds, toolTrace } = await runAgent(
        sessionId,
        parsed.data.message,
      );
      res.status(200).json({ sessionId, reply, proposalIds, toolTrace });
    } catch (error) {
      next(
        error instanceof AppError && error.code === ERROR_CODES.MODEL_BUSY
          ? error
          : new AppError(ERROR_CODES.INTERNAL_ERROR, "Agent failed."),
      );
    }
  },
);
