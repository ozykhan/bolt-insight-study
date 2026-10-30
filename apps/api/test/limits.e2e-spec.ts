import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { AddressInfo } from 'node:net';
import type { Connection } from 'mongoose';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { INTERVIEW_NAMESPACE, type ClientToServerEvents, type ServerToClientEvents } from '@probe-lab/shared';
import { AppModule } from '../src/app.module.js';
import { RATE_LIMITS } from '../src/common/rate-limits.js';
import { ChatModelFactory } from '../src/llm/llm.providers.js';
import { stubModelFactory } from './stubs.js';

/**
 * The health check Railway calls, and the per-IP limits on the routes and
 * events that call Claude. vitest.config.e2e.ts sets CLIENT_IP_HEADER to
 * x-real-ip, so each test picks its client's IP the way Railway's proxy would.
 */
describe('Health and rate limits (e2e)', () => {
  let app: INestApplication;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelFactory)
      .useValue(stubModelFactory)
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

  it('reports healthy while MongoDB is connected', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200, { status: 'ok' });
  });

  it('limits questionnaire drafts per client IP', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/studies')
      .set('x-real-ip', '203.0.113.10')
      .send({ brief: 'Why are parents switching infant formula brands? UK mothers 25 to 40.' })
      .expect(201);
    const generate = (ip: string) =>
      request(server)
        .post(`/api/studies/${created.body.study.id}/questionnaire/generate`)
        .set('x-real-ip', ip);

    for (let i = 0; i < RATE_LIMITS.generateQuestionnaire.limit; i++) {
      await generate('203.0.113.10').expect(200);
    }
    const blocked = await generate('203.0.113.10').expect(429);
    expect(blocked.body.message).toMatch(/Too many requests/);
    expect(blocked.headers['retry-after']).toBeDefined();

    // Another client is counted on its own.
    await generate('203.0.113.11').expect(200);
  });

  it('limits interview joins per client IP and answers with an Ack', async () => {
    const connect = (ip: string) => {
      const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(`${url}${INTERVIEW_NAMESPACE}`, {
        auth: { distinctId: `respondent-${ip}` },
        extraHeaders: { 'x-real-ip': ip },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      return socket;
    };
    // A well-formed id for a study that does not exist: every join fails, but
    // only after the limit has counted it.
    const studyId = '0123456789abcdef01234567';
    const socket = connect('203.0.113.20');

    for (let i = 0; i < RATE_LIMITS.joinInterview.limit; i++) {
      const result = await socket.emitWithAck('interview:join', { studyId });
      expect(result).toMatchObject({ ok: false });
      expect(result.ok || result.error).not.toMatch(/Too many/);
    }
    expect(await socket.emitWithAck('interview:join', { studyId })).toEqual({
      ok: false,
      error: 'Too many interviews from your network. Try again in a few minutes.',
    });

    const other = await connect('203.0.113.21').emitWithAck('interview:join', { studyId });
    expect(other.ok || other.error).not.toMatch(/Too many/);
  });
});
