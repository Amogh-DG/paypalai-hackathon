import type { PolicyDecision } from "@leash/shared";

const decisions = {
  allow: { color: "green", label: "Allow" },
  ask: { color: "amber", label: "Ask" },
  block: { color: "red", label: "Block" },
} as const;

export function DecisionBadge({
  decision,
}: {
  decision: PolicyDecision["decision"];
}) {
  const { color, label } = decisions[decision];
  return <span className={`badge badge--${color}`}>{label}</span>;
}
