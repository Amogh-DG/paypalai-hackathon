import type { AuditEntry, RuleResult } from "@leash/shared";

export function formatLocalTime(isoString: string): string {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString();
}

export function formatAmount(amount?: number | null): string {
  if (
    amount === undefined ||
    amount === null ||
    typeof amount !== "number" ||
    Number.isNaN(amount)
  ) {
    return "";
  }
  return `$${amount.toFixed(2)}`;
}

export function getDecisionBadgeStyle(
  decision?: string | null,
): { bg: string; color: string; border: string } | null {
  if (!decision) {
    return null;
  }
  switch (decision.toLowerCase()) {
    case "allow":
      return {
        bg: "var(--color-green-bg)",
        color: "var(--color-green)",
        border: "var(--color-green)",
      };
    case "ask":
      return {
        bg: "var(--color-amber-bg)",
        color: "var(--color-amber)",
        border: "var(--color-amber)",
      };
    case "block":
      return {
        bg: "var(--color-red-bg)",
        color: "var(--color-red)",
        border: "var(--color-red)",
      };
    default:
      return null;
  }
}

export function parseRuleResults(
  details: Record<string, unknown>,
): RuleResult[] | null {
  if (!details || !Array.isArray(details.results)) {
    return null;
  }
  const results: RuleResult[] = [];
  for (const item of details.results) {
    if (
      typeof item === "object" &&
      item !== null &&
      "rule" in item &&
      "passed" in item &&
      "severity" in item &&
      "message" in item
    ) {
      results.push({
        rule: String(item.rule),
        passed: Boolean(item.passed),
        severity: item.severity === "ask" ? "ask" : "block",
        message: String(item.message),
      });
    }
  }
  return results.length > 0 ? results : null;
}

export function parseReasons(
  details: Record<string, unknown>,
): string[] | null {
  if (!details || !Array.isArray(details.reasons)) {
    return null;
  }
  return details.reasons.map((r) => String(r));
}

export function getOtherDetails(
  details: Record<string, unknown>,
): Array<{ key: string; value: unknown }> {
  if (!details) {
    return [];
  }
  const entries: Array<{ key: string; value: unknown }> = [];
  for (const [key, value] of Object.entries(details)) {
    if (key !== "results" && key !== "reasons") {
      entries.push({ key, value });
    }
  }
  return entries;
}

export function formatDetailValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function filterAuditEntries(
  entries: AuditEntry[],
  filters: {
    quickFilter: string;
    eventFilter: string;
    proposalFilter: string;
  },
): AuditEntry[] {
  const quick = filters.quickFilter.trim().toLowerCase();
  const event = filters.eventFilter.trim();
  const proposal = filters.proposalFilter.trim().toLowerCase();

  return entries.filter((entry) => {
    if (event && entry.event !== event) {
      return false;
    }
    if (
      proposal &&
      (!entry.proposalId ||
        !entry.proposalId.toLowerCase().includes(proposal))
    ) {
      return false;
    }
    if (quick) {
      const matchId = entry.id.toLowerCase().includes(quick);
      const matchTime =
        entry.timestamp.toLowerCase().includes(quick) ||
        formatLocalTime(entry.timestamp).toLowerCase().includes(quick);
      const matchEvent = entry.event.toLowerCase().includes(quick);
      const matchProposal =
        entry.proposalId?.toLowerCase().includes(quick) ?? false;
      const matchDecision =
        entry.decision?.toLowerCase().includes(quick) ?? false;
      const matchAmount =
        entry.amount !== undefined
          ? formatAmount(entry.amount).toLowerCase().includes(quick)
          : false;
      const matchSummary = entry.summary.toLowerCase().includes(quick);
      const matchDetails = JSON.stringify(entry.details)
        .toLowerCase()
        .includes(quick);

      if (
        !matchId &&
        !matchTime &&
        !matchEvent &&
        !matchProposal &&
        !matchDecision &&
        !matchAmount &&
        !matchSummary &&
        !matchDetails
      ) {
        return false;
      }
    }
    return true;
  });
}
