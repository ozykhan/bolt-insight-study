import type { ChatAnthropic } from '@langchain/anthropic';
import type { Runnable } from '@langchain/core/runnables';
import { InsightsDraftSchema, type InsightsDraft } from '@probe-lab/shared';
import type { PromptRunnable } from '../llm/prompts.js';

export type InsightsInput = {
  studyTitle: string;
  brief: string;
  interviewCount: number;
  answers: string;
};

/**
 * prompt | model-with-structured-output, retried once if the reply breaks a
 * zod rule. The same shape as the brief expansion chain. The quotes it
 * returns are checked against the real answers afterwards, in code.
 */
export function createInsightsChain(
  prompt: PromptRunnable,
  model: ChatAnthropic,
): Runnable<InsightsInput, InsightsDraft> {
  return prompt
    .pipe(model.withStructuredOutput(InsightsDraftSchema, { method: 'jsonSchema' }))
    .withRetry({ stopAfterAttempt: 2 });
}
