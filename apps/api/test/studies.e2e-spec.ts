import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import request from 'supertest';
import type { StudyDetailDto } from '@probe-lab/shared';
import { AppModule } from '../src/app.module.js';
import { ChatModelFactory } from '../src/llm/llm.providers.js';
import { stubModelFactory } from './stubs.js';

/**
 * Runs the real Nest app against MongoDB from `docker compose up`, with one
 * provider swapped: the model factory returns a ChatAnthropic whose HTTP client
 * is a stub. Swapping a provider in the testing module is how Nest tests code
 * that sits behind dependency injection.
 */
describe('Studies API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelFactory)
      .useValue(stubModelFactory)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  it('takes a brief through generate, edit and launch', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/api/studies')
      .send({ brief: 'Why are parents switching infant formula brands? UK mothers 25 to 40.' })
      .expect(201);
    const studyId = (created.body as StudyDetailDto).study.id;
    expect(created.body.study.status).toBe('draft');
    expect(created.body.questionnaire).toBeNull();

    const generated = await request(server)
      .post(`/api/studies/${studyId}/questionnaire/generate`)
      .expect(200);
    expect(generated.body.questionnaire.version).toBe(1);
    expect(generated.body.questionnaire.source).toBe('generated');
    expect(generated.body.questionnaire.questions.map((q: { key: string }) => q.key)).toEqual([
      'q1',
      'q2',
      'q3',
      'q4',
      'q5',
      'q6',
    ]);
    expect(generated.body.study.title).toBe('Infant formula switching');

    // The client drops the second question and adds a new one at the top.
    const questions = generated.body.questionnaire.questions.filter(
      (q: { key: string }) => q.key !== 'q2',
    );
    const edit = {
      ...generated.body.questionnaire,
      questions: [{ text: 'How did you choose your first formula?', goal: 'Baseline' }, ...questions],
    };
    const edited = await request(server)
      .put(`/api/studies/${studyId}/questionnaire`)
      .send(edit)
      .expect(200);
    expect(edited.body.changed).toBe(true);
    expect(edited.body.questionnaire.version).toBe(2);
    expect(edited.body.questionnaire.source).toBe('edited');
    expect(edited.body.questionnaire.questions[0].key).toBe('q7');

    const unchanged = await request(server)
      .put(`/api/studies/${studyId}/questionnaire`)
      .send(edited.body.questionnaire)
      .expect(200);
    expect(unchanged.body.changed).toBe(false);
    expect(unchanged.body.questionnaire.version).toBe(2);

    const launched = await request(server).post(`/api/studies/${studyId}/launch`).expect(200);
    expect(launched.body.study.status).toBe('live');
    expect(launched.body.questionnaire.version).toBe(2);

    await request(server).put(`/api/studies/${studyId}/questionnaire`).send(edit).expect(409);
  });

  it('rejects a brief that is too short', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/studies')
      .send({ brief: 'formula' })
      .expect(400);
    expect(response.body.issues[0].path).toBe('brief');
  });

  it('returns 400 for an id that is not an ObjectId', async () => {
    await request(app.getHttpServer()).get('/api/studies/not-an-id').expect(400);
  });
});
