import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { Proposal } from "@leash/shared";
import { formatUsd } from "../format";
import { Button } from "./Button";
import { RuleList } from "./RuleList";
import "../dialog.css";

const ApprovalContext = createContext<{
  active: string | null;
  open: (key: string, id: string, automatic?: boolean) => void;
  close: (key: string) => void;
} | null>(null);

export function ApprovalProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  const seen = useRef(new Set<string>());
  return (
    <ApprovalContext.Provider
      value={{
        active,
        open: (key, id, automatic = false) => {
          if (activeRef.current !== null || (automatic && seen.current.has(id)))
            return;
          seen.current.add(id);
          activeRef.current = key;
          setActive(key);
        },
        close: (key) => {
          if (activeRef.current !== key) return;
          activeRef.current = null;
          setActive(null);
        },
      }}
    >
      {children}
    </ApprovalContext.Provider>
  );
}

export function useApprovalCoordinator() {
  const context = useContext(ApprovalContext);
  if (!context) throw new Error("ApprovalProvider is required.");
  return context;
}

export function ApprovalDialog({
  proposal,
  working,
  error,
  onClose,
  onDecision,
  returnFocus,
}: {
  proposal: Proposal;
  working: boolean;
  error?: string;
  onClose: () => void;
  onDecision: (action: "approve" | "reject") => void;
  returnFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const restore = useRef(returnFocus);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      node?.close();
      restore.current();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="approval-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          dialog.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), summary, [tabindex='0']",
          ) ?? [],
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="approval-header">
        <h2 id={titleId}>Review proposal</h2>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </header>
      <ul>
        {proposal.items.map((item, index) => (
          <li key={`${item.productId}-${index}`}>
            <strong>{item.title}</strong>
            <div>{item.merchant}</div>
            <div>
              {item.quantity} × {formatUsd(item.unitPrice)}
            </div>
          </li>
        ))}
      </ul>
      <p>
        <strong>Total: {formatUsd(proposal.total)}</strong>
      </p>
      <p>
        <strong>Ship to: {proposal.shipTo.name}</strong>
        <br />
        {[
          proposal.shipTo.line1,
          proposal.shipTo.city,
          proposal.shipTo.region,
          proposal.shipTo.postalCode,
          proposal.shipTo.country,
        ].join(", ")}
      </p>
      <RuleList rules={proposal.policy.results} />
      {error && <p role="alert">{error}</p>}
      {working && <p role="status">Saving decision…</p>}
      <footer className="approval-actions">
        <Button disabled={working} onClick={() => onDecision("approve")}>
          Approve
        </Button>
        <Button
          variant="secondary"
          disabled={working}
          onClick={() => onDecision("reject")}
        >
          Reject
        </Button>
      </footer>
    </dialog>,
    document.body,
  );
}
