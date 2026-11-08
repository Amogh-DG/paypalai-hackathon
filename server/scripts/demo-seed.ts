import http, { type AddressInfo } from "node:http";
import { fileURLToPath } from "node:url";
import type { Proposal } from "@leash/shared";
import { createApp } from "../src/app.js";
import { createDb } from "../src/db.js";
import { MockPayPalAdapter } from "../src/paypal/mock.js";
import { submitProposal } from "../src/proposals/service.js";

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

const signingSecret = process.env.MANDATE_SIGNING_SECRET;
if (!signingSecret) {
  process.stderr.write(
    "MANDATE_SIGNING_SECRET environment variable is required\n",
  );
  process.exit(1);
}

const dbPath = process.env.DATABASE_PATH || "leash.db";
const db = createDb(dbPath);

const rowCount = (
  db.prepare("SELECT COUNT(*) AS count FROM proposals").get() as {
    count: number;
  }
).count;

const resetFlag = process.argv.some(
  (arg) => arg === "--reset" || arg.startsWith("--reset"),
);

if (rowCount > 0) {
  if (!resetFlag) {
    process.stdout.write(
      `Proposals table already contains ${rowCount} row(s). Aborting seed. Pass --reset to clear existing proposals and audit entries.\n`,
    );
    db.close();
    process.exit(0);
  }
  db.exec("DELETE FROM proposals; DELETE FROM audit_entries;");
  process.stdout.write(
    "Flag --reset provided: cleared existing proposals and audit entries.\n",
  );
}

