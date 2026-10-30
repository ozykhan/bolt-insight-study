import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  INTERVIEW_NAMESPACE,
  type ClientToServerEvents,
  type InterviewMessageDto,
  type InterviewProgress,
  type InterviewSocketAuth,
  type InterviewStatus,
  type ServerToClientEvents,
} from '@probe-lab/shared';
import { distinctId } from '../lib/analytics';
import { API_URL } from '../lib/api';

type InterviewSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export interface InterviewView {
  connected: boolean;
  interviewId: string | null;
  studyTitle: string | null;
  status: InterviewStatus | null;
  progress: InterviewProgress | null;
  messages: InterviewMessageDto[];
  /** The moderator's reply while it streams, or null when nothing is streaming. */
  draft: string | null;
  error: string | null;
  canAnswer: boolean;
  sending: boolean;
  send: (text: string) => Promise<boolean>;
  retry: () => void;
}

/** Adds or replaces messages by id and keeps them in interview order. */
function merge(current: InterviewMessageDto[], incoming: InterviewMessageDto[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * The respondent's side of the interview. The socket is typed with the same
 * event maps as the Nest gateway, so `emitWithAck('interview:answer', ...)`
 * knows its payload and its acknowledgement.
 */
export function useInterview(studyId: string): InterviewView {
  const socketRef = useRef<InterviewSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [interviewId, setInterviewId] = useState<string | null>(null);
  const [studyTitle, setStudyTitle] = useState<string | null>(null);
  const [status, setStatus] = useState<InterviewStatus | null>(null);
  const [progress, setProgress] = useState<InterviewProgress | null>(null);
  const [messages, setMessages] = useState<InterviewMessageDto[]>([]);
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const join = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    setError(null);
    const result = await socket.emitWithAck('interview:join', { studyId });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const session = result.data;
    setInterviewId(session.interviewId);
    setStudyTitle(session.studyTitle);
    setStatus(session.status);
    setProgress(session.progress);
    setMessages((current) => merge(current, session.messages));
  }, [studyId]);

  useEffect(() => {
    const auth: InterviewSocketAuth = { distinctId: distinctId() };
    const socket: InterviewSocket = io(`${API_URL}${INTERVIEW_NAMESPACE}`, { auth });
    socketRef.current = socket;

    // Joining on every connect also rejoins the room after a reconnect.
    socket.on('connect', () => {
      setConnected(true);
      void join();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('moderator:delta', ({ delta }) => setDraft((text) => (text ?? '') + delta));
    socket.on('moderator:done', ({ message }) => {
      setMessages((current) => merge(current, [message]));
      if (message.role === 'moderator') setDraft(null);
    });
    socket.on('interview:progress', setProgress);
    socket.on('interview:completed', () => setStatus('completed'));
    socket.on('interview:error', ({ message }) => {
      setDraft(null);
      setError(message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [join]);

  const last = messages.at(-1);
  const canAnswer =
    connected &&
    status === 'in_progress' &&
    !sending &&
    draft === null &&
    last?.role === 'moderator' &&
    last.kind !== 'closing';

  const send = useCallback(
    async (text: string) => {
      const socket = socketRef.current;
      if (!socket || !interviewId) return false;
      setSending(true);
      setError(null);
      try {
        const result = await socket.timeout(10_000).emitWithAck('interview:answer', { interviewId, text });
        if (!result.ok) {
          setError(result.error);
          return false;
        }
        setMessages((current) => merge(current, [result.data]));
        return true;
      } catch {
        setError('The answer did not reach the server. Check your connection and try again.');
        return false;
      } finally {
        setSending(false);
      }
    },
    [interviewId],
  );

  return {
    connected,
    interviewId,
    studyTitle,
    status,
    progress,
    messages,
    draft,
    error,
    canAnswer,
    sending,
    send,
    retry: () => void join(),
  };
}
