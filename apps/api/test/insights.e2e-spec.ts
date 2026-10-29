import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { RunnableLambda } from '@langchain/core/runnables';
import { Types, type Connection, type Model } from 'mongoose';
import request from 'supertest';
import type { InsightsDraft, StudyInsightsDto } from '@probe-lab/shared';
import { AppModule } from '../src/app.module.js';
import { InsightsChainFactory } from '../src/insights/insights-chain.factory.js';
import type { InsightsInput } from '../src/insights/insights.chain.js';
import { InterviewMessage } from '../src/interviews/interview-message.schema.js';
import { Interview } from '../src/interviews/interview.schema.js';
import { ChatModelFactory } from '../src/llm/llm.providers.js';
import { generatedQuestionnaire, stubModelFactory } from './stubs.js';

const FIRST_ANSWER = 'The price went up twice in a year, so I looked around.';
const IN_PROGRESS_ANSWER = 'This interview is not finished yet.';

/**
 * Scripted summary model. It quotes the first answer it is shown three ways:
 * an exact excerpt, a paraphrase, and under a reference that does not exist.
 * The API must keep only the first.
 */
const prompts: InsightsInput[] = [];
const scriptedInsightsFactory = {
  create: async () => ({
    chain: RunnableLambda.from(async (input: InsightsInput): Promise<InsightsDraft> => {
      prompts.push(input);
      return {
        overview: 'Respondents switch when prices rise, and rarely for other reasons.',
        themes: [
          {
            title: 'Price rises',
            summary: 'One respondent switched after two price rises.',
            quotes: [
              { ref: 'A1', text: '"the price went up twice in a year"' },
              { ref: 'A1', text: 'the cost doubled' },
            ],
          },
          {
            title: 'Made-up theme',
            summary: 'Nobody said this.',
            quotes: [{ ref: 'A99', text: 'I love the new tin' }],
          },
        ],
      };
    }),
    promptSource: 'scripted',
  }),
};

describe('Insights summary (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ChatModelFactory)
      .useValue(stubModelFactory)
      .overrideProvider(InsightsChainFactory)
      .useValue(scriptedInsightsFactory)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  async function liveStudy(): Promise<{ studyId: string; questionnaireId: string }> {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/studies')
      .send({ brief: 'Why are parents switching infant formula brands? UK mothers 25 to 40.' })
      .expect(201);
    const studyId: string = created.body.study.id;
    await request(server).post(`/api/studies/${studyId}/questionnaire/generate`).expect(200);
    const launched = await request(server).post(`/api/studies/${studyId}/launch`).expect(200);
    return { studyId, questionnaireId: launched.body.questionnaire.id };
  }

  /** Writes an interview straight to the database, as if the moderator had run it. */
  async function seedInterview(
    ids: { studyId: string; questionnaireId: string },
    respondentId: string,
    status: 'completed' | 'in_progress',
    answer: string,
  ) {
    const interviews = app.get<Model<Interview>>(getModelToken(Interview.name));
    const messages = app.get<Model<InterviewMessage>>(getModelToken(InterviewMessage.name));
    const interview = await interviews.create({
      studyId: new Types.ObjectId(ids.studyId),
      questionnaireId: new Types.ObjectId(ids.questionnaireId),
      respondentId,
      promptVersion: 'v1',
      status,
    });
    const base = { interviewId: interview._id, studyId: interview.studyId, questionKey: 'q1', followUpIndex: 0 };
    await messages.create([
      { ...base, seq: 1, role: 'moderator', kind: 'question', content: generatedQuestionnaire.questions[0]!.text },
      { ...base, seq: 2, role: 'respondent', kind: 'answer', content: answer },
    ]);
    return interview;
  }

  it('summarises completed interviews and keeps only quotes that match a real answer', async () => {
    const ids = await liveStudy();
    const server = app.getHttpServer();

    const empty = await request(server).get(`/api/studies/${ids.studyId}/insights`).expect(200);
    expect(empty.body).toEqual({ studyId: ids.studyId, interviews: { started: 0, completed: 0 }, summary: null });
    await request(server).post(`/api/studies/${ids.studyId}/insights`).expect(409);

    const done = await seedInterview(ids, 'respondent-1', 'completed', FIRST_ANSWER);
    await seedInterview(ids, 'respondent-2', 'in_progress', IN_PROGRESS_ANSWER);

    const generated = await request(server).post(`/api/studies/${ids.studyId}/insights`).expect(200);
    const insights = generated.body as StudyInsightsDto;

    // Only the completed interview reaches the model.
    expect(prompts.at(-1)?.interviewCount).toBe(1);
    expect(prompts.at(-1)?.answers).toContain(`[A1] Respondent 1: ${FIRST_ANSWER}`);
    expect(prompts.at(-1)?.answers).not.toContain(IN_PROGRESS_ANSWER);

    expect(insights.interviews).toEqual({ started: 2, completed: 1 });
    expect(insights.summary).toMatchObject({
      interviewCount: 1,
      answerCount: 1,
      rejectedQuoteCount: 2,
      promptSource: 'scripted',
    });
    // The made-up theme had no real quote left, so it is gone.
    expect(insights.summary?.themes).toHaveLength(1);
    expect(insights.summary?.themes[0]?.quotes).toEqual([
      {
        messageId: expect.any(String),
        interviewId: done.id,
        questionKey: 'q1',
        question: generatedQuestionnaire.questions[0]!.text,
        text: 'The price went up twice in a year',
        answer: FIRST_ANSWER,
      },
    ]);

    // The quote points at the respondent's message in the messages collection.
    const messages = app.get<Model<InterviewMessage>>(getModelToken(InterviewMessage.name));
    const source = await messages.findById(insights.summary!.themes[0]!.quotes[0]!.messageId).exec();
    expect(source).toMatchObject({ role: 'respondent', content: FIRST_ANSWER });

    const fetched = await request(server).get(`/api/studies/${ids.studyId}/insights`).expect(200);
    expect(fetched.body).toEqual(generated.body);
  });

  it('refuses to summarise a study that is still a draft', async () => {
    const server = app.getHttpServer();
    const created = await request(server)
      .post('/api/studies')
      .send({ brief: 'How do commuters choose between buses and walking for short trips?' })
      .expect(201);
    await request(server).post(`/api/studies/${created.body.study.id}/insights`).expect(409);
  });

  it('returns 404 for an unknown study', async () => {
    await request(app.getHttpServer())
      .get(`/api/studies/${new Types.ObjectId().toString()}/insights`)
      .expect(404);
  });
});
