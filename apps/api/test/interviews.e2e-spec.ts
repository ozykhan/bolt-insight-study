import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { BaseMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import type { AddressInfo } from 'node:net';
import type { Connection } from 'mongoose';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import {
  INTERVIEW_NAMESPACE,
  type ClientToServerEvents,
  type InterviewMessageDto,
  type InterviewProgress,
  type ServerToClientEvents,
} from '@probe-lab/shared';
import { AppModule } from '../src/app.module.js';
import { ModeratorChainsFactory } from '../src/interviews/moderator-chains.factory.js';
import type {
  BridgeInput,
  DecideInput,
  FollowUpInput,
  ModeratorChains,
} from '../src/interviews/moderator/moderator.graph.js';
import type { Decision } from '../src/interviews/moderator/moderator.state.js';
import { ChatModelFactory } from '../src/llm/llm.providers.js';
import { generatedQuestionnaire, stubModelFactory } from './stubs.js';

const BRIDGE = 'Thanks for sharing that.';
const FOLLOW_UP = 'What made that stand out for you?';

/**
 * Scripted moderator: decide reads the respondent's last line ("stop" ends,
 * "more" asks a follow-up), and the speaking chains use LangChain's fake chat
 * model, which streams its reply token by token like the real one.
 */
const scriptedChainsFactory = {
  create: async () => {
    const chains: ModeratorChains = {
      decide: RunnableLambda.from(async (input: DecideInput): Promise<Decision> => {
        const last = input.thread.split('\n').at(-1)?.toLowerCase() ?? '';
        const action = last.includes('stop') ? 'end' : last.includes('more') ? 'follow_up' : 'next';
        return { action, reason: 'scripted' };
      }),
      followUp: RunnableLambda.from((input: FollowUpInput) => input.thread).pipe(
        new FakeListChatModel({ responses: [FOLLOW_UP] }),
      ),
      bridge: RunnableLambda.from((input: BridgeInput) => input.nextQuestion).pipe(
        new FakeListChatModel({ responses: [BRIDGE] }),
      ),
    };
    return { chains, promptSources: ['scripted'] };
  },
};

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A respondent's browser: a socket plus everything the server sent it. */
function respondent(url: string, distinctId: string) {
  const socket: ClientSocket = io(`${url}${INTERVIEW_NAMESPACE}`, {
    auth: { distinctId },
    transports: ['websocket'],
    forceNew: true,
  });
  const seen = {
    deltas: [] as string[],
    done: [] as InterviewMessageDto[],
    progress: [] as InterviewProgress[],
    completed: [] as string[],
    errors: [] as string[],
  };
  socket.on('moderator:delta', ({ delta }) => seen.deltas.push(delta));
  socket.on('moderator:done', ({ message }) => seen.done.push(message));
  socket.on('interview:progress', (progress) => seen.progress.push(progress));
  socket.on('interview:completed', ({ interviewId }) => seen.completed.push(interviewId));
  socket.on('interview:error', ({ message }) => seen.errors.push(message));
  return { socket, seen };
}

describe('Interviews over Socket.io (e2e)', () => {
  let app: INestApplication;
  let url: string;
  const sockets: ClientSocket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelFactory)
      .useValue(stubModelFactory)
      .overrideProvider(ModeratorChainsFactory)
      .useValue(scriptedChainsFactory)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  function connect(distinctId: string) {
    const browser = respondent(url, distinctId);
    sockets.push(browser.socket);
    return browser;
  }

  async function liveStudy(): Promise<string> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/studies')
      .send({ brief: 'Why are parents switching infant formula brands? UK mothers 25 to 40.' })
      .expect(201);
    const studyId: string = created.body.study.id;
    await request(server).post(`/api/studies/${studyId}/questionnaire/generate`).expect(200);
    await request(server).post(`/api/studies/${studyId}/launch`).expect(200);
    return studyId;
  }

  it('runs an interview from the first question to the closing message', async () => {
    const studyId = await liveStudy();
    const { socket, seen } = connect('respondent-1');
    const questions = generatedQuestionnaire.questions;

    const joined = await socket.emitWithAck('interview:join', { studyId });
    if (!joined.ok) throw new Error(joined.error);
    expect(joined.data).toMatchObject({
      studyTitle: 'Infant formula switching',
      status: 'in_progress',
      progress: { questionIndex: 0, total: 6 },
    });
    const interviewId = joined.data.interviewId;

    // The graph starts on its own after the join and pauses on question 1.
    await vi.waitFor(() => expect(seen.done).toHaveLength(1));
    expect(seen.done[0]).toMatchObject({ seq: 1, role: 'moderator', kind: 'question', questionKey: 'q1' });
    expect(seen.done[0]!.content).toMatch(/^Hi, and thank you for taking part\./);
    expect(seen.done[0]!.content.endsWith(questions[0]!.text)).toBe(true);

    const first = await socket.emitWithAck('interview:answer', { interviewId, text: 'By the price, mostly.' });
    expect(first).toMatchObject({ ok: true, data: { seq: 2, role: 'respondent', questionKey: 'q1', followUpIndex: 0 } });

    // "next": a streamed bridge, then question 2 word for word.
    await vi.waitFor(() => expect(seen.done).toHaveLength(2));
    expect(seen.done[1]).toMatchObject({ kind: 'question', questionKey: 'q2', content: `${BRIDGE}\n\n${questions[1]!.text}` });
    expect(seen.deltas.length).toBeGreaterThan(1);
    expect(seen.deltas.join('')).toBe(BRIDGE);
    expect(seen.progress.at(-1)).toEqual({ questionIndex: 1, total: 6 });

    // "more": a follow-up on the same question.
    await socket.emitWithAck('interview:answer', { interviewId, text: 'There is more to it, honestly.' });
    await vi.waitFor(() => expect(seen.done).toHaveLength(3));
    expect(seen.done[2]).toMatchObject({ kind: 'follow_up', questionKey: 'q2', followUpIndex: 1, content: FOLLOW_UP });

    // "stop": the moderator closes the interview.
    const last = await socket.emitWithAck('interview:answer', { interviewId, text: 'Can we stop here please?' });
    expect(last).toMatchObject({ ok: true, data: { questionKey: 'q2', followUpIndex: 1 } });
    await vi.waitFor(() => expect(seen.completed).toEqual([interviewId]));
    expect(seen.done.at(-1)).toMatchObject({ kind: 'closing', questionKey: null });
    expect(seen.errors).toEqual([]);

    // Reopening the link in the same browser shows the finished transcript.
    const again = connect('respondent-1');
    const rejoined = await again.socket.emitWithAck('interview:join', { studyId });
    if (!rejoined.ok) throw new Error(rejoined.error);
    expect(rejoined.data.interviewId).toBe(interviewId);
    expect(rejoined.data.status).toBe('completed');
    expect(rejoined.data.messages.map((m) => [m.seq, m.role, m.kind])).toEqual([
      [1, 'moderator', 'question'],
      [2, 'respondent', 'answer'],
      [3, 'moderator', 'question'],
      [4, 'respondent', 'answer'],
      [5, 'moderator', 'follow_up'],
      [6, 'respondent', 'answer'],
      [7, 'moderator', 'closing'],
    ]);

    const late = await again.socket.emitWithAck('interview:answer', { interviewId, text: 'One more thing' });
    expect(late).toEqual({ ok: false, error: 'This interview is already finished.' });
  });

  it('gives a second respondent their own interview', async () => {
    const studyId = await liveStudy();
    const one = connect('respondent-a');
    const two = connect('respondent-b');

    const [a, b] = await Promise.all([
      one.socket.emitWithAck('interview:join', { studyId }),
      two.socket.emitWithAck('interview:join', { studyId }),
    ]);

    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.data.interviewId).not.toBe(b.data.interviewId);
  });

  it('turns away answers the moderator is not waiting for, and bad input', async () => {
    const studyId = await liveStudy();
    const { socket, seen } = connect('respondent-2');
    const joined = await socket.emitWithAck('interview:join', { studyId });
    if (!joined.ok) throw new Error(joined.error);
    await vi.waitFor(() => expect(seen.done).toHaveLength(1));

    const empty = await socket.emitWithAck('interview:answer', { interviewId: joined.data.interviewId, text: '   ' });
    expect(empty.ok).toBe(false);

    const stranger = connect('someone-else');
    const hijack = await stranger.socket.emitWithAck('interview:answer', { interviewId: joined.data.interviewId, text: 'Hello' });
    expect(hijack).toEqual({ ok: false, error: 'Interview not found' });
  });

  it('refuses interviews for a study that is not live', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/studies')
      .send({ brief: 'What stops people from trying plant-based yoghurt? UK adults 18 to 35.' })
      .expect(201);
    const { socket } = connect('respondent-3');

    const result = await socket.emitWithAck('interview:join', { studyId: created.body.study.id });

    expect(result).toEqual({ ok: false, error: 'This study is not taking interviews right now.' });
  });
});
