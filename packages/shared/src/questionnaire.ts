import { z } from 'zod';

/** The brief expansion must produce between 6 and 10 questions. */
export const QUESTION_COUNT = { min: 6, max: 10 } as const;

/** Clients can trim or extend a questionnaire, within looser limits. */
export const EDITED_QUESTION_COUNT = { min: 1, max: 15 } as const;

const questionText = z
  .string()
  .min(10)
  .max(400)
  .describe('One open question, worded exactly as the moderator will ask it');

const questionGoal = z
  .string()
  .min(5)
  .max(400)
  .describe('One sentence on what the researcher wants to learn from this question');

/**
 * What the model returns when it expands a brief. Passed to LangChain's
 * `withStructuredOutput`, so the `.describe()` texts end up in the JSON schema
 * the model sees.
 */
export const QuestionnaireDraftSchema = z.object({
  title: z.string().min(3).max(120).describe('Short working title for the study'),
  audience: z
    .string()
    .min(3)
    .max(300)
    .describe('Who will be interviewed, restated from the brief'),
  topics: z
    .array(z.string().min(2).max(120))
    .min(2)
    .max(8)
    .describe('The topics from the brief that the questions must cover'),
  questions: z
    .array(z.object({ text: questionText, goal: questionGoal }))
    .min(QUESTION_COUNT.min)
    .max(QUESTION_COUNT.max)
    .describe('Open questions in the order they should be asked'),
});
export type QuestionnaireDraft = z.infer<typeof QuestionnaireDraftSchema>;

/** Stable key so answers keep pointing at the right question across edits. */
export const QuestionKeySchema = z.string().regex(/^q\d+$/);

export const QuestionSchema = z.object({
  key: QuestionKeySchema,
  text: questionText,
  goal: questionGoal,
});
export type Question = z.infer<typeof QuestionSchema>;

/** Body of `PUT /studies/:id/questionnaire`, sent by the editor. */
export const QuestionnaireUpdateSchema = z.object({
  title: z.string().trim().min(3).max(120),
  audience: z.string().trim().min(3).max(300),
  topics: z.array(z.string().trim().min(2).max(120)).max(8),
  questions: z
    .array(
      z.object({
        key: QuestionKeySchema.optional(),
        text: z.string().trim().min(10).max(400),
        goal: z.string().trim().min(5).max(400),
      }),
    )
    .min(EDITED_QUESTION_COUNT.min)
    .max(EDITED_QUESTION_COUNT.max),
});
export type QuestionnaireUpdate = z.infer<typeof QuestionnaireUpdateSchema>;

/**
 * Gives every question a key. Existing keys are kept, so reordering or
 * rewording a question does not break the link to answers already given.
 * New questions get the next free number.
 */
export function assignQuestionKeys(
  questions: ReadonlyArray<{ key?: string; text: string; goal: string }>,
): Question[] {
  const used = new Set<string>();
  let highest = 0;
  for (const q of questions) {
    if (q.key && !used.has(q.key)) {
      used.add(q.key);
      highest = Math.max(highest, Number(q.key.slice(1)));
    }
  }

  const seen = new Set<string>();
  return questions.map((q) => {
    let key = q.key;
    if (!key || seen.has(key)) {
      highest += 1;
      key = `q${highest}`;
    }
    seen.add(key);
    return { key, text: q.text, goal: q.goal };
  });
}
