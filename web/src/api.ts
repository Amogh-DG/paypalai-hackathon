import type {
  Mandate,
  MandateInput,
  MandateView,
  Proposal,
} from "@leash/shared";

export type ApiError = { code: string; message: string };
export type ChatInput = { sessionId?: string; message: string };
export type ChatResponse = {
  sessionId: string;
  reply: string;
  proposalIds: string[];
  toolTrace: { tool: string; summary: string }[];
};

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = (await response.json()) as { error: ApiError };
    throw { code: payload.error.code, message: payload.error.message };
  }
  return (await response.json()) as T;
}

export const getMandateView = (): Promise<MandateView> =>
  request("GET", "/api/mandate");
export const postMandate = (input: MandateInput): Promise<Mandate> =>
  request("POST", "/api/mandate", input);
export const postChat = (input: ChatInput): Promise<ChatResponse> =>
  request("POST", "/api/chat", input);
export const getProposal = (id: string): Promise<Proposal> =>
  request("GET", `/api/proposals/${encodeURIComponent(id)}`);

export const postDecision = (id: string, action: "approve" | "reject"): Promise<Proposal> =>
  request("POST", `/api/proposals/${encodeURIComponent(id)}/decision`, { action });
