import { z } from 'zod';

/** The moderator asks at most this many follow-ups per question. Code enforces it, not the prompt. */
export const MAX_FOLLOW_UPS = 2;

/** PostHog feature flag that picks the moderator prompt version per respondent. */
export const MODERATOR_PROMPT_FLAG = 'moderator-prompt-version';
export const PROMPT_VERSIONS = ['v1', 'v2'] as const;
export type PromptVersion = (typeof PROMPT_VERSIONS)[number];

export const INTERVIEW_STATUSES = ['in_progress', 'completed', 'abandoned'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export const MESSAGE_ROLES = ['moderator', 'respondent'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_KINDS = ['question', 'follow_up', 'closing', 'answer'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export interface InterviewMessageDto {
  id: string;
  /** Position in the interview, starting at 1. */
  seq: number;
  role: MessageRole;
  kind: MessageKind;
  /** The questionnaire question this message belongs to; null for the closing message. */
  questionKey: string | null;
  /** 0 for the main question and its answer, 1 or 2 for follow-ups and their answers. */
  followUpIndex: number;
  content: string;
  createdAt: string;
}

export interface InterviewProgress {
  /** Index of the question being asked, starting at 0. */
  questionIndex: number;
  total: number;
}

export interface InterviewSessionDto {
  interviewId: string;
  studyTitle: string;
  status: InterviewStatus;
  progress: InterviewProgress;
  messages: InterviewMessageDto[];
}

const ObjectIdString = z.string().regex(/^[a-f\d]{24}$/i, 'Expected an id');

export const JoinInterviewSchema = z.object({ studyId: ObjectIdString });
export type JoinInterviewPayload = z.infer<typeof JoinInterviewSchema>;

export const AnswerSchema = z.object({
  interviewId: ObjectIdString,
  text: z.string().trim().min(1).max(2000),
});
export type AnswerPayload = z.infer<typeof AnswerSchema>;

/** Socket.io acknowledgement: the reply the server sends to one emitted event. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: string };

/** Socket.io namespace for interviews. One room per interview id. */
export const INTERVIEW_NAMESPACE = '/interview';

/** Sent in the Socket.io handshake (`io(url, { auth })`). */
export interface InterviewSocketAuth {
  /** The respondent's PostHog distinct id, so browser and server events share one person. */
  distinctId: string;
}

/**
 * Socket.io event maps. Both the Nest gateway and the React client pass these
 * to Socket.io's generics, so an event name or payload that does not match is
 * a compile error on both sides.
 */
export interface ClientToServerEvents {
  'interview:join': (
    payload: JoinInterviewPayload,
    ack: (result: Ack<InterviewSessionDto>) => void,
  ) => void;
  'interview:answer': (
    payload: AnswerPayload,
    ack: (result: Ack<InterviewMessageDto>) => void,
  ) => void;
}

export interface ServerToClientEvents {
  /** A chunk of the moderator's reply while it streams. */
  'moderator:delta': (payload: { delta: string }) => void;
  /** The moderator's reply as saved, which replaces the streamed draft. */
  'moderator:done': (payload: { message: InterviewMessageDto }) => void;
  'interview:progress': (payload: InterviewProgress) => void;
  'interview:completed': (payload: { interviewId: string }) => void;
  'interview:error': (payload: { message: string }) => void;
}
