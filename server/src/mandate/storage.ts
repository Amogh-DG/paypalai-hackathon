import type { Database as DatabaseType } from "better-sqlite3";
import type { Mandate } from "@leash/shared";

export function saveMandate(db: DatabaseType, mandate: Mandate): void {
  const stmtDelete = db.prepare("DELETE FROM mandate");
  const stmtInsert = db.prepare(`
    INSERT INTO mandate (
      id, owner, currency, total_budget, per_item_cap, approval_threshold,
      allowed_categories, allowed_merchants, max_quantity_per_item,
      shipping_address, expires_at, created_at, signature
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  db.transaction(() => {
    stmtDelete.run();
    stmtInsert.run(
      mandate.id,
      mandate.owner,
      mandate.currency,
      mandate.totalBudget,
      mandate.perItemCap,
      mandate.approvalThreshold,
      JSON.stringify(mandate.allowedCategories),
      JSON.stringify(mandate.allowedMerchants),
      mandate.maxQuantityPerItem,
      JSON.stringify(mandate.shippingAddress),
      mandate.expiresAt,
      mandate.createdAt,
      mandate.signature,
    );
  })();
}

export function getMandate(db: DatabaseType): Mandate | null {
  const row = db.prepare("SELECT * FROM mandate LIMIT 1").get() as
    | {
        id: string;
        owner: string;
        currency: "USD";
        total_budget: number;
        per_item_cap: number;
        approval_threshold: number;
        allowed_categories: string;
        allowed_merchants: string;
        max_quantity_per_item: number;
        shipping_address: string;
        expires_at: string;
        created_at: string;
        signature: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    owner: row.owner,
    currency: row.currency,
    totalBudget: row.total_budget,
    perItemCap: row.per_item_cap,
    approvalThreshold: row.approval_threshold,
    allowedCategories: JSON.parse(row.allowed_categories),
    allowedMerchants: JSON.parse(row.allowed_merchants),
    maxQuantityPerItem: row.max_quantity_per_item,
    shippingAddress: JSON.parse(row.shipping_address),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    signature: row.signature,
  };
}
