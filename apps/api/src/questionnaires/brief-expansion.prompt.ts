import type { PromptDefinition } from '../llm/prompts.js';

const v1System = `You are a senior qualitative researcher. A brand has sent you a short research brief. Turn it into a discussion guide for a one-to-one interview that an AI moderator will run in a text chat.

Rules for the guide:
- Write between 6 and 10 questions, in the order they should be asked. Start broad and easy, go deeper in the middle, and finish with a forward-looking question.
- Every question is open. A respondent cannot answer it with yes, no or a single word.
- Ask about one thing per question.
- Do not lead the respondent. Never suggest an answer, assume how they feel, or praise a brand or product.
- Cover every topic in the brief, and do not ask two questions that would get the same answer.
- Use plain, friendly words that the audience in the brief would use themselves.
- Give each question a goal: one sentence on what the researcher wants to learn from it.
- Restate the audience, and list the topics you took from the brief.`;

export const BRIEF_EXPANSION_PROMPT: PromptDefinition = {
  name: 'brief-expansion',
  productionVariant: 'v1',
  variants: {
    v1: [
      { role: 'system', content: v1System },
      { role: 'user', content: 'Research brief:\n{{brief}}' },
    ],
  },
};
