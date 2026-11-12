import React from "react";
import type { AuditEntry } from "@leash/shared";
import {
  formatLocalTime,
  formatAmount,
  getDecisionBadgeStyle,
  parseRuleResults,
  parseReasons,
  getOtherDetails,
  formatDetailValue,
} from "./helpers";

type DetailPanelProps = {
  entry: AuditEntry;
  onClose: () => void;
  onProposalClick?: (proposalId: string) => void;
};

export const DetailPanel: React.FC<DetailPanelProps> = ({
  entry,
  onClose,
  onProposalClick,
}) => {
  const decisionStyle = getDecisionBadgeStyle(entry.decision);
  const ruleResults = parseRuleResults(entry.details);
  const reasons = parseReasons(entry.details);
  const otherDetails = getOtherDetails(entry.details);

  return (
    <div
      style={{
        marginTop: "1.5rem",
        border: "1px solid var(--color-line)",
        borderRadius: "8px",
        backgroundColor: "var(--color-surface)",
        boxShadow: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 1.5rem",
          backgroundColor: "var(--color-surface)",
          borderBottom: "1px solid var(--color-line)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            Audit Entry Details
          </h3>
          <span
            style={{
              fontSize: "0.875rem",
              fontFamily: "monospace",
              color: "var(--color-text-secondary)",
            }}
          >
            {entry.id}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "0.375rem 0.75rem",
            backgroundColor: "var(--color-surface)",
            border: "1px solid var(--color-line)",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 500,
            fontSize: "0.875rem",
            color: "var(--color-text-primary)",
          }}
        >
          ✕ Close
        </button>
      </div>

      <div style={{ padding: "1.5rem" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
            padding: "1rem",
            backgroundColor: "var(--color-surface)",
            borderRadius: "6px",
            border: "1px solid var(--color-line)",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Event
            </div>
            <div style={{ marginTop: "0.25rem" }}>
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  backgroundColor: "var(--color-surface)",
                  color: "var(--color-text-primary)",
                  border: "1px solid var(--color-line)",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  fontWeight: 600,
                }}
              >
                {entry.event}
              </span>
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Proposal ID
            </div>
            <div style={{ marginTop: "0.25rem", fontSize: "0.875rem" }}>
              {entry.proposalId ? (
                <button
                  type="button"
                  onClick={() => onProposalClick?.(entry.proposalId!)}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--color-text-primary)",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  }}
                >
                  {entry.proposalId}
                </button>
              ) : (
                <span style={{ color: "var(--color-text-tertiary)" }}>None</span>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Decision
            </div>
            <div style={{ marginTop: "0.25rem" }}>
              {entry.decision && decisionStyle ? (
                <span
                  style={{
                    display: "inline-block",
                    padding: "2px 8px",
                    borderRadius: "4px",
                    backgroundColor: decisionStyle.bg,
                    color: decisionStyle.color,
                    border: `1px solid ${decisionStyle.border}`,
                    fontWeight: 700,
                    fontSize: "12px",
                    textTransform: "uppercase",
                  }}
                >
                  {entry.decision}
                </span>
              ) : (
                <span style={{ color: "var(--color-text-tertiary)", fontSize: "0.875rem" }}>
                  None
                </span>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Amount
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.875rem",
                fontWeight: 600,
              }}
            >
              {entry.amount !== undefined ? (
                formatAmount(entry.amount)
              ) : (
                <span style={{ color: "var(--color-text-tertiary)", fontWeight: 400 }}>None</span>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Timestamp (ISO)
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.875rem",
                fontFamily: "monospace",
              }}
            >
              {entry.timestamp}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Local Time
            </div>
            <div style={{ marginTop: "0.25rem", fontSize: "0.875rem" }}>
              {formatLocalTime(entry.timestamp)}
            </div>
          </div>

          <div style={{ gridColumn: "1 / -1" }}>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "var(--color-text-secondary)",
                fontWeight: 600,
              }}
            >
              Summary
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.9375rem",
                color: "var(--color-text-primary)",
              }}
            >
              {entry.summary}
            </div>
          </div>
        </div>

        {ruleResults && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h4
              style={{
                margin: "0 0 0.75rem 0",
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Policy Evaluation Rules
            </h4>
            <div
              style={{
                overflowX: "auto",
                border: "1px solid var(--color-line)",
                borderRadius: "6px",
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  textAlign: "left",
                  fontSize: "0.875rem",
                }}
              >
                <thead>
                  <tr
                    style={{
                      backgroundColor: "var(--color-surface-raised)",
                      borderBottom: "1px solid var(--color-line)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    <th style={{ padding: "0.625rem 0.75rem", width: "100px" }}>
                      Status
                    </th>
                    <th style={{ padding: "0.625rem 0.75rem", width: "180px" }}>
                      Rule
                    </th>
                    <th style={{ padding: "0.625rem 0.75rem", width: "100px" }}>
                      Severity
                    </th>
                    <th style={{ padding: "0.625rem 0.75rem" }}>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {ruleResults.map((r) => {
                    const isFailedBlock = !r.passed && r.severity === "block";
                    const isFailedAsk = !r.passed && r.severity === "ask";

                    const rowBg = isFailedBlock
                      ? "var(--color-red-bg)"
                      : isFailedAsk
                        ? "var(--color-amber-bg)"
                        : "var(--color-surface)";
                    const rowBorder = isFailedBlock
                      ? "var(--color-red)"
                      : "var(--color-line)";

                    return (
                      <tr
                        key={r.rule}
                        style={{
                          backgroundColor: rowBg,
                          borderBottom: `1px solid ${rowBorder}`,
                          fontWeight: isFailedBlock ? 600 : 400,
                        }}
                      >
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          {r.passed ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: "var(--color-green-bg)",
                                color: "var(--color-green)",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              ✓ PASS
                            </span>
                          ) : isFailedBlock ? (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: "var(--color-red-bg)",
                                color: "var(--color-red)",
                                border: "1px solid var(--color-red)",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              ✕ FAIL
                            </span>
                          ) : (
                            <span
                              style={{
                                display: "inline-block",
                                padding: "2px 6px",
                                borderRadius: "4px",
                                backgroundColor: "var(--color-amber-bg)",
                                color: "var(--color-amber)",
                                border: "1px solid var(--color-amber)",
                                fontSize: "11px",
                                fontWeight: 700,
                              }}
                            >
                              ⚠ ASK
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "0.625rem 0.75rem",
                            fontFamily: "monospace",
                            color: isFailedBlock
                              ? "var(--color-red)"
                              : "var(--color-text-primary)",
                          }}
                        >
                          {r.rule}
                        </td>
                        <td style={{ padding: "0.625rem 0.75rem" }}>
                          <span
                            style={{
                              textTransform: "uppercase",
                              fontSize: "11px",
                              fontWeight: 600,
                              color: isFailedBlock
                                ? "var(--color-red)"
                                : "var(--color-text-secondary)",
                            }}
                          >
                            {r.severity}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "0.625rem 0.75rem",
                            color: isFailedBlock
                              ? "var(--color-red)"
                              : "var(--color-text-primary)",
                          }}
                        >
                          {r.message}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {reasons && reasons.length > 0 && (
          <div style={{ marginBottom: "1.5rem" }}>
            <h4
              style={{
                margin: "0 0 0.5rem 0",
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Reasons
            </h4>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.5rem",
                color: "var(--color-text-primary)",
                fontSize: "0.875rem",
                lineHeight: "1.5",
              }}
            >
              {reasons.map((reason, idx) => (
                <li key={idx} style={{ marginBottom: "0.25rem" }}>
                  {reason}
                </li>
              ))}
            </ul>
          </div>
        )}

        {otherDetails.length > 0 && (
          <div>
            <h4
              style={{
                margin: "0 0 0.5rem 0",
                fontSize: "1rem",
                fontWeight: 600,
                color: "var(--color-text-primary)",
              }}
            >
              Additional Details
            </h4>
            <div
              style={{
                border: "1px solid var(--color-line)",
                borderRadius: "6px",
                padding: "0.75rem 1rem",
                backgroundColor: "var(--color-surface)",
              }}
            >
              {otherDetails.map(({ key, value }) => {
                const isComplex =
                  typeof value === "object" && value !== null;
                return (
                  <div
                    key={key}
                    style={{
                      marginBottom: "0.5rem",
                      fontSize: "0.875rem",
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {key}:
                    </div>
                    {isComplex ? (
                      <pre
                        style={{
                          margin: "0.25rem 0 0 0",
                          padding: "0.5rem",
                          backgroundColor: "var(--color-surface)",
                          border: "1px solid var(--color-line)",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontFamily: "monospace",
                          overflowX: "auto",
                          maxHeight: "200px",
                        }}
                      >
                        {formatDetailValue(value)}
                      </pre>
                    ) : (
                      <div
                        style={{
                          color: "var(--color-text-primary)",
                          fontFamily:
                            typeof value === "string" && value.length > 20
                              ? "monospace"
                              : "inherit",
                        }}
                      >
                        {formatDetailValue(value)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
