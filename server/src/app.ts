import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Database as DatabaseType } from "better-sqlite3";
import { ERROR_CODES } from "@leash/shared";
import { createMandateRouter } from "./routes/mandate.js";
import { chatRouter } from "./routes/chat.js";
import { createProposalsRouter } from "./routes/proposals.js";
import { createDecisionRouter } from "./routes/decision.js";
import { createPaypalReturnRouter } from "./routes/paypal-return.js";
import { createPaypalCancelRouter } from "./routes/paypal-cancel.js";
import { createMockApproveRouter } from "./routes/mock-approve.js";
import { createWebhookRouter } from "./routes/webhook.js";
import { createAuditRouter } from "./routes/audit.js";
import { initProposalService } from "./proposals/service.js";
import { initPayment } from "./proposals/payment.js";
import {
  createPayPalAdapter,
  type PayPalAdapter,
  MockPayPalAdapter,
  SandboxPayPalAdapter,
} from "./paypal/index.js";
import { errorHandler, AppError } from "./http/errors.js";
import { createDb } from "./db.js";

export function createApp(
  db: DatabaseType,
  options?: {
    signingSecret?: string;
    paypalAdapter?: PayPalAdapter;
    paypalMode?: "mock" | "sandbox" | string;
    publicBaseUrl?: string;
    clock?: () => Date;
    beforeErrorRoutes?: (app: Express) => void;
    isProduction?: boolean;
    webDist?: string;
  },
): Express {
  const application = express();
  application.set("trust proxy", 1);

  const paypalMode =
    options?.paypalMode ?? (process.env.PAYPAL_MODE || "mock");
  const paypalAdapter =
    options?.paypalAdapter ??
    createPayPalAdapter(paypalMode, {
      db,
      publicBaseUrl: options?.publicBaseUrl ?? process.env.PUBLIC_BASE_URL,
    });

  if (paypalAdapter instanceof MockPayPalAdapter && !paypalAdapter.hasDb()) {
    paypalAdapter.setDb(db);
  }
  if (
    paypalAdapter instanceof SandboxPayPalAdapter &&
    !paypalAdapter.hasDb()
  ) {
    paypalAdapter.setDb(db);
  }

  db.exec("DROP TRIGGER IF EXISTS set_sandbox_payment_mode;");

  initPayment(db, paypalAdapter);
  initProposalService(db, options?.signingSecret, options?.clock);

  application.use(
    "/api/paypal/webhook",
    express.raw({ type: "*/*" }),
  );

  application.use(express.json());

  application.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  application.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  const shadyDir = fileURLToPath(new URL("../public/shady", import.meta.url));
  application.use("/shady", express.static(shadyDir));

  application.use(createMandateRouter(db, options?.signingSecret));
  application.use(chatRouter);
  application.use(createProposalsRouter(db));
  application.use(createDecisionRouter(db));
  application.use(
    createPaypalReturnRouter(db, paypalAdapter, {
      signingSecret: options?.signingSecret,
      clock: options?.clock,
      paypalMode,
    }),
  );
  application.use(createPaypalCancelRouter(db));
  application.use(createMockApproveRouter(db, paypalMode));
  application.use(createWebhookRouter(db, paypalAdapter, paypalMode));
  application.use(createAuditRouter(db));

  const isProduction =
    options?.isProduction ?? process.env.NODE_ENV === "production";
  const webDist =
    options?.webDist ??
    fileURLToPath(new URL("../../web/dist", import.meta.url));

  if (isProduction) {
    application.use(express.static(webDist));
    application.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/shady")) {
        return next();
      }
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  options?.beforeErrorRoutes?.(application);

  application.use("/api", (_req, _res, next) => {
    next(new AppError(ERROR_CODES.NOT_FOUND, "Route not found"));
  });

  application.use(errorHandler);

  return application;
}

export const app = createApp(createDb(":memory:"));
