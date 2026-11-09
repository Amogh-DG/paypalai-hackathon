import type { ChatResponse } from "../api";
import { ProposalCard } from "./ProposalCard";

export type TranscriptMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  proposalIds?: string[];
  toolTrace?: ChatResponse["toolTrace"];
};

export function ChatMessage({
  message,
  highlightedId,
}: {
  message: TranscriptMessage;
  highlightedId: string | null;
}) {
  return (
    <article style={{ paddingBlock: 16, overflowWrap: "anywhere" }}>
      <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
      <div style={{ whiteSpace: "pre-wrap", marginTop: 8 }}>{message.text}</div>
      {!!message.toolTrace?.length && (
        <details
          style={{ marginTop: 12, color: "var(--color-text-secondary)" }}
        >
          <summary>Tool activity</summary>
          <ul>
            {message.toolTrace.map((entry, index) => (
              <li key={index}>{entry.summary}</li>
            ))}
          </ul>
        </details>
      )}
      {message.proposalIds?.map((id) => (
        <ProposalCard key={id} id={id} highlighted={id === highlightedId} />
      ))}
    </article>
  );
}
