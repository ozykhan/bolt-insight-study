import type { QuestionnaireDraft } from '@probe-lab/shared';
import { loadChatPrompt } from '../src/llm/prompts.js';
import { createBriefExpansionChain } from '../src/questionnaires/brief-expansion.chain.js';
import { BRIEF_EXPANSION_PROMPT } from '../src/questionnaires/brief-expansion.prompt.js';
import { BRIEF_ITEMS, type BriefExpected, type BriefInput } from './brief-expansion.dataset.js';
import { score, type EvalSuite, type SuiteEvaluator } from './harness.js';
import {
  createJudges,
  numberedQuestions,
  type CoverageVerdict,
  type Judges,
  type QuestionsVerdict,
} from './judges.js';

type Evaluator = SuiteEvaluator<BriefInput, BriefExpected, QuestionnaireDraft>;

/** Share of questions the judge did not flag as leading. */
export function nonLeadingScore(draft: QuestionnaireDraft, verdict: QuestionsVerdict) {
  const leading = verdict.questions.filter(
    (q) => q.leading && q.number >= 1 && q.number <= draft.questions.length,
  );
  const comment = leading.length
    ? leading.map((q) => `Q${q.number}: ${q.reason}`).join(' ')
    : 'No leading questions.';
  return score('questions_non_leading', 1 - leading.length / draft.questions.length, comment);
}

/** Share of questions that do not repeat an earlier one. The later question of each duplicate pair counts against it. */
export function distinctScore(draft: QuestionnaireDraft, verdict: QuestionsVerdict) {
  const valid = (n: number) => n >= 1 && n <= draft.questions.length;
  const pairs = verdict.duplicates.filter((d) => valid(d.first) && valid(d.second) && d.first !== d.second);
  const repeated = new Set(pairs.map((d) => Math.max(d.first, d.second)));
  const comment = pairs.length
    ? pairs.map((d) => `Q${d.first} and Q${d.second}: ${d.reason}`).join(' ')
    : 'No duplicates.';
  return score('questions_distinct', 1 - repeated.size / draft.questions.length, comment);
}

/** Share of the hand-written topics that at least one question covers. */
export function coverageScore(expected: BriefExpected, verdict: CoverageVerdict) {
  const covered = new Set(verdict.topics.filter((t) => t.covered).map((t) => t.number));
  const missed = expected.topics.filter((_, i) => !covered.has(i + 1));
  const comment = missed.length ? `Missed: ${missed.join('; ')}.` : 'Every topic covered.';
  return score('topic_coverage', (expected.topics.length - missed.length) / expected.topics.length, comment);
}

export function briefExpansionEvaluators(judges: Judges, judgeConfig: () => object): Evaluator[] {
  return [
    async ({ input, output }) => {
      const verdict = await judges.questions.invoke(
        { brief: input.brief, questions: numberedQuestions(output.questions) },
        { ...judgeConfig(), runName: 'judge-questions' },
      );
      return [nonLeadingScore(output, verdict), distinctScore(output, verdict)];
    },
    async ({ input, output, expectedOutput }) => {
      const verdict = await judges.coverage.invoke(
        {
          brief: input.brief,
          topics: expectedOutput.topics.map((topic, i) => `${i + 1}. ${topic}`).join('\n'),
          questions: numberedQuestions(output.questions),
        },
        { ...judgeConfig(), runName: 'judge-coverage' },
      );
      return [coverageScore(expectedOutput, verdict)];
    },
  ];
}

/**
 * Runs the real brief expansion chain (same prompt loading, model settings
 * and structured output as the API) on each brief, then scores the
 * questionnaire with two judge calls.
 */
export const briefExpansionSuite: EvalSuite<BriefInput, BriefExpected, QuestionnaireDraft> = {
  name: 'brief-expansion',
  dataset: 'brief-expansion',
  description: 'Ten research briefs. Scores the drafted questionnaire for leading questions, duplicates and topic coverage.',
  items: BRIEF_ITEMS,
  scores: [
    { name: 'questions_non_leading', label: 'Questions not leading', description: 'Share of questions the judge did not flag as leading.' },
    { name: 'questions_distinct', label: 'Questions not duplicated', description: 'Share of questions that do not repeat an earlier one.' },
    { name: 'topic_coverage', label: 'Brief topics covered', description: 'Share of the hand-written topics that at least one question covers.' },
  ],

  async prepare({ variant, langfuse, model, judgeCallbacks }) {
    const prompt = await loadChatPrompt(langfuse, BRIEF_EXPANSION_PROMPT, variant);
    const chain = createBriefExpansionChain(prompt.template, model('medium'));
    const judges = createJudges(model('medium'));
    return {
      task: (item, callbacks) =>
        chain.invoke(item.input, { callbacks, runName: 'brief-expansion' }),
      evaluators: briefExpansionEvaluators(judges, () => ({ callbacks: judgeCallbacks() })),
      promptSources: [`${prompt.name}@${prompt.source}`],
    };
  },
};
