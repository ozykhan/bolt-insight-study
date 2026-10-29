import type { ChatAnthropic } from '@langchain/anthropic';
import type { Runnable } from '@langchain/core/runnables';
import { QuestionnaireDraftSchema, type QuestionnaireDraft } from '@probe-lab/shared';
import type { PromptRunnable } from '../llm/prompts.js';

// A type alias, not an interface: prompt runnables take Record<string, unknown>,
// and only type aliases are assignable to an index signature.
export type BriefExpansionInput = { brief: string };

/**
 * prompt | model-with-structured-output, retried once.
 *
 * `method: 'jsonSchema'` makes LangChain use Claude's native structured
 * outputs (`output_config.format`). The default method fakes it with a forced
 * tool call, which the API rejects while thinking is on.
 *
 * The API guarantees valid JSON in the schema's shape, but not every zod rule
 * (6 to 10 questions, string lengths). Zod checks those after the call, and
 * `withRetry` asks again once if the check fails.
 */
export function createBriefExpansionChain(
  prompt: PromptRunnable,
  model: ChatAnthropic,
): Runnable<BriefExpansionInput, QuestionnaireDraft> {
  const structuredModel = model.withStructuredOutput(QuestionnaireDraftSchema, {
    method: 'jsonSchema',
  });
  // Name the run at invoke time, not with .withConfig() here: calling
  // .withConfig() on the retry wrapper rebuilds it with the default of 3
  // attempts (found by the "gives up after the retry" test).
  return prompt.pipe(structuredModel).withRetry({ stopAfterAttempt: 2 });
}
