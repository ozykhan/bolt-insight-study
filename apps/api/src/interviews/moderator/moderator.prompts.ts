import type { PromptDefinition, PromptMessage } from '../../llm/prompts.js';

/**
 * The moderator's prompts. The PostHog flag `moderator-prompt-version` picks
 * `v1` or `v2` of the decide and follow-up prompts for each respondent.
 * The bridge prompt only has one version.
 *
 * v2 changes one thing from v1: the follow-up prompt gains a rule to build
 * on something specific the respondent said, in their own words. The decide
 * prompt is the same in both, which makes the decision score a check on how
 * much the eval numbers move between runs by chance alone.
 */

const thread = `Question: {{question}}
Goal of the question: {{goal}}

Conversation on this question so far:
{{thread}}`;

const decideV1: PromptMessage[] = [
  {
    role: 'system',
    content: `You are moderating a one-to-one research interview in a text chat. The respondent has just answered. Decide what happens next.

- follow_up: the answer is vague or very short, or it mentions something specific that is worth exploring for the goal of the question.
- next: the answer already serves the goal of the question, or the respondent has nothing more to add.
- end: the respondent asks to stop, or clearly does not want to continue.

Follow-ups already asked on this question: {{followUps}} of at most {{maxFollowUps}}. When the goal is met, prefer next.
Give the action and a one-sentence reason.`,
  },
  { role: 'user', content: thread },
];

const followUpRulesV1 = `Rules:
- Ask exactly one short, open question.
- Do not suggest an answer, assume how they feel, or judge what they said.
- Stay within the goal of the current question.
- Use plain, warm words, and do not open with praise such as "Great answer".`;

const followUpRulesV2 = followUpRulesV1.replace(
  '- Ask exactly one short, open question.',
  `- Ask exactly one short, open question.
- Build it on one specific thing the respondent said, and use their own words for it.`,
);

const followUpPrompt = (rules: string): PromptMessage[] => [
  {
    role: 'system',
    content: `You are a neutral, friendly moderator of a one-to-one research interview in a text chat. Write one follow-up question about the respondent's last answer.

${rules}

Reply with the follow-up question only.`,
  },
  { role: 'user', content: thread },
];

const followUpV1 = followUpPrompt(followUpRulesV1);
const followUpV2 = followUpPrompt(followUpRulesV2);

export const MODERATOR_DECIDE_PROMPT: PromptDefinition = {
  name: 'moderator-decide',
  productionVariant: 'v1',
  variants: { v1: decideV1, v2: decideV1 },
};

export const MODERATOR_FOLLOW_UP_PROMPT: PromptDefinition = {
  name: 'moderator-follow-up',
  productionVariant: 'v1',
  variants: { v1: followUpV1, v2: followUpV2 },
};

export const MODERATOR_BRIDGE_PROMPT: PromptDefinition = {
  name: 'moderator-bridge',
  productionVariant: 'v1',
  variants: {
    v1: [
      {
        role: 'system',
        content: `You are a neutral, friendly moderator of a one-to-one research interview in a text chat. The respondent has finished one question and the next question comes after your sentence.

Write one short sentence that acknowledges their last answer without judging it and leads into the next question.
- Do not ask a question yourself. The next question is added after your sentence, word for word.
- Do not praise the answer or repeat it back at length.

Reply with the sentence only.`,
      },
      {
        role: 'user',
        content: `Their last answer:
{{lastAnswer}}

Next question:
{{nextQuestion}}`,
      },
    ],
  },
};

export const MODERATOR_PROMPTS = [
  MODERATOR_DECIDE_PROMPT,
  MODERATOR_FOLLOW_UP_PROMPT,
  MODERATOR_BRIDGE_PROMPT,
];
