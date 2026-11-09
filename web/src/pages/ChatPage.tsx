import { useEffect } from "react";
import { Card } from "../components/Card";
import { useProposalParam } from "../hooks/useProposalParam";

export function ChatPage() {
  const proposal = useProposalParam();
  useEffect(() => {
    console.log(proposal);
  }, [proposal]);
  return (
    <Card>
      <h2>Chat</h2>
      <p>Chat page — coming in B-07</p>
    </Card>
  );
}
