import { ChatAnthropic } from '@langchain/anthropic';
import { BRIEF_EXPANSION_PROMPT } from './brief-expansion.prompt.js';
import { createBriefExpansionChain } from './brief-expansion.chain.js';
import { loadChatPrompt } from '../llm/prompts.js';

const brief = 'Why are parents switching infant formula brands? UK mothers 25 to 40.';

const draft = (questionCount: number) => ({
  title: 'Infant formula switching',
  audience: 'UK mothers aged 25 to 40',
  topics: ['reasons for switching', 'information sources', 'price'],
  questions: Array.from({ length: questionCount }, (_, i) => ({
    text: `Tell me about the moment number ${i + 1} you thought about changing formula.`,
    goal: `Find trigger ${i + 1}`,
  })),
});

/** The shape the Messages API returns: an (empty) thinking block, then the JSON text. */
const apiResponse = (body: unknown) => ({
  id: 'msg_test',
  type: 'message',
  role: 'assistant',
  model: 'claude-opus-5-5',
  content: [
    { type: 'thinking', thinking: '', signature: 'sig' },
    { type: 'text', text: JSON.stringify(body) },
  ],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: { input_tokens: 420, output_tokens: 380 },
});

/**
 * A real ChatAnthropic whose HTTP client is replaced by a stub, so the test
 * covers LangChain's request building and output parsing without a network
 * call or an API key.
 */
function modelReturning(...bodies: unknown[]) {
  const requests: Array<Record<string, unknown>> = [];
  const create = vi.fn(async (request: Record<string, unknown>) => {
    requests.push(request);
    return apiResponse(bodies[Math.min(requests.length - 1, bodies.length - 1)]);
  });
  const model = new ChatAnthropic({
    model: 'claude-opus-5-5',
    maxTokens: 16_000,
    outputConfig: { effort: 'medium' },
    createClient: () => ({ messages: { create }, beta: { messages: { create } } }),
  });
  return { model, requests };
}

async function chainWith(model: ChatAnthropic) {
  const prompt = await loadChatPrompt(null, BRIEF_EXPANSION_PROMPT, 'production');
  return createBriefExpansionChain(prompt.template, model);
}

describe('brief expansion chain', () => {
  it('returns a parsed questionnaire when the model answers with valid JSON', async () => {
    const { model } = modelReturning(draft(7));
    const result = await (await chainWith(model)).invoke({ brief });
    expect(result.questions).toHaveLength(7);
    expect(result.audience).toBe('UK mothers aged 25 to 40');
  });

  it('uses native structured output, not a forced tool call', async () => {
    const { model, requests } = modelReturning(draft(6));
    await (await chainWith(model)).invoke({ brief });

    const request = requests[0]!;
    // A forced tool_choice gets a 400 while thinking is on, so neither may be sent.
    expect(request.tool_choice).toBeUndefined();
    expect(request.tools).toBeUndefined();
    const outputConfig = request.output_config as {
      effort: string;
      format: { type: string; schema: { properties: Record<string, unknown> } };
    };
    expect(outputConfig.effort).toBe('medium');
    expect(outputConfig.format.type).toBe('json_schema');
    expect(Object.keys(outputConfig.format.schema.properties)).toEqual([
      'title',
      'audience',
      'topics',
      'questions',
    ]);
  });

  it('renders the brief into the user message', async () => {
    const { model, requests } = modelReturning(draft(6));
    await (await chainWith(model)).invoke({ brief });

    const messages = requests[0]!.messages as Array<{ role: string; content: unknown }>;
    expect(JSON.stringify(messages.at(-1))).toContain('UK mothers 25 to 40');
    expect(JSON.stringify(requests[0]!.system)).toContain('between 6 and 10 questions');
  });

  it('asks again once when the answer breaks a rule the API cannot enforce', async () => {
    // Five questions is valid JSON for the schema's shape but fails zod's min(6).
    const { model, requests } = modelReturning(draft(5), draft(8));
    const result = await (await chainWith(model)).invoke({ brief });
    expect(requests).toHaveLength(2);
    expect(result.questions).toHaveLength(8);
  });

  it('gives up after the retry and surfaces the validation error', async () => {
    const { model, requests } = modelReturning(draft(11));
    await expect((await chainWith(model)).invoke({ brief })).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
});
