import type { MessageKind, MessageRole, Question } from '@probe-lab/shared';
import type { AnswerRef } from './quote-check.js';

export interface TranscriptMessage {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  questionKey: string | null;
  followUpIndex: number;
  content: string;
}

export interface Transcript {
  interviewId: string;
  /** In interview order. */
  messages: TranscriptMessage[];
}

export interface FormattedAnswers {
  /** Every answer, grouped by question, each labelled with a reference such as `A12`. */
  text: string;
  /** Reference to answer, for checking the model's quotes. */
  answers: Map<string, AnswerRef>;
}

/** One line per answer, so newlines inside an answer are folded into spaces. */
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Lays out a study's answers for the summary prompt: question by question,
 * respondent by respondent, with the follow-up an answer replies to. Each
 * answer gets a short reference (`A1`, `A2`, ...) because the model copies a
 * short label more reliably than a database id; the returned map turns the
 * references back into message ids.
 */
export function formatAnswers(questions: Question[], transcripts: Transcript[]): FormattedAnswers {
  const answers = new Map<string, AnswerRef>();
  const sections: string[] = [];

  const known = new Set(questions.map((q) => q.key));
  const groups: Array<{ heading: string[]; key: string | null }> = questions.map((q, i) => ({
    heading: [`Q${i + 1}. ${oneLine(q.text)}`, `Goal: ${oneLine(q.goal)}`],
    key: q.key,
  }));
  const hasStray = transcripts.some((t) =>
    t.messages.some((m) => m.role === 'respondent' && !known.has(m.questionKey ?? '')),
  );
  if (hasStray) groups.push({ heading: ['Other answers'], key: null });

  for (const group of groups) {
    const lines = [...group.heading];
    transcripts.forEach((transcript, index) => {
      const respondent = `Respondent ${index + 1}`;
      const belongs = (m: TranscriptMessage) =>
        group.key === null ? !known.has(m.questionKey ?? '') : m.questionKey === group.key;

      for (const message of transcript.messages) {
        if (message.role !== 'respondent' || !belongs(message)) continue;
        const ref = `A${answers.size + 1}`;
        answers.set(ref, {
          messageId: message.id,
          interviewId: transcript.interviewId,
          questionKey: message.questionKey,
          content: message.content,
        });
        const followUp =
          message.followUpIndex > 0
            ? transcript.messages.find(
                (m) =>
                  m.kind === 'follow_up' &&
                  m.questionKey === message.questionKey &&
                  m.followUpIndex === message.followUpIndex,
              )
            : undefined;
        const context = followUp ? `, asked "${oneLine(followUp.content)}"` : '';
        lines.push(`[${ref}] ${respondent}${context}: ${oneLine(message.content)}`);
      }
    });
    if (lines.length === group.heading.length) lines.push('(no answers)');
    sections.push(lines.join('\n'));
  }

  return { text: sections.join('\n\n'), answers };
}
