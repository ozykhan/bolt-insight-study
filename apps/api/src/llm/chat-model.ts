import { ChatAnthropic } from '@langchain/anthropic';

/**
 * The configured model always thinks; effort is the only dial for how much.
 * Low keeps chat turns quick, medium suits one-off generation.
 */
export type Effort = 'low' | 'medium' | 'high';

export interface ChatModelOptions {
  apiKey: string | undefined;
  model: string;
  effort: Effort;
  streaming?: boolean;
  maxTokens?: number;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set. Add it to the .env file at the repo root.');
  }
}

/**
 * Plain function so eval scripts can build the same model the API uses
 * without booting Nest.
 */
export function createChatModel(options: ChatModelOptions): ChatAnthropic {
  if (!options.apiKey) {
    throw new LlmNotConfiguredError();
  }
  return new ChatAnthropic({
    model: options.model,
    apiKey: options.apiKey,
    // Non-streaming calls with a huge max_tokens trip the SDK's long-request
    // guard, so cap them at a size that still leaves room for thinking.
    maxTokens: options.maxTokens ?? 16_000,
    streaming: options.streaming ?? false,
    outputConfig: { effort: options.effort },
  });
}
