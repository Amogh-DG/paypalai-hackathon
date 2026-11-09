import { getLlmClient, type LlmClient, type LlmMessage } from "./llm.js";
import { getSystemPrompt } from "./prompts.js";
import { executeTool, toolDeclarations } from "./tools.js";

const sessions = new Map<string, LlmMessage[]>();

export async function runAgent(
  sessionId: string,
  message: string,
): Promise<{
  reply: string;
  proposalIds: string[];
  toolTrace: { tool: string; summary: string }[];
}> {
  return runAgentWith(getLlmClient(), sessionId, message);
}

export async function runAgentWith(
  client: LlmClient,
  sessionId: string,
  message: string,
): Promise<{
  reply: string;
  proposalIds: string[];
  toolTrace: { tool: string; summary: string }[];
}> {
  const messages = sessions.get(sessionId) ?? [];
  sessions.set(sessionId, messages);
  messages.push({ role: "user", text: message });
  const proposalIds: string[] = [];
  const toolTrace: { tool: string; summary: string }[] = [];
  const systemInstruction = getSystemPrompt();

  for (let step = 0; step < 8; step += 1) {
    const response = await client.generate({
      messages,
      tools: toolDeclarations,
      systemInstruction,
    });
    messages.push({ role: "model", response });
    if (response.type === "text") {
      return { reply: response.text, proposalIds, toolTrace };
    }
    const results: Extract<LlmMessage, { role: "tool" }>["results"] = [];
    for (const call of response.calls) {
      const outcome = await executeTool(call);
      results.push({
        ...(call.id === undefined ? {} : { id: call.id }),
        name: call.name,
        result: outcome.result,
      });
      toolTrace.push({ tool: call.name, summary: outcome.summary });
      if (outcome.proposalId !== undefined)
        proposalIds.push(outcome.proposalId);
    }
    messages.push({ role: "tool", results });
  }

  const reply =
    "I could not complete your request because the step limit was reached.";
  messages.push({ role: "model", response: { type: "text", text: reply } });
  return { reply, proposalIds, toolTrace };
}
