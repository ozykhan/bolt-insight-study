import type { InterviewMessageDto, InterviewProgress, Question } from '@probe-lab/shared';
import type { InterviewMessageDocument } from './interview-message.schema.js';

export function toMessageDto(message: InterviewMessageDocument): InterviewMessageDto {
  return {
    id: message.id,
    seq: message.seq,
    role: message.role,
    kind: message.kind,
    questionKey: message.questionKey,
    followUpIndex: message.followUpIndex,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}

/** Which question the interview is on, from the last question the moderator asked. */
export function progressOf(
  questions: Question[],
  messages: Array<Pick<InterviewMessageDto, 'kind' | 'questionKey'>>,
): InterviewProgress {
  const lastAsked = messages.findLast((message) => message.kind === 'question');
  const index = questions.findIndex((question) => question.key === lastAsked?.questionKey);
  return { questionIndex: Math.max(index, 0), total: questions.length };
}
