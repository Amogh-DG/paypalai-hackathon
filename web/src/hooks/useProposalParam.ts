import { useSearchParams } from "react-router-dom";

export function useProposalParam(): string | null {
  const [params] = useSearchParams();
  return params.get("proposal");
}
