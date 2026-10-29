import { ChatAnthropic } from '@langchain/anthropic';

/** What the stubbed model returns when asked to draft a questionnaire. */
export const generatedQuestionnaire = {
  title: 'Infant formula switching',
  audience: 'UK mothers aged 25 to 40',
  topics: ['reasons for switching', 'information sources'],
  questions: Array.from({ length: 6 }, (_, i) => ({
    text: `What happened the ${i + 1}th time you looked at a different formula brand?`,
    goal: `Understand switching moment ${i + 1}`,
  })),
};

/** Stands in for ChatModelFactory: a real ChatAnthropic with a stubbed HTTP client. */
export const stubModelFactory = {
  modelName: 'claude-opus-5-5',
  create: () =>
    new ChatAnthropic({
      model: 'claude-opus-5-5',
      createClient: () => ({
        messages: {
          create: async () => ({
            id: 'msg_test',
            type: 'message',
            role: 'assistant',
            model: 'claude-opus-5-5',
            content: [{ type: 'text', text: JSON.stringify(generatedQuestionnaire) }],
            stop_reason: 'end_turn',
            stop_sequence: null,
            usage: { input_tokens: 400, output_tokens: 300 },
          }),
        },
      }),
    }),
};
