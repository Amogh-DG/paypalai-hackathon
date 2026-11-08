import readline from "node:readline";
import { fileURLToPath } from "node:url";
import type { Proposal } from "@leash/shared";
import {
  SandboxPayPalAdapter,
  PayPalApiError,
} from "../src/paypal/sandbox.js";

const envPath =
  process.env.ENV_FILE ||
  fileURLToPath(new URL("../../.env", import.meta.url));

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(envPath);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}

if (process.env.PAYPAL_MODE !== "sandbox") {
  process.stderr.write(
    `Error: paypal:smoke requires PAYPAL_MODE=sandbox (current: ${process.env.PAYPAL_MODE || "undefined"})\n`,
  );
  process.exit(1);
}

const clientId = process.env.PAYPAL_CLIENT_ID;
const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  process.stderr.write(
    "Error: PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET environment variables are required\n",
  );
  process.exit(1);
}

const declineFlag = process.argv.some(
  (arg) => arg === "--decline" || arg.startsWith("--decline"),
);

async function run(): Promise<void> {
  const adapter = new SandboxPayPalAdapter();

  const proposal: Proposal = {
    id: `prop_smoke_${Date.now()}`,
    createdAt: new Date().toISOString(),
    total: 5.0,
    status: "approved",
    currency: "USD",
    agentReasoning:
      "Smoke test order for PayPal sandbox verification in Bengaluru.",
    items: [
      {
        productId: "prod_bengaluru_coffee",
        title: "Bengaluru Estate Filter Coffee Beans",
        merchant: "Trailhead Supply",
        category: "kitchen",
        unitPrice: 5.0,
        quantity: 1,
        url: "https://trailheadsupply.example/coffee",
      },
    ],
    shipTo: {
      name: "Rohan Verma",
      line1: "100 Feet Road, Indiranagar",
      city: "Bengaluru",
      region: "Karnataka",
      postalCode: "560038",
      country: "India",
    },
    sourceUrls: ["https://trailheadsupply.example/coffee"],
    policy: {
      decision: "allow",
      results: [],
      evaluatedAt: new Date().toISOString(),
    },
  };

  process.stdout.write("=== PayPal Sandbox Smoke Test ===\n");
  if (declineFlag) {
    process.stdout.write("Mode: Negative testing (--decline active)\n");
  }
  process.stdout.write("\nStep 1: Creating order (5.00 USD)...\n");

  const { orderId, approveUrl } = await adapter.createOrder(proposal);
  process.stdout.write(`Order Created: ${orderId}\n`);
  process.stdout.write(`Approve URL: ${approveUrl}\n`);
  process.stdout.write(`Debug ID: ${adapter.getLastDebugId() || "N/A"}\n\n`);

  process.stdout.write(
    "Open the Approve URL above in your browser and approve the order as sandbox buyer.\n",
  );

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  await new Promise<void>((resolve) => {
    rl.question(
      "Press Enter after approving the order in your browser...",
      () => {
        rl.close();
        resolve();
      },
    );
  });

  process.stdout.write("\nStep 2: Authorizing order...\n");

  if (declineFlag) {
    adapter.setExtraHeaders({
      "PayPal-Mock-Response":
        '{"mock_application_codes":"INSTRUMENT_DECLINED"}',
    });

    try {
      const auth = await adapter.authorizeOrder(orderId);
      process.stdout.write(
        `Unexpected authorization success: ${auth.authorizationId}\n`,
      );
    } catch (err: unknown) {
      if (err instanceof PayPalApiError) {
        process.stdout.write(
          `authorizeOrder threw expected error:\n  Status: ${err.status}\n  Error Name: ${err.paypalName || "N/A"}\n  Issue: ${err.issue || "N/A"}\n  Debug ID: ${err.debugId || "N/A"}\n  Message: ${err.message}\n`,
        );
      } else {
        process.stdout.write(
          `authorizeOrder failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      process.stdout.write("No capture was attempted.\n");
      return;
    }
  }

  const auth = await adapter.authorizeOrder(orderId);
  process.stdout.write(`Order Authorized Successfully!\n`);
  process.stdout.write(`Authorization ID: ${auth.authorizationId}\n`);
  process.stdout.write(`Authorized Amount: ${auth.amount} ${auth.currency}\n`);
  process.stdout.write(`Debug ID: ${adapter.getLastDebugId() || "N/A"}\n\n`);

  process.stdout.write("Step 3: Voiding authorization (not capturing)...\n");
  await adapter.voidAuthorization(auth.authorizationId);
  process.stdout.write(
    `Authorization ${auth.authorizationId} successfully voided.\n`,
  );
  process.stdout.write(`Debug ID: ${adapter.getLastDebugId() || "N/A"}\n`);
  process.stdout.write("\n=== Smoke Test Complete ===\n");
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`Unhandled error in paypal:smoke: ${msg}\n`);
  process.exit(1);
});
