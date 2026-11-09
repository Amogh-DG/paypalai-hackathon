import type { RuleResult } from "@leash/shared";

export function RuleList({ rules }: { rules: RuleResult[] }) {
  const failed = rules.filter((rule) => !rule.passed);
  const passed = rules.filter((rule) => rule.passed);
  return (
    <div>
      {failed.length > 0 && (
        <ul style={{ color: "var(--color-red)" }}>
          {failed.map((rule, index) => (
            <li key={`${rule.rule}-${index}`}>
              <strong>{rule.rule}</strong>: {rule.message}
            </li>
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <details style={{ color: "var(--color-text-secondary)" }}>
          <summary>Passed checks ({passed.length})</summary>
          <ul>
            {passed.map((rule, index) => (
              <li key={`${rule.rule}-${index}`}>
                {rule.rule}: {rule.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
