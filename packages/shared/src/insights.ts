import { z } from 'zod';

/**
 * What the model returns when it summarises a study. Every quote names the
 * answer it comes from by the reference shown in the prompt (`A12`), and the
 * API checks each one against that answer before saving it.
 */
export const InsightsDraftSchema = z.object({
  overview: z
    .string()
    .min(20)
    .max(1500)
    .describe('Three to five sentences on what the interviews show overall'),
  themes: z
    .array(
      z.object({
        title: z.string().min(3).max(100).describe('A short name for the theme'),
        summary: z
          .string()
          .min(20)
          .max(800)
          .describe('Two or three sentences on the theme, including how many respondents raised it'),
        quotes: z
          .array(
            z.object({
              ref: z.string().describe('The reference of the answer the quote comes from, such as A12'),
              text: z
                .string()
                .min(3)
                .max(500)
                .describe('Words copied exactly from that answer, with nothing added or left out in the middle'),
            }),
          )
          .min(1)
          .max(4)
          .describe('Quotes that support the theme, each from a different answer where possible'),
      }),
    )
    .min(1)
    .max(6)
    .describe('The main themes, most common first'),
});
export type InsightsDraft = z.infer<typeof InsightsDraftSchema>;

export interface InsightQuoteDto {
  /** The respondent message the quote was taken from. */
  messageId: string;
  interviewId: string;
  questionKey: string | null;
  /** The question the respondent was answering, for context. */
  question: string | null;
  /** The quote exactly as it appears in the answer. */
  text: string;
  /** The whole answer the quote was taken from. */
  answer: string;
}

export interface InsightThemeDto {
  title: string;
  summary: string;
  quotes: InsightQuoteDto[];
}

export interface InsightsSummaryDto {
  id: string;
  overview: string;
  themes: InsightThemeDto[];
  interviewCount: number;
  answerCount: number;
  /** Quotes the model returned that did not match a real answer, so were left out. */
  rejectedQuoteCount: number;
  /** Where the prompt came from, for example `langfuse:2` or `repo:production`. */
  promptSource: string;
  createdAt: string;
}

/** Response of `GET` and `POST /studies/:id/insights`. */
export interface StudyInsightsDto {
  studyId: string;
  interviews: { started: number; completed: number };
  /** The latest summary, or null if none has been generated yet. */
  summary: InsightsSummaryDto | null;
}
