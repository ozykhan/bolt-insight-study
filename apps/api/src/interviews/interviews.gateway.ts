import { HttpException, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
} from '@nestjs/websockets';
import { ThrottlerStorage } from '@nestjs/throttler';
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
import { clientIp } from '../common/client-ip.js';
import { RATE_LIMITS } from '../common/rate-limits.js';
import type { Env } from '../config/env.js';
import { LlmNotConfiguredError } from '../llm/chat-model.js';
import { InterviewsService, type InterviewEmitter } from './interviews.service.js';

interface SocketData {
  distinctId: string;
  /** The client's IP, worked out once at the handshake, for rate limits. */
  ip: string;
}

type InterviewSocket = Socket<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

/**
 * The respondent's chat connection. In Nest a gateway is a provider like a
 * service: `@SubscribeMessage` maps an event to a method, the method's
 * return value goes back as the Socket.io acknowledgement, and services come
 * in through the constructor. Each interview gets a room named after its id,
 * so a respondent with two tabs open sees the same conversation in both.
 *
 * Rate limits are checked here rather than in a guard, so a client over its
 * limit gets an Ack it can show instead of an exception it never hears about.
 * They share @nestjs/throttler's storage with the HTTP limits.
 */
@WebSocketGateway({ namespace: INTERVIEW_NAMESPACE })
export class InterviewsGateway implements OnGatewayConnection, InterviewEmitter {
  private readonly logger = new Logger(InterviewsGateway.name);

  @WebSocketServer()
  private readonly server!: Namespace<ClientToServerEvents, ServerToClientEvents, never, SocketData>;

  constructor(
    private readonly interviews: InterviewsService,
    @Inject(ThrottlerStorage) private readonly throttler: ThrottlerStorage,
    private readonly config: ConfigService<Env, true>,
  ) {}

  handleConnection(socket: InterviewSocket): void {
    const { distinctId } = socket.handshake.auth as Partial<InterviewSocketAuth>;
    if (typeof distinctId !== 'string' || !distinctId || distinctId.length > 200) {
      socket.disconnect(true);
      return;
    }
    socket.data.distinctId = distinctId;
    socket.data.ip = clientIp(
      socket.handshake.headers,
      socket.handshake.address,
      this.config.get('CLIENT_IP_HEADER', { infer: true }),
    );
  }

  @SubscribeMessage('interview:join')
  async join(
    @ConnectedSocket() socket: InterviewSocket,
    @MessageBody() body: unknown,
  ): Promise<Ack<InterviewSessionDto>> {
    const parsed = JoinInterviewSchema.safeParse(body);
    if (!parsed.success) return { ok: false, error: 'This study link is not valid.' };
    if (await this.overLimit(socket, 'joinInterview')) {
      return { ok: false, error: 'Too many interviews from your network. Try again in a few minutes.' };
    }
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
    if (await this.overLimit(socket, 'answer')) {
      return { ok: false, error: 'That is a lot of answers in a short time. Wait a minute and try again.' };
    }
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

  /** Counts one event for the socket's IP and says whether it went over the limit. */
  private async overLimit(socket: InterviewSocket, event: 'joinInterview' | 'answer'): Promise<boolean> {
    const { limit, ttl } = RATE_LIMITS[event];
    // A block duration of 0 lets the client back in as soon as its oldest
    // event leaves the window, instead of locking it out for a fixed time.
    const { isBlocked } = await this.throttler.increment(`ws:${event}:${socket.data.ip}`, ttl, limit, 0, event);
    return isBlocked;
  }

  private fail(error: unknown): Ack<never> {
    if (error instanceof HttpException || error instanceof LlmNotConfiguredError) {
      return { ok: false, error: error.message };
    }
    this.logger.error('Interview event failed', error);
    return { ok: false, error: 'Something went wrong. Try again.' };
  }
}
