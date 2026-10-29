import type { ChatAnthropic } from '@langchain/anthropic';
import type { PromptRunnable } from '../../llm/prompts.js';
import type { ModeratorChains } from './moderator.graph.js';
import { DecisionSchema } from './moderator.state.js';

export interface ModeratorChainParts {
  prompts: { decide: PromptRunnable; followUp: PromptRunnable; bridge: PromptRunnable };
  /** Used for the decide step: structured output, never shown to the respondent. */
  decideModel: ChatAnthropic;
  /** Used for the bridge and follow-up lines the respondent sees. */
  speakModel: ChatAnthropic;
}

/**
 * The same LangChain pieces as brief expansion: a prompt piped into a model.
 * Speaking chains return the model's message, and when the graph runs with
 * `streamMode: "messages"` LangGraph streams their tokens out as they arrive,
 * with no streaming code here.
 */
export function createModeratorChains({
  prompts,
  decideModel,
  speakModel,
}: ModeratorChainParts): ModeratorChains {
  return {
    decide: prompts.decide
      .pipe(decideModel.withStructuredOutput(DecisionSchema, { method: 'jsonSchema' }))
      .withRetry({ stopAfterAttempt: 2 }),
    followUp: prompts.followUp.pipe(speakModel),
    bridge: prompts.bridge.pipe(speakModel),
  };
}
