import type { Database as DatabaseType } from "better-sqlite3";
import { centsToDollars, dollarsToCents } from "@leash/shared";

export function getSpent(
  db: DatabaseType,
  excludeProposalId?: string,
): number {
  const query = excludeProposalId
    ? `SELECT total FROM proposals WHERE status IN ('awaiting_buyer', 'authorized', 'captured') AND id != ?`
    : `SELECT total FROM proposals WHERE status IN ('awaiting_buyer', 'authorized', 'captured')`;

  const rows = (
    excludeProposalId
      ? db.prepare(query).all(excludeProposalId)
      : db.prepare(query).all()
  ) as { total: number }[];

  const spentCents = rows.reduce(
    (sum, row) => sum + dollarsToCents(row.total),
    0,
  );
  return centsToDollars(spentCents);
}
