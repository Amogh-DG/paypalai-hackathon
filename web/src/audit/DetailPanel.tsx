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
        border: "1px solid #d1d5db",
        borderRadius: "8px",
        backgroundColor: "#ffffff",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "1rem 1.5rem",
          backgroundColor: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <h3
            style={{
              margin: 0,
              fontSize: "1.125rem",
              fontWeight: 600,
              color: "#111827",
            }}
          >
            Audit Entry Details
          </h3>
          <span
            style={{
              fontSize: "0.875rem",
              fontFamily: "monospace",
              color: "#6b7280",
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
            backgroundColor: "#ffffff",
            border: "1px solid #d1d5db",
            borderRadius: "4px",
            cursor: "pointer",
            fontWeight: 500,
            fontSize: "0.875rem",
            color: "#374151",
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
            backgroundColor: "#f9fafb",
            borderRadius: "6px",
            border: "1px solid #e5e7eb",
          }}
        >
          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "#6b7280",
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
                  backgroundColor: "#e5e7eb",
                  color: "#1f2937",
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
                color: "#6b7280",
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
                    color: "#0070ba",
                    textDecoration: "underline",
                    cursor: "pointer",
                    fontFamily: "monospace",
                    fontSize: "0.875rem",
                  }}
                >
                  {entry.proposalId}
                </button>
              ) : (
                <span style={{ color: "#9ca3af" }}>None</span>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "#6b7280",
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
                <span style={{ color: "#9ca3af", fontSize: "0.875rem" }}>
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
                color: "#6b7280",
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
                <span style={{ color: "#9ca3af", fontWeight: 400 }}>None</span>
              )}
            </div>
          </div>

          <div>
            <div
              style={{
                fontSize: "0.75rem",
                textTransform: "uppercase",
                color: "#6b7280",
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
                color: "#6b7280",
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
                color: "#6b7280",
                fontWeight: 600,
              }}
            >
              Summary
            </div>
            <div
              style={{
                marginTop: "0.25rem",
                fontSize: "0.9375rem",
                color: "#111827",
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
                color: "#1f2937",
              }}
            >
              Policy Evaluation Rules
            </h4>
            <div
              style={{
                overflowX: "auto",
                border: "1px solid #e5e7eb",
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
                      backgroundColor: "#f3f4f6",
                      borderBottom: "1px solid #e5e7eb",
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
                      ? "#fef2f2"
                      : isFailedAsk
                        ? "#fffbeb"
                        : "#ffffff";
                    const rowBorder = isFailedBlock ? "#fca5a5" : "#e5e7eb";

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
                                backgroundColor: "#dcfce7",
                                color: "#166534",
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
                                backgroundColor: "#fee2e2",
                                color: "#991b1b",
                                border: "1px solid #ef4444",
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
                                backgroundColor: "#fef3c7",
                                color: "#92400e",
                                border: "1px solid #f59e0b",
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
                            color: isFailedBlock ? "#991b1b" : "#1f2937",
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
                              color: isFailedBlock ? "#b91c1c" : "#4b5563",
                            }}
                          >
                            {r.severity}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "0.625rem 0.75rem",
                            color: isFailedBlock ? "#991b1b" : "#374151",
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
                color: "#1f2937",
              }}
            >
              Reasons
            </h4>
            <ul
              style={{
                margin: 0,
                paddingLeft: "1.5rem",
                color: "#374151",
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
                color: "#1f2937",
              }}
            >
              Additional Details
            </h4>
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                padding: "0.75rem 1rem",
                backgroundColor: "#f9fafb",
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
                    <div style={{ fontWeight: 600, color: "#374151" }}>
                      {key}:
                    </div>
                    {isComplex ? (
                      <pre
                        style={{
                          margin: "0.25rem 0 0 0",
                          padding: "0.5rem",
                          backgroundColor: "#ffffff",
                          border: "1px solid #e5e7eb",
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
                          color: "#111827",
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
