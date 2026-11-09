import type { GenerateInput, LlmClient, ModelResponse } from "./llm.js";
import { AppError } from "../http/errors.js";

export class FakeLlmClient implements LlmClient {
  readonly inputs: GenerateInput[] = [];
  private readonly responses: ModelResponse[];

  constructor(responses: ModelResponse[]) {
    this.responses = structuredClone(responses);
  }

  async generate(input: GenerateInput): Promise<ModelResponse> {
    this.inputs.push(structuredClone(input));
    const response = this.responses.shift();
    if (!response)
      throw new AppError("internal_error", "Fake LLM response queue is empty.");
    return response;
  }
}
