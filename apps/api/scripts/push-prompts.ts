/**
 * Pushes the prompts kept in the repo to Langfuse Prompt Management.
 *
 * Each variant becomes a Langfuse prompt version labelled with the variant's
 * name (v1, v2, ...). The production variant also gets the `production` label,
 * which is what the running app asks for. Unchanged variants are skipped, so
 * running this twice does not create duplicate versions.
 *
 *   pnpm prompts:push
 */
import '../src/load-env.js';
import { LangfuseClient } from '@langfuse/client';
import type { PromptDefinition, PromptMessage } from '../src/llm/prompts.js';
import { INSIGHTS_SUMMARY_PROMPT } from '../src/insights/insights.prompt.js';
import { MODERATOR_PROMPTS } from '../src/interviews/moderator/moderator.prompts.js';
import { BRIEF_EXPANSION_PROMPT } from '../src/questionnaires/brief-expansion.prompt.js';

const PROMPTS: PromptDefinition[] = [
  BRIEF_EXPANSION_PROMPT,
  ...MODERATOR_PROMPTS,
  INSIGHTS_SUMMARY_PROMPT,
];

if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
  console.error('Set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY in the root .env first.');
  process.exit(1);
}

const langfuse = new LangfuseClient();

function sameMessages(a: Array<{ role?: string; content?: string }>, b: PromptMessage[]): boolean {
  const plain = (list: Array<{ role?: string; content?: string }>) =>
    JSON.stringify(list.map(({ role, content }) => ({ role, content })));
  return plain(a) === plain(b);
}

async function currentVersion(name: string, label: string) {
  try {
    return await langfuse.prompt.get(name, { type: 'chat', label, cacheTtlSeconds: 0 });
  } catch {
    return null;
  }
}

for (const definition of PROMPTS) {
  for (const [variant, messages] of Object.entries(definition.variants)) {
    const labels =
      variant === definition.productionVariant ? [variant, 'production'] : [variant];
    const existing = await currentVersion(definition.name, variant);

    if (existing && sameMessages(existing.prompt as Array<{ role?: string; content?: string }>, messages)) {
      const missing = labels.filter((label) => !existing.labels.includes(label));
      if (missing.length > 0) {
        await langfuse.prompt.update({
          name: definition.name,
          version: existing.version,
          newLabels: [...existing.labels, ...missing],
        });
        console.log(`${definition.name} ${variant}: unchanged, added labels ${missing.join(', ')}`);
      } else {
        console.log(`${definition.name} ${variant}: unchanged (version ${existing.version})`);
      }
      continue;
    }

    const created = await langfuse.prompt.create({
      name: definition.name,
      type: 'chat',
      prompt: messages,
      labels,
    });
    console.log(`${definition.name} ${variant}: created version ${created.version} [${labels.join(', ')}]`);
  }
}
