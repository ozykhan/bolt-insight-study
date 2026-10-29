import { MAX_FOLLOW_UPS } from '@probe-lab/shared';
import { createModeratorChains } from '../src/interviews/moderator/moderator.chains.js';
import { formatThread } from '../src/interviews/moderator/moderator.graph.js';
import {
  MODERATOR_BRIDGE_PROMPT,
  MODERATOR_DECIDE_PROMPT,
  MODERATOR_FOLLOW_UP_PROMPT,
} from '../src/interviews/moderator/moderator.prompts.js';
import type { Decision } from '../src/interviews/moderator/moderator.state.js';
import { loadChatPrompt } from '../src/llm/prompts.js';
import { score, type EvalSuite, type SuiteEvaluator } from './harness.js';
import { createJudges, type Judges } from './judges.js';
import { MODERATOR_ITEMS, type ModeratorExpected, type ModeratorInput } from './moderator.dataset.js';

export interface ModeratorOutput {
  decision: Decision;
  /** Written for items where a follow-up is the right move, whatever the decision said, so every run scores the same items. */
  followUp: string | null;
}

type Evaluator = SuiteEvaluator<ModeratorInput, ModeratorExpected, ModeratorOutput>;

export function decisionScore(output: ModeratorOutput, expected: ModeratorExpected) {
  const { action, reason } = output.decision;
  return score(
    'decision_correct',
    action === expected.action ? 1 : 0,
    `Expected ${expected.action}, got ${action}: ${reason}`,
  );
}

/** One question, and short: a chat follow-up with two questions in it is hard to answer. */
export function singleQuestionScore(followUp: string) {
  const questionMarks = (followUp.match(/\?/g) ?? []).length;
  const words = followUp.trim().split(/\s+/).length;
  const ok = questionMarks === 1 && words <= 30;
  return score('follow_up_single_question', ok ? 1 : 0, `${questionMarks} question mark(s), ${words} words.`);
}

export function moderatorEvaluators(judges: Judges, judgeConfig: () => object): Evaluator[] {
  return [
    async ({ output, expectedOutput }) => [decisionScore(output, expectedOutput)],
    async ({ input, output }) => {
      if (output.followUp === null) return [];
      const verdict = await judges.followUp.invoke(
        {
          question: input.question.text,
          goal: input.question.goal,
          thread: formatThread(input.turns),
          followUp: output.followUp,
        },
        { ...judgeConfig(), runName: 'judge-follow-up' },
      );
      return [
        score('follow_up_grounded', verdict.grounded ? 1 : 0, verdict.groundedReason),
        score('follow_up_non_leading', verdict.leading ? 0 : 1, verdict.leadingReason),
        singleQuestionScore(output.followUp),
      ];
    },
  ];
}

/**
 * Runs the moderator's decide and follow-up chains (the same ones the graph
 * uses, with the same thread formatting) on scripted moments of an
 * interview, without the graph or a database around them.
 */
export const moderatorSuite: EvalSuite<ModeratorInput, ModeratorExpected, ModeratorOutput> = {
  name: 'moderator',
  dataset: 'moderator',
  description:
    'Twelve scripted interview moments. Scores the decision after an answer, and whether follow-ups are grounded, non-leading and a single question.',
  items: MODERATOR_ITEMS,
  scores: [
    { name: 'follow_up_grounded', label: 'Follow-ups grounded in the answer', description: 'Follow-up picks up something specific the respondent said.' },
    { name: 'follow_up_non_leading', label: 'Follow-ups not leading', description: 'Follow-up does not suggest an answer or assume feelings.' },
    { name: 'follow_up_single_question', label: 'Follow-ups a single short question', description: 'Exactly one question mark and at most 30 words.' },
    { name: 'decision_correct', label: 'Decision matches the label', description: 'follow_up, next or end, as labelled by hand. Its prompt is the same in v1 and v2.' },
  ],

  async prepare({ variant, langfuse, model, judgeCallbacks }) {
    const [decide, followUp, bridge] = await Promise.all([
      loadChatPrompt(langfuse, MODERATOR_DECIDE_PROMPT, variant),
      loadChatPrompt(langfuse, MODERATOR_FOLLOW_UP_PROMPT, variant),
      loadChatPrompt(langfuse, MODERATOR_BRIDGE_PROMPT, 'production'),
    ]);
    // Same effort as the running app.
    const chains = createModeratorChains({
      prompts: { decide: decide.template, followUp: followUp.template, bridge: bridge.template },
      decideModel: model('low'),
      speakModel: model('low'),
    });
    const judges = createJudges(model('medium'));

    return {
      task: async ({ input, expectedOutput }, callbacks) => {
        const question = input.question.text;
        const goal = input.question.goal;
        const thread = formatThread(input.turns);
        const config = { callbacks, runName: 'moderator-eval' };
        const [decision, reply] = await Promise.all([
          chains.decide.invoke(
            { question, goal, thread, followUps: input.followUps, maxFollowUps: MAX_FOLLOW_UPS },
            config,
          ),
          expectedOutput.action === 'follow_up'
            ? chains.followUp.invoke({ question, goal, thread }, config)
            : null,
        ]);
        return { decision, followUp: reply ? reply.text.trim() : null };
      },
      evaluators: moderatorEvaluators(judges, () => ({ callbacks: judgeCallbacks() })),
      promptSources: [decide, followUp].map((p) => `${p.name}@${p.source}`),
    };
  },
};
