import {
  ERROR_CODES,
  type Proposal,
  type ProposalStatus,
} from "@leash/shared";
import type { Database as DatabaseType } from "better-sqlite3";
import { AppError } from "../http/errors.js";
import { rowToProposal, type ProposalRow } from "./storage.js";

export const ALLOWED_TRANSITIONS: Record<
  ProposalStatus,
  readonly ProposalStatus[]
> = {
  needs_approval: ["approved", "rejected"],
  approved: ["awaiting_buyer", "failed"],
  awaiting_buyer: ["authorized", "voided", "failed"],
  authorized: ["captured", "voided", "failed"],
  blocked: [],
  rejected: [],
  captured: [],
  voided: [],
  failed: [],
};

export function assertValidTransition(
  currentStatus: ProposalStatus,
  newStatus: ProposalStatus,
): void {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new AppError(
      ERROR_CODES.INVALID_STATE,
      `Invalid proposal status transition from ${currentStatus} to ${newStatus}`,
    );
  }
}

export function setStatus(
  first: ProposalStatus | Proposal | DatabaseType,
  second: ProposalStatus | string,
  third?: ProposalStatus,
): ProposalStatus | Proposal {
  if (typeof first === "string") {
    assertValidTransition(first as ProposalStatus, second as ProposalStatus);
    return second as ProposalStatus;
  }
  if (
    typeof first === "object" &&
    first !== null &&
    "status" in first &&
    "id" in first
  ) {
    const p = first as Proposal;
    assertValidTransition(p.status, second as ProposalStatus);
    return { ...p, status: second as ProposalStatus };
  }
  const db = first as DatabaseType;
  const proposalId = second as string;
  const newStatus = third as ProposalStatus;
  const row = db
    .prepare("SELECT * FROM proposals WHERE id = ?")
    .get(proposalId) as ProposalRow | undefined;
  if (!row) {
    throw new AppError(
      ERROR_CODES.NOT_FOUND,
      `Proposal ${proposalId} not found`,
    );
  }
  assertValidTransition(row.status as ProposalStatus, newStatus);
  db.prepare("UPDATE proposals SET status = ? WHERE id = ?").run(
    newStatus,
    proposalId,
  );
  const updatedRow = db
    .prepare("SELECT * FROM proposals WHERE id = ?")
    .get(proposalId) as ProposalRow;
  return rowToProposal(updatedRow);
}