async function run(): Promise<void> {
  const server = http.createServer();
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  const paypalAdapter = new MockPayPalAdapter({ publicBaseUrl: baseUrl });

  const app = createApp(db, {
    signingSecret,
    paypalAdapter,
    paypalMode: "mock",
    publicBaseUrl: baseUrl,
  });

  server.on("request", app);

  try {
    const shippingAddress = {
      name: "Rohan Verma",
      line1: "100 Feet Road, Indiranagar",
      city: "Bengaluru",
      region: "Karnataka",
      postalCode: "560038",
      country: "India",
    };

    const mandateRes = await fetch(`${baseUrl}/api/mandate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: "Demo User",
        currency: "USD",
        totalBudget: 80,
        perItemCap: 60,
        approvalThreshold: 50,
        allowedCategories: ["hiking", "books", "kitchen", "electronics"],
        allowedMerchants: ["Trailhead Supply", "Page Turner Books"],
        maxQuantityPerItem: 2,
        shippingAddress,
        expiresAt: new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000,
        ).toISOString(),
      }),
    });

    if (mandateRes.status !== 201) {
      const errText = await mandateRes.text();
      process.stderr.write(
        `Failed to create mandate: ${mandateRes.status} ${errText}\n`,
      );
      process.exit(1);
    }

    const proposal1 = await submitProposal({
      items: [
        {
          productId: "prod_trail_pack_24",
          title: "Trailhead Lightweight Daypack",
          merchant: "Trailhead Supply",
          category: "hiking",
          unitPrice: 24.99,
          quantity: 1,
          url: "https://trailheadsupply.example/daypack",
        },
      ],
      shipTo: shippingAddress,
      currency: "USD",
      agentReasoning:
        "Recommended lightweight daypack within budget and threshold.",
      sourceUrls: ["https://trailheadsupply.example/daypack"],
    });

    if (proposal1.status !== "awaiting_buyer") {
      process.stderr.write(
        `Scenario 1 expected awaiting_buyer, got ${proposal1.status}\n`,
      );
      process.exit(1);
    }

    if (!proposal1.payment?.approveUrl) {
      process.stderr.write("Scenario 1 expected approveUrl on payment info\n");
      process.exit(1);
    }

    await fetch(proposal1.payment.approveUrl, { redirect: "follow" });

    const p1CheckRes = await fetch(`${baseUrl}/api/proposals/${proposal1.id}`);
    const p1Final = (await p1CheckRes.json()) as Proposal;

    if (p1Final.status !== "captured") {
      process.stderr.write(
        `Scenario 1 expected final status captured, got ${p1Final.status}\n`,
      );
      process.exit(1);
    }

    const proposal2 = await submitProposal({
      items: [
        {
          productId: "prod_trail_poles_55",
          title: "Trailhead Carbon Trekking Poles",
          merchant: "Trailhead Supply",
          category: "hiking",
          unitPrice: 55.0,
          quantity: 1,
          url: "https://trailheadsupply.example/poles",
        },
      ],
      shipTo: shippingAddress,
      currency: "USD",
      agentReasoning:
        "High quality trekking poles exceeding approval threshold of $50.",
      sourceUrls: ["https://trailheadsupply.example/poles"],
    });

    if (proposal2.status !== "needs_approval") {
      process.stderr.write(
        `Scenario 2 expected needs_approval, got ${proposal2.status}\n`,
      );
      process.exit(1);
    }

    const decisionRes = await fetch(
      `${baseUrl}/api/proposals/${proposal2.id}/decision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      },
    );

    if (decisionRes.status !== 200) {
      const errText = await decisionRes.text();
      process.stderr.write(
        `Scenario 2 decision approval failed: ${decisionRes.status} ${errText}\n`,
      );
      process.exit(1);
    }

    const p2Approved = (await decisionRes.json()) as Proposal;

    if (!p2Approved.payment?.approveUrl) {
      process.stderr.write(
        "Scenario 2 expected approveUrl after approval decision\n",
      );
      process.exit(1);
    }

    await fetch(p2Approved.payment.approveUrl, { redirect: "follow" });

    const p2CheckRes = await fetch(`${baseUrl}/api/proposals/${proposal2.id}`);
    const p2Final = (await p2CheckRes.json()) as Proposal;

    if (p2Final.status !== "captured") {
      process.stderr.write(
        `Scenario 2 expected final status captured, got ${p2Final.status}\n`,
      );
      process.exit(1);
    }

    const proposal3 = await submitProposal({
      items: [
        {
          productId: "prod_attack_10",
          title: "Bulk Tactical Survival Kits",
          merchant: "Unauthorized Merchant Outlet",
          category: "hiking",
          unitPrice: 5.0,
          quantity: 10,
          url: "https://unauthorized.example/gear",
        },
      ],
      shipTo: {
        name: "Unknown Entity",
        line1: "456 Suspicious Boulevard",
        city: "Mumbai",
        region: "Maharashtra",
        postalCode: "400001",
        country: "India",
      },
      currency: "USD",
      agentReasoning:
        "Adversarial injection attempting bulk order to alternate drop location.",
      sourceUrls: ["https://unauthorized.example/gear"],
    });

    if (proposal3.status !== "blocked") {
      process.stderr.write(
        `Scenario 3 expected blocked, got ${proposal3.status}\n`,
      );
      process.exit(1);
    }

    const merchantRule = proposal3.policy.results.find(
      (r) => r.rule === "merchant_allowed",
    );
    const quantityRule = proposal3.policy.results.find(
      (r) => r.rule === "max_quantity",
    );
    const shipToRule = proposal3.policy.results.find(
      (r) => r.rule === "ship_to_matches",
    );

    if (!merchantRule || merchantRule.passed) {
      process.stderr.write(
        "Scenario 3 expected merchant_allowed rule to fail\n",
      );
      process.exit(1);
    }

    if (!quantityRule || quantityRule.passed) {
      process.stderr.write("Scenario 3 expected max_quantity rule to fail\n");
      process.exit(1);
    }

    if (!shipToRule || shipToRule.passed) {
      process.stderr.write("Scenario 3 expected ship_to_matches rule to fail\n");
      process.exit(1);
    }

    if (proposal3.payment?.orderId) {
      process.stderr.write("Scenario 3 expected no order to be created\n");
      process.exit(1);
    }

    console.table([
      {
        Scenario: "Scenario 1 (allowed)",
        "Proposal ID": p1Final.id,
        "Final Status": p1Final.status,
        Decision: proposal1.policy.decision,
      },
      {
        Scenario: "Scenario 2 (ask)",
        "Proposal ID": p2Final.id,
        "Final Status": p2Final.status,
        Decision: proposal2.policy.decision,
      },
      {
        Scenario: "Scenario 3 (attack)",
        "Proposal ID": proposal3.id,
        "Final Status": proposal3.status,
        Decision: proposal3.policy.decision,
      },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    db.close();
  }
}

run().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write(`Unhandled error in demo seed: ${msg}\n`);
  process.exit(1);
});
