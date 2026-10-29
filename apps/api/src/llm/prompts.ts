import type { LangfuseClient } from '@langfuse/client';
import type { BasePromptValueInterface } from '@langchain/core/prompt_values';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  /** Langfuse syntax: variables are written as {{name}}. */
  content: string;
}

/**
 * A prompt as it lives in the repo. Each variant is pushed to Langfuse as a
 * version carrying the variant's name as a label (`v1`, `v2`), and the
 * production variant also gets Langfuse's `production` label.
 */
export interface PromptDefinition {
  name: string;
  productionVariant: string;
  variants: Record<string, PromptMessage[]>;
}

export type PromptRunnable = Runnable<Record<string, unknown>, BasePromptValueInterface>;

export interface LoadedPrompt {
  template: PromptRunnable;
  name: string;
  label: string;
  /** Where the text came from, for example `langfuse:3` or `repo:v1`. */
  source: string;
}

/** Turns Langfuse's {{name}} variables into LangChain's {name}. */
function toLangchainTemplate(messages: PromptMessage[]): ChatPromptTemplate {
  return ChatPromptTemplate.fromMessages(
    messages.map((m) => [m.role, m.content.replace(/\{\{\s*(\w+)\s*\}\}/g, '{$1}')]),
  );
}

export function repoVariant(definition: PromptDefinition, label: string): PromptMessage[] {
  const variant = label === 'production' ? definition.productionVariant : label;
  const messages = definition.variants[variant];
  if (!messages) {
    throw new Error(`Prompt "${definition.name}" has no variant "${variant}"`);
  }
  return messages;
}

/**
 * Fetches a chat prompt by label from Langfuse Prompt Management, falling back
 * to the repo copy when Langfuse is not configured or unreachable.
 *
 * When the prompt really came from Langfuse, it is attached to the template as
 * `langfusePrompt` metadata. The Langfuse callback handler reads that and links
 * each generation to the prompt version, so Langfuse can chart latency, cost
 * and scores per prompt version.
 */
export async function loadChatPrompt(
  langfuse: LangfuseClient | null,
  definition: PromptDefinition,
  label: string,
): Promise<LoadedPrompt> {
  const fallback = repoVariant(definition, label);

  if (!langfuse) {
    return {
      template: toLangchainTemplate(fallback),
      name: definition.name,
      label,
      source: `repo:${label}`,
    };
  }

  const prompt = await langfuse.prompt.get(definition.name, {
    type: 'chat',
    label,
    fallback,
    cacheTtlSeconds: 60,
  });
  const messages = prompt.getLangchainPrompt() as Array<{ role: string; content: string }>;
  const template = ChatPromptTemplate.fromMessages(
    messages.map((m) => [m.role, m.content] as [string, string]),
  );
  return {
    template: prompt.isFallback ? template : template.withConfig({ metadata: { langfusePrompt: prompt } }),
    name: definition.name,
    label,
    source: prompt.isFallback ? `repo:${label}` : `langfuse:${prompt.version}`,
  };
}
