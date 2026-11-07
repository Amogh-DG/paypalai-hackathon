import express from "express";
import path from "node:path";
import { mandateRouter } from "./routes/mandate.js";
import { chatRouter } from "./routes/chat.js";
import { proposalsRouter } from "./routes/proposals.js";
import { decisionRouter } from "./routes/decision.js";
import { paypalReturnRouter } from "./routes/paypal-return.js";
import { paypalCancelRouter } from "./routes/paypal-cancel.js";
import { mockApproveRouter } from "./routes/mock-approve.js";
import { webhookRouter } from "./routes/webhook.js";
import { auditRouter } from "./routes/audit.js";
import "./db.js";

export const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/shady", express.static(path.resolve(process.cwd(), "server/public/shady")));

app.use(mandateRouter);
app.use(chatRouter);
app.use(proposalsRouter);
app.use(decisionRouter);
app.use(paypalReturnRouter);
app.use(paypalCancelRouter);
app.use(mockApproveRouter);
app.use(webhookRouter);
app.use(auditRouter);

if (process.env.NODE_ENV === "production") {
  const webDist = path.resolve(process.cwd(), "web/dist");
  app.use(express.static(webDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/shady")) {
      return next();
    }
    res.sendFile(path.join(webDist, "index.html"));
  });
}
