import type { Database as DatabaseType } from "better-sqlite3";
import { centsToDollars, dollarsToCents } from "@leash/shared";

export function getSpent(db: DatabaseType): number {
  const rows = db
    .prepare(
      `SELECT total FROM proposals WHERE status IN ('awaiting_buyer', 'authorized', 'captured')`,
    )
    .all() as { total: number }[];

  const spentCents = rows.reduce(
    (sum, row) => sum + dollarsToCents(row.total),
    0,
  );
  return centsToDollars(spentCents);
}
