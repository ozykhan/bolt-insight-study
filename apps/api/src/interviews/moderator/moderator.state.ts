import { ReducedValue, StateSchema } from '@langchain/langgraph';
import { z } from 'zod';
import { MESSAGE_KINDS, MESSAGE_ROLES, QuestionSchema } from '@probe-lab/shared';

/** One line of the interview as the moderator graph sees it. */
export const TurnSchema = z.object({
  role: z.enum(MESSAGE_ROLES),
  kind: z.enum(MESSAGE_KINDS),
  questionKey: z.string().nullable(),
  followUpIndex: z.number().int().min(0),
  content: z.string(),
  /** Respondent turns only: the id of the saved message, so quotes can point back at it. */
  messageId: z.string().optional(),
});
export type Turn = z.infer<typeof TurnSchema>;

/** What the decide step returns after each answer. */
export const DecisionSchema = z.object({
  action: z
    .enum(['follow_up', 'next', 'end'])
    .describe('follow_up: probe this answer; next: move on; end: the respondent wants to stop'),
  reason: z.string().describe('One sentence explaining the choice'),
});
export type Decision = z.infer<typeof DecisionSchema>;

/**
 * The moderator's state, declared once with LangGraph's StateSchema.
 *
 * Plain zod fields keep the last value written. `turns` is a ReducedValue, so
 * a node returns only its new turns and the reducer appends them. The
 * checkpointer saves this whole object after every step, under the
 * interview's id.
 */
export const ModeratorState = new StateSchema({
  studyTitle: z.string(),
  questions: z.array(QuestionSchema).min(1),
  questionIndex: z.number().int().min(0).default(0),
  followUpCount: z.number().int().min(0).default(0),
  turns: new ReducedValue(z.array(TurnSchema).default(() => []), {
    inputSchema: z.array(TurnSchema),
    reducer: (current, next) => [...current, ...next],
  }),
  decision: DecisionSchema.nullable().default(null),
});

export type ModeratorStateValue = typeof ModeratorState.State;
export type ModeratorStateUpdate = typeof ModeratorState.Update;

/** What the graph is waiting for when it pauses: the answer to one question or follow-up. */
export interface AwaitingAnswer {
  questionKey: string;
  followUpIndex: number;
}

/** The value the gateway resumes the graph with, via `new Command({ resume })`. */
export interface AnswerResume {
  messageId: string;
  text: string;
}
