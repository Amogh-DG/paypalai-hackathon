import { useEffect, useId, useRef, useState } from "react";
import { useProposalPolling } from "../hooks/useProposalPolling";
import { formatUsd as formatAmount } from "../format";
import { getProposal, postDecision } from "../api";
import { Button } from "./Button";
import { ApprovalDialog, useApprovalCoordinator } from "./ApprovalDialog";
import { Card } from "./Card";
import { StatusBadge } from "./StatusBadge";
import { DecisionBadge } from "./DecisionBadge";
import { RuleList } from "./RuleList";
import { LoadingState } from "./LoadingState";
import { ErrorState } from "./ErrorState";

export function ProposalCard({
  id,
  highlighted = false,
  initialProposal,
}: {
  id: string;
  highlighted?: boolean;
  initialProposal?: import("@leash/shared").Proposal;
}) {
  const { proposal: polledProposal, error, failures, retry, acceptProposal } =
    useProposalPolling(id);
  const proposal = polledProposal ?? initialProposal;
  const approval = useApprovalCoordinator();
  const instance = useId();
  const coordinator = useRef(approval);
  coordinator.current = approval;
  useEffect(() => () => coordinator.current.close(instance), [instance]);
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const [decisionError, setDecisionError] = useState<string>();
  const [note, setNote] = useState<string>();
  const [paymentError, setPaymentError] = useState<string>();
  const review = useRef<HTMLDivElement>(null);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (proposal?.status === "needs_approval")
      approval.open(instance, id, true);
  }, [proposal?.status, approval, instance, id]);
  const decide = async (action: "approve" | "reject") => {
    if (pending.current) return;
    pending.current = true;
    setWorking(true);
    setDecisionError(undefined);
    try {
      const result = await postDecision(id, action);
      acceptProposal(result);
      approval.close(instance);
    } catch (failure: unknown) {
      const code =
        typeof failure === "object" && failure !== null && "code" in failure
          ? failure.code
          : undefined;
      const message =
        typeof failure === "object" && failure !== null && "message" in failure
          ? String(failure.message)
          : "Unable to save your decision.";
      if (code === "invalid_state") {
        approval.close(instance);
        setNote("This proposal has already been decided.");
        try {
          acceptProposal(await getProposal(id));
        } catch (reloadError: unknown) {
          if (
            typeof reloadError === "object" &&
            reloadError !== null &&
            "code" in reloadError &&
            reloadError.code === "not_found"
          )
            setNote("Proposal not found");
          retry();
        }
      } else
        setDecisionError(
          code === "not_found" ? "Proposal not found" : message,
        );
    } finally {
      pending.current = false;
      setWorking(false);
    }
  };
  const pay = () => {
    try {
      const url = new URL(proposal?.payment?.approveUrl ?? "");
      if (url.protocol !== "http:" && url.protocol !== "https:")
        throw new Error("Invalid scheme");
      window.location.assign(url.href);
    } catch {
      setPaymentError("Payment link is invalid.");
    }
  };
  const finalSummary = {
    captured: "Payment completed.",
    voided: "Payment authorization canceled.",
    rejected: "You rejected this proposal.",
    failed: "Payment failed.",
    blocked: "This proposal was blocked. Nothing was charged.",
  };
  useEffect(() => {
    if (highlighted) element.current?.scrollIntoView({ block: "nearest" });
  }, [highlighted, Boolean(proposal)]);
  return (
    <div
      ref={element}
      tabIndex={-1}
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
            {proposal.status in finalSummary && (
              <p>
                {finalSummary[proposal.status as keyof typeof finalSummary]}
              </p>
            )}
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
            {note && <p role="status">{note}</p>}
            {proposal.status === "needs_approval" && (
              <div ref={review}>
                <Button
                  disabled={working}
                  onClick={() => {
                    setDecisionError(undefined);
                    approval.open(instance, id);
                  }}
                >
                  Review and decide
                </Button>
              </div>
            )}
            {proposal.status === "awaiting_buyer" &&
              (proposal.payment?.approveUrl ? (
                <Button onClick={pay}>Pay with PayPal</Button>
              ) : (
                <p>Waiting for the payment link.</p>
              ))}
            {paymentError && proposal.status === "awaiting_buyer" && (
              <p role="alert">{paymentError}</p>
            )}
            {approval.active === instance && (
              <ApprovalDialog
                proposal={proposal}
                working={working}
                error={decisionError}
                onClose={() => approval.close(instance)}
                onDecision={(action) => void decide(action)}
                returnFocus={() => {
                  (
                    review.current?.querySelector<HTMLButtonElement>(
                      "button",
                    ) ?? element.current
                  )?.focus();
                }}
              />
            )}
            {failures >= 3 && (
              <small role="status">
                Proposal updates are temporarily unavailable. Retrying
                automatically.
              </small>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
