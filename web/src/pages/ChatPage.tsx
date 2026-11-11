import { useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type { Proposal } from "@leash/shared";
import { getProposal, postChat } from "../api";
import { Button } from "../components/Button";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { ChatMessage, type TranscriptMessage } from "../components/ChatMessage";
import { ProposalCard } from "../components/ProposalCard";
import { ApprovalProvider } from "../components/ApprovalDialog";

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const proposal = searchParams.get("proposal");
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const lastMessage = useRef("");
  const busy = useRef(false);
  const nextId = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const scrollEnd = () =>
    requestAnimationFrame(() =>
      transcript.current?.scrollTo({ top: transcript.current.scrollHeight }),
    );
  const send = async (value: string, retry = false) => {
    const message = value.trim();
    if (!message || busy.current) return;
    if (!retry && proposal) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("proposal");
      setSearchParams(nextParams, { replace: true });
    }
    busy.current = true;
    lastMessage.current = message;
    setSending(true);
    setError(undefined);
    if (!retry)
      setMessages((previous) => [
        ...previous,
        { id: nextId.current++, role: "user", text: message },
      ]);
    scrollEnd();
    try {
      const response = await postChat({
        message,
        ...(sessionId === undefined ? {} : { sessionId }),
      });
      const uniqueProposalIds = [...new Set(response.proposalIds)];
      let proposals: Record<string, Proposal> | undefined;
      if (uniqueProposalIds.length > 0) {
        const fetched = await Promise.all(
          uniqueProposalIds.map(async (id) => {
            try {
              const p = await getProposal(id);
              return [id, p] as const;
            } catch {
              return null;
            }
          }),
        );
        proposals = Object.fromEntries(
          fetched.filter(
            (item): item is readonly [string, Proposal] => item !== null,
          ),
        );
      }
      setSessionId(response.sessionId);
      setMessages((previous) => [
        ...previous,
        {
          id: nextId.current++,
          role: "assistant",
          text: response.reply,
          proposalIds: uniqueProposalIds,
          proposals,
          toolTrace: response.toolTrace,
        },
      ]);
      setText("");
    } catch (failure: unknown) {
      const code =
        typeof failure === "object" && failure !== null && "code" in failure
          ? failure.code
          : undefined;
      const message =
        typeof failure === "object" && failure !== null && "message" in failure
          ? String(failure.message)
          : "Unable to send your message.";
      setError(
        code === "model_busy"
          ? "The assistant is busy. Try again in a moment."
          : message,
      );
    } finally {
      busy.current = false;
      setSending(false);
      scrollEnd();
    }
  };
  const linked =
    proposal &&
    !messages.some((message) => message.proposalIds?.includes(proposal));
  return (
    <ApprovalProvider>
      <section
        aria-label="Shopping chat"
        style={{
          height: "calc(100dvh - 130px)",
          minHeight: 350,
          display: "flex",
          flexDirection: "column",
          minWidth: 0,
        }}
      >
        <style>{`.chat-proposals .card { box-shadow: none; }`}</style>
        <h2 style={{ marginTop: 0 }}>Chat</h2>
        <div
          ref={transcript}
          className="chat-proposals"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            overflowX: "hidden",
            paddingRight: 8,
          }}
        >
          {linked && (
            <section aria-label="Linked proposal">
              <h3>Linked proposal</h3>
              <ProposalCard id={proposal} highlighted />
            </section>
          )}
          {messages.length === 0 && (
            <EmptyState message="Ask for a gift, a book or something for the kitchen, and I will stay within your mandate." />
          )}
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              highlightedId={proposal}
            />
          ))}
          {sending && <LoadingState label="Assistant is thinking" />}
          {error && !sending && (
            <ErrorState
              message={error}
              onRetry={() => void send(lastMessage.current, true)}
            />
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(text);
          }}
          style={{
            display: "flex",
            alignItems: "end",
            gap: 12,
            paddingTop: 16,
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <label style={{ flex: 1, minWidth: 0 }}>
            Message
            <textarea
              ref={input}
              value={text}
              disabled={sending}
              maxLength={4000}
              rows={3}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send(text);
                }
              }}
              style={{
                display: "block",
                width: "100%",
                boxSizing: "border-box",
                resize: "none",
                padding: 12,
                color: "var(--color-text-primary)",
                background: "var(--color-bg)",
                border: "1px solid var(--color-border-strong)",
                borderRadius: "var(--radius-sm)",
                font: "inherit",
              }}
            />
          </label>
          <Button
            disabled={sending || !text.trim()}
            onClick={() => void send(text)}
          >
            Send
          </Button>
        </form>
      </section>
    </ApprovalProvider>
  );
}
