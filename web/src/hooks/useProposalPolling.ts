import { useCallback, useEffect, useState } from "react";
import { FINAL_STATUSES, type Proposal } from "@leash/shared";
import { getProposal, type ApiError } from "../api";

export function useProposalPolling(id: string) {
  const [state, setState] = useState<{
    id: string;
    proposal?: Proposal;
    error?: ApiError;
    failures: number;
  }>({ id, failures: 0 });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    let active = true;
    let busy = false;
    let final = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setState((previous) =>
      previous.id === id ? previous : { id, failures: 0 },
    );
    const refresh = async () => {
      if (!active || busy || final || document.hidden) return;
      busy = true;
      try {
        const proposal = await getProposal(id);
        if (!active) return;
        final = FINAL_STATUSES.includes(proposal.status);
        setState({ id, proposal, failures: 0 });
      } catch (error: unknown) {
        if (!active) return;
        const apiError =
          typeof error === "object" && error !== null && "message" in error
            ? {
                code: "code" in error ? String(error.code) : "unknown",
                message: String(error.message),
              }
            : { code: "unknown", message: "Unable to load proposal." };
        setState((previous) => ({
          ...previous,
          id,
          error: apiError,
          failures: previous.failures + 1,
        }));
      } finally {
        busy = false;
        if (active && !final && !document.hidden)
          timer = setTimeout(() => void refresh(), 2000);
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", visibility);
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [id, attempt]);
  return { ...(state.id === id ? state : { id, failures: 0 }), retry };
}
