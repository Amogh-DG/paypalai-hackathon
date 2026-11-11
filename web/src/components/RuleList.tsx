import type { RuleResult } from "@leash/shared";

export function RuleList({ rules }: { rules: RuleResult[] }) {
  return (
    <div>
      <ul>
        {rules.map((rule, index) => (
          <li
            key={`${rule.rule}-${index}`}
            style={{
              color: rule.passed
                ? "var(--color-text-secondary)"
                : "var(--color-red)",
            }}
          >
            <strong>{rule.rule}</strong>: {rule.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
