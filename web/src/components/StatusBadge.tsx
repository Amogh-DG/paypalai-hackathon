import type { ProposalStatus } from "@leash/shared";

const statuses: Record<
  ProposalStatus,
  { color: "red" | "amber" | "neutral" | "green"; label: string }
> = {
  blocked: { color: "red", label: "Blocked" },
  rejected: { color: "red", label: "Rejected" },
  voided: { color: "red", label: "Voided" },
  failed: { color: "red", label: "Failed" },
  needs_approval: { color: "amber", label: "Needs approval" },
  approved: { color: "neutral", label: "Approved" },
  awaiting_buyer: { color: "neutral", label: "Awaiting buyer" },
  authorized: { color: "neutral", label: "Authorized" },
  captured: { color: "green", label: "Captured" },
};

export function StatusBadge({ status }: { status: ProposalStatus }) {
  const { color, label } = statuses[status];
  return <span className={`badge badge--${color}`}>{label}</span>;
}
