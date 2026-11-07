import express, { type Express } from "express";
import path from "node:path";
import type { Database as DatabaseType } from "better-sqlite3";
import { createMandateRouter } from "./routes/mandate.js";
import { chatRouter } from "./routes/chat.js";
import { createProposalsRouter } from "./routes/proposals.js";
import { createDecisionRouter } from "./routes/decision.js";
import { paypalReturnRouter } from "./routes/paypal-return.js";
import { paypalCancelRouter } from "./routes/paypal-cancel.js";
import { createMockApproveRouter } from "./routes/mock-approve.js";
import { webhookRouter } from "./routes/webhook.js";
import { createAuditRouter } from "./routes/audit.js";
import { initProposalService } from "./proposals/service.js";
import { initPayment } from "./proposals/payment.js";
import { createPayPalAdapter, type PayPalAdapter } from "./paypal/index.js";
import { errorHandler } from "./http/errors.js";
import { createDb } from "./db.js";

export function createApp(
  db: DatabaseType,
  options?: {
    signingSecret?: string;
    paypalAdapter?: PayPalAdapter;
    paypalMode?: "mock" | "sandbox" | string;
    publicBaseUrl?: string;
    beforeErrorRoutes?: (app: Express) => void;
  },
): Express {
  const application = express();

  const paypalMode =
    options?.paypalMode ?? (process.env.PAYPAL_MODE || "mock");
  const paypalAdapter =
    options?.paypalAdapter ??
    createPayPalAdapter(paypalMode, {
      publicBaseUrl: options?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL,
    });

  initPayment(db, paypalAdapter);
  initProposalService(db, options?.signingSecret);

  application.use(express.json());

  application.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  application.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  application.use(
    "/shady",
    express.static(path.resolve(process.cwd(), "server/public/shady")),
  );

  application.use(createMandateRouter(db, options?.signingSecret));
  application.use(chatRouter);
  application.use(createProposalsRouter(db));
  application.use(createDecisionRouter(db));
  application.use(paypalReturnRouter);
  application.use(paypalCancelRouter);
  application.use(createMockApproveRouter(db, paypalMode));
  application.use(webhookRouter);
  application.use(createAuditRouter(db));

  if (process.env.NODE_ENV === "production") {
    const webDist = path.resolve(process.cwd(), "web/dist");
    application.use(express.static(webDist));
    application.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/shady")) {
        return next();
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  options?.beforeErrorRoutes?.(application);

  application.use(errorHandler);

  return application;
}

export const app = createApp(createDb(":memory:"));
