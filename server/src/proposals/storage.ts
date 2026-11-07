import type { Database as DatabaseType } from "better-sqlite3";
import type { Proposal, ProposalStatus } from "@leash/shared";

export type ProposalRow = {
  id: string;
  created_at: string;
  total: number;
  status: string;
  currency: string;
  agent_reasoning: string;
  items: string;
  ship_to: string;
  source_urls: string;
  policy: string;
  payment: string | null;
  user_decision: string | null;
};

export function rowToProposal(row: ProposalRow): Proposal {
  const proposal: Proposal = {
    id: row.id,
    createdAt: row.created_at,
    total: row.total,
    status: row.status as ProposalStatus,
    currency: row.currency as "USD",
    agentReasoning: row.agent_reasoning,
    items: JSON.parse(row.items),
    shipTo: JSON.parse(row.ship_to),
    sourceUrls: JSON.parse(row.source_urls),
    policy: JSON.parse(row.policy),
  };
  if (row.payment) {
    proposal.payment = JSON.parse(row.payment);
  }
  if (row.user_decision) {
    proposal.userDecision = JSON.parse(row.user_decision);
  }
  return proposal;
}

export function saveProposal(db: DatabaseType, proposal: Proposal): void {
  const stmt = db.prepare(`
    INSERT INTO proposals (
      id, created_at, total, status, currency, agent_reasoning,
      items, ship_to, source_urls, policy, payment, user_decision
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    proposal.id,
    proposal.createdAt,
    proposal.total,
    proposal.status,
    proposal.currency,
    proposal.agentReasoning,
    JSON.stringify(proposal.items),
    JSON.stringify(proposal.shipTo),
    JSON.stringify(proposal.sourceUrls),
    JSON.stringify(proposal.policy),
    proposal.payment ? JSON.stringify(proposal.payment) : null,
    proposal.userDecision ? JSON.stringify(proposal.userDecision) : null,
  );
}

export function getProposal(db: DatabaseType, id: string): Proposal | null {
  const row = db
    .prepare("SELECT * FROM proposals WHERE id = ?")
    .get(id) as ProposalRow | undefined;
  if (!row) {
    return null;
  }
  return rowToProposal(row);
}

export function listProposals(db: DatabaseType): Proposal[] {
  const rows = db
    .prepare(
      "SELECT * FROM proposals ORDER BY created_at DESC, rowid DESC",
    )
    .all() as ProposalRow[];
  return rows.map(rowToProposal);
}
