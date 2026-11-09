import { useEffect, useRef } from "react";
import { useProposalPolling } from "../hooks/useProposalPolling";
import { formatAmount } from "../audit/helpers";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";
import { DecisionBadge } from "./DecisionBadge";
import { RuleList } from "./RuleList";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";

export function ProposalCard({
  id,
  highlighted = false,
}: {
  id: string;
  highlighted?: boolean;
}) {
  const { proposal, error, failures, retry } = useProposalPolling(id);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (highlighted) element.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted, Boolean(proposal)]);
  return (
    <div
      ref={element}
      data-proposal-id={id}
      style={{
        border: `2px solid var(${highlighted ? "--color-accent" : "--color-border"})`,
        borderRadius: "var(--radius-lg)",
        marginTop: 12,
        overflowWrap: "anywhere",
      }}
    >
      <Card animate>
        {!proposal ? (
          error ? (
            error.code === "not_found" ? (
              <p>Proposal not found</p>
            ) : (
              <ErrorState message={error.message} onRetry={retry} />
            )
          ) : (
            <LoadingState label="Loading proposal" />
          )
        ) : (
          <>
            <header
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              <strong title={proposal.id}>
                Proposal {proposal.id.slice(0, 12)}
              </strong>
              <StatusBadge status={proposal.status} />
              <DecisionBadge decision={proposal.policy.decision} />
            </header>
            <ul>
              {proposal.items.map((item, index) => (
                <li
                  key={`${item.productId}-${index}`}
                  style={{ marginBlock: 12 }}
                >
                  <strong>{item.title}</strong>
                  <div>{item.merchant}</div>
                  <div>
                    {item.quantity} × {formatAmount(item.unitPrice)} ={" "}
                    {formatAmount(item.quantity * item.unitPrice)}
                  </div>
                </li>
              ))}
            </ul>
            <div>
              <strong>Total: {formatAmount(proposal.total)}</strong>
            </div>
            <div style={{ marginBlock: 16 }}>
              <strong>Ship to: {proposal.shipTo.name}</strong>
              <div>
                {[
                  proposal.shipTo.line1,
                  proposal.shipTo.city,
                  proposal.shipTo.region,
                  proposal.shipTo.postalCode,
                  proposal.shipTo.country,
                ].join(", ")}
              </div>
            </div>
            <RuleList rules={proposal.policy.results} />
            {failures >= 3 && (
              <small role="status">
                Updates paused. Retrying automatically.
              </small>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
