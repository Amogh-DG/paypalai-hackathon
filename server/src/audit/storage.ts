import type { Database as DatabaseType } from "better-sqlite3";
import type { AuditEntry } from "@leash/shared";
import { newId } from "../ids.js";

export function writeAudit(
  db: DatabaseType,
  entry: Omit<AuditEntry, "id" | "timestamp">,
): AuditEntry {
  const id = newId("aud_");
  const timestamp = new Date().toISOString();
  const fullEntry: AuditEntry = {
    ...entry,
    id,
    timestamp,
  };

  const stmt = db.prepare(`
    INSERT INTO audit_entries (
      id, timestamp, proposal_id, event, summary, amount, decision, details
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    fullEntry.id,
    fullEntry.timestamp,
    fullEntry.proposalId ?? null,
    fullEntry.event,
    fullEntry.summary,
    fullEntry.amount ?? null,
    fullEntry.decision ?? null,
    JSON.stringify(fullEntry.details ?? {}),
  );

  return fullEntry;
}

export function listAudit(db: DatabaseType, limit: number): AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM audit_entries ORDER BY timestamp DESC, rowid DESC LIMIT ?`,
    )
    .all(limit) as {
    id: string;
    timestamp: string;
    proposal_id: string | null;
    event: AuditEntry["event"];
    summary: string;
    amount: number | null;
    decision: AuditEntry["decision"] | null;
    details: string;
  }[];

  return rows.map((r) => ({
    id: r.id,
    timestamp: r.timestamp,
    proposalId: r.proposal_id ?? undefined,
    event: r.event,
    summary: r.summary,
    amount: r.amount ?? undefined,
    decision: r.decision ?? undefined,
    details: r.details ? JSON.parse(r.details) : {},
  }));
}
