export async function runAgent(
  sessionId: string,
  message: string,
): Promise<{
  reply: string;
  proposalIds: string[];
  toolTrace: { tool: string; summary: string }[];
}> {
  return {
    reply: `Echo: ${message} (session: ${sessionId})`,
    proposalIds: [],
    toolTrace: [],
  };
}
