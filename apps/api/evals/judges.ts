import type { ChatAnthropic } from '@langchain/anthropic';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import type { Runnable } from '@langchain/core/runnables';
import { z } from 'zod';

/**
 * LLM-as-judge prompts. They are the measuring stick, so they live in code
 * and stay the same between the v1 and v2 runs; only the prompt under test
 * changes. Each judge returns structured verdicts with a reason, and the
 * evaluators turn those into 0 to 1 scores in code.
 */

export const QuestionsVerdictSchema = z.object({
  questions: z
    .array(
      z.object({
        number: z.number().int().describe('The question number as listed, starting at 1'),
        leading: z.boolean().describe('True if the question is leading, as defined in the instructions'),
        reason: z.string().describe('One short sentence explaining the verdict'),
      }),
    )
    .describe('One verdict per question, in order'),
  duplicates: z
    .array(
      z.object({
        first: z.number().int().describe('The earlier question number'),
        second: z.number().int().describe('The later question number'),
        reason: z.string().describe('One short sentence on why they overlap'),
      }),
    )
    .describe('Pairs of questions a respondent would answer in the same way. Empty if there are none'),
});
export type QuestionsVerdict = z.infer<typeof QuestionsVerdictSchema>;

export const CoverageVerdictSchema = z.object({
  topics: z
    .array(
      z.object({
        number: z.number().int().describe('The topic number as listed, starting at 1'),
        covered: z.boolean().describe('True if at least one question would get the respondent talking about it'),
        questions: z.array(z.number().int()).describe('The numbers of the questions that cover it'),
      }),
    )
    .describe('One verdict per topic, in order'),
});
export type CoverageVerdict = z.infer<typeof CoverageVerdictSchema>;

export const FollowUpVerdictSchema = z.object({
  grounded: z.boolean().describe('True if the follow-up builds on something specific from the last answer'),
  groundedReason: z.string().describe('One short sentence explaining the grounded verdict'),
  leading: z.boolean().describe('True if the follow-up is leading, as defined in the instructions'),
  leadingReason: z.string().describe('One short sentence explaining the leading verdict'),
});
export type FollowUpVerdict = z.infer<typeof FollowUpVerdictSchema>;

const LEADING = `A question is leading if it suggests or presumes an answer, assumes how the respondent feels or behaves, uses a loaded or flattering word about a product or brand, or pushes the respondent towards agreeing.`;

const questionsPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You review discussion guides for qualitative research interviews. Judge each question on its own wording, strictly and consistently.

${LEADING} A neutral open question is not leading even if its topic is sensitive.

Two questions are duplicates if a typical respondent would give essentially the same answer to both. Questions on related but different aspects are not duplicates.`,
  ],
  ['user', 'Research brief:\n{brief}\n\nQuestions:\n{questions}'],
]);

const coveragePrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You review discussion guides for qualitative research interviews. For each topic the researcher must cover, decide whether at least one question would get a respondent talking about it. A question covers a topic if answering it naturally leads there, even without naming the topic. Judge only the questions, not the goals.`,
  ],
  ['user', 'Research brief:\n{brief}\n\nTopics to cover:\n{topics}\n\nQuestions:\n{questions}'],
]);

const followUpPrompt = ChatPromptTemplate.fromMessages([
  [
    'system',
    `You review follow-up questions written by an AI moderator in a one-to-one research interview.

Grounded: the follow-up picks up something specific from the respondent's last answer, such as a word, a detail, a person or an event they mentioned. A generic probe that would fit any answer, such as "Can you tell me more?", is not grounded.

${LEADING}`,
  ],
  [
    'user',
    'Interview question: {question}\nGoal of the question: {goal}\n\nConversation so far:\n{thread}\n\nFollow-up to judge:\n{followUp}',
  ],
]);

export interface Judges {
  questions: Runnable<{ brief: string; questions: string }, QuestionsVerdict>;
  coverage: Runnable<{ brief: string; topics: string; questions: string }, CoverageVerdict>;
  followUp: Runnable<
    { question: string; goal: string; thread: string; followUp: string },
    FollowUpVerdict
  >;
}

/** Same pattern as the app's chains: prompt | model with JSON schema output, retried once. */
export function createJudges(model: ChatAnthropic): Judges {
  const options = { method: 'jsonSchema' } as const;
  return {
    questions: questionsPrompt
      .pipe(model.withStructuredOutput(QuestionsVerdictSchema, options))
      .withRetry({ stopAfterAttempt: 2 }),
    coverage: coveragePrompt
      .pipe(model.withStructuredOutput(CoverageVerdictSchema, options))
      .withRetry({ stopAfterAttempt: 2 }),
    followUp: followUpPrompt
      .pipe(model.withStructuredOutput(FollowUpVerdictSchema, options))
      .withRetry({ stopAfterAttempt: 2 }),
  };
}

/** Numbers the questions the way the judges see them. */
export function numberedQuestions(questions: Array<{ text: string }>): string {
  return questions.map((question, i) => `${i + 1}. ${question.text}`).join('\n');
}
