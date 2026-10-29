import { HttpException, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import {
  AnswerSchema,
  INTERVIEW_NAMESPACE,
  JoinInterviewSchema,
  type Ack,
  type ClientToServerEvents,
  type InterviewMessageDto,
  type InterviewProgress,
  type InterviewSessionDto,
  type InterviewSocketAuth,
  type ServerToClientEvents,
} from '@probe-lab/shared';
import { LlmNotConfiguredError } from '../llm/chat-model.js';
import { InterviewsService, type InterviewEmitter } from './interviews.service.js';

interface SocketData {
  distinctId: string;
}

type InterviewSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/**
 * The respondent's chat connection. In Nest a gateway is a provider like a
 * service: `@SubscribeMessage` maps an event to a method, the method's
 * return value goes back as the Socket.io acknowledgement, and services come
 * in through the constructor. Each interview gets a room named after its id,
 * so a respondent with two tabs open sees the same conversation in both.
 */
@WebSocketGateway({ namespace: INTERVIEW_NAMESPACE })
export class InterviewsGateway implements OnGatewayConnection, InterviewEmitter {
  private readonly logger = new Logger(InterviewsGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

  constructor(private readonly interviews: InterviewsService) {}

  handleConnection(socket: InterviewSocket): void {
    const { distinctId } = socket.handshake.auth as Partial<InterviewSocketAuth>;
    if (typeof distinctId !== 'string' || !distinctId || distinctId.length > 200) {
      socket.disconnect(true);
      return;
    }
    socket.data.distinctId = distinctId;
  }

  @SubscribeMessage('interview:join')
  async join(
    @ConnectedSocket() socket: InterviewSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<InterviewSessionDto>> {
    const parsed = JoinInterviewSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'This study link is not valid.' };
    try {
      const session = await this.interviews.openSession(parsed.data.studyId, socket.data.distinctId);
      await socket.join(session.interviewId);
      if (session.status === 'in_progress') {
        void this.interviews.continueInterview(session.interviewId, this);
      }
      return { ok: true, data: session };
    } catch (error) {
      return this.fail(error);
    }
  }

  @SubscribeMessage('interview:answer')
  async answer(
    @ConnectedSocket() socket: InterviewSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<InterviewMessageDto>> {
    const parsed = AnswerSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'Write an answer of up to 2000 characters.' };
    try {
      const { interviewId, text } = parsed.data;
      const message = await this.interviews.answer(interviewId, socket.data.distinctId, text, this);
      // The sender gets its message in the acknowledgement; other tabs get it here.
      socket.to(interviewId).emit('moderator:done', { message });
      return { ok: true, data: message };
    } catch (error) {
      return this.fail(error);
    }
  }

  delta(interviewId: string, delta: string): void {
    this.server.to(interviewId).emit('moderator:delta', { delta });
  }

  done(interviewId: string, message: InterviewMessageDto): void {
    this.server.to(interviewId).emit('moderator:done', { message });
  }

  progress(interviewId: string, progress: InterviewProgress): void {
    this.server.to(interviewId).emit('interview:progress', progress);
  }

  completed(interviewId: string): void {
    this.server.to(interviewId).emit('interview:completed', { interviewId });
  }

  error(interviewId: string, message: string): void {
    this.server.to(interviewId).emit('interview:error', { message });
  }

  private fail(error: unknown): Ack<never> {
    if (error instanceof HttpException || error instanceof LlmNotConfiguredError) {
      return { ok: false, error: error.message };
    }
    this.logger.error('Interview event failed', error);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}
