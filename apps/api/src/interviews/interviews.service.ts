import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Command, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { MongoDBSaver, type MongoDBSaverParams } from '@langchain/langgraph-checkpoint-mongodb';
import { Model, Types, type Connection } from 'mongoose';
import {
  ANALYTICS_EVENTS,
  MODERATOR_PROMPT_FLAG,
  type InterviewMessageDto,
  type InterviewProgress,
  type InterviewSessionDto,
  type Question,
} from '@probe-lab/shared';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { LlmNotConfiguredError } from '../llm/chat-model.js';
import { LangfuseService } from '../llm/llm.providers.js';
import { QuestionnairesService } from '../questionnaires/questionnaires.service.js';
import { StudiesService } from '../studies/studies.service.js';
import {
  InterviewMessage,
  type InterviewMessageDocument,
} from './interview-message.schema.js';
import { Interview, type InterviewDocument } from './interview.schema.js';
import { progressOf, toMessageDto } from './interview.mapper.js';
import { ModeratorChainsFactory } from './moderator-chains.factory.js';
import { compileModeratorGraph, type ModeratorGraph } from './moderator/moderator.graph.js';
import { runModeratorTurn, type ModeratorInput } from './moderator/moderator.run.js';
import type { AwaitingAnswer, Turn } from './moderator/moderator.state.js';

/** How the service talks back to the browser. The gateway implements it with Socket.io rooms. */
export interface InterviewEmitter {
  delta(interviewId: string, delta: string): void;
  done(interviewId: string, message: InterviewMessageDto): void;
  progress(interviewId: string, progress: InterviewProgress): void;
  completed(interviewId: string): void;
  error(interviewId: string, message: string): void;
}

interface ModeratorSession {
  graph: ModeratorGraph;
  config: LangGraphRunnableConfig;
  questions: Question[];
}

@Injectable()
export class InterviewsService implements OnModuleInit {
  private readonly logger = new Logger(InterviewsService.name);
  private checkpointer!: MongoDBSaver;
  /** Interviews with a moderator turn in flight. Only one turn runs per interview. */
  private readonly running = new Set<string>();

  constructor(
    @InjectModel(Interview.name) private readonly interviews: Model<Interview>,
    @InjectModel(InterviewMessage.name) private readonly messages: Model<InterviewMessage>,
    @InjectConnection() private readonly connection: Connection,
    private readonly studies: StudiesService,
    private readonly questionnaires: QuestionnairesService,
    private readonly chainsFactory: ModeratorChainsFactory,
    private readonly langfuse: LangfuseService,
    private readonly analytics: AnalyticsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.checkpointer = new MongoDBSaver({
      // The checkpointer is typed against its own copy of the MongoDB driver.
      // It only calls db().collection() methods, which Mongoose's driver has
      // too, so it shares Mongoose's connection pool instead of opening another.
      client: this.connection.getClient() as unknown as MongoDBSaverParams['client'],
      dbName: this.connection.name,
      checkpointCollectionName: 'moderator_checkpoints',
      checkpointWritesCollectionName: 'moderator_checkpoint_writes',
    });
    for (const error of await this.checkpointer.setup()) {
      this.logger.warn(`Checkpoint index setup failed: ${error.message}`);
    }
  }

  /**
   * Finds or creates the respondent's interview for a study and returns the
   * transcript so far. Respondents are anonymous: the PostHog distinct id from
   * their browser is what lets a reload resume the same interview.
   */
  async openSession(studyId: string, respondentId: string): Promise<InterviewSessionDto> {
    const { study, questionnaire } = await this.studies.detail(new Types.ObjectId(studyId));
    let interview = await this.interviews.findOne({ studyId, respondentId }).exec();
    if (!interview) {
      if (study.status !== 'live' || !questionnaire) {
        throw new ConflictException('This study is not taking interviews right now.');
      }
      interview = await this.createInterview(study.id, questionnaire.id, respondentId);
    }

    const questions = await this.questionsOf(interview);
    const messages = (
      await this.messages.find({ interviewId: interview._id }).sort({ seq: 1 }).exec()
    ).map(toMessageDto);
    return {
      interviewId: interview.id,
      studyTitle: study.title,
      status: interview.status,
      progress: progressOf(questions, messages),
      messages,
    };
  }

  /**
   * Runs whatever the moderator still has to do: the opening question for a
   * new interview, or a turn that was cut off (for example by a restart).
   * Does nothing while the graph is waiting for the respondent.
   * Never throws: problems are reported through the emitter.
   */
  async continueInterview(interviewId: string, emitter: InterviewEmitter): Promise<void> {
    if (this.running.has(interviewId)) return;
    this.running.add(interviewId);
    try {
      const interview = await this.interviews.findById(interviewId).exec();
      if (!interview || interview.status !== 'in_progress') return;
      const session = await this.moderatorSession(interview);

      let input: ModeratorInput | null;
      if (!(await this.checkpointer.getTuple(session.config))) {
        const { study } = await this.studies.detail(interview.studyId);
        input = { studyTitle: study.title, questions: session.questions };
      } else {
        const snapshot = await session.graph.getState(session.config);
        if (snapshot.tasks.some((task) => task.interrupts.length > 0)) return;
        if (snapshot.next.length === 0) {
          await this.complete(interview, emitter);
          return;
        }
        // Passing null resumes from the last checkpoint.
        input = null;
      }
      await this.runTurn(interview, session, input, emitter);
    } catch (error) {
      this.report(interviewId, error, emitter);
    } finally {
      this.running.delete(interviewId);
    }
  }

  /**
   * Saves the respondent's answer, then resumes the paused graph with it.
   * Returns once the answer is saved; the moderator's reply streams through
   * the emitter afterwards.
   */
  async answer(
    interviewId: string,
    respondentId: string,
    text: string,
    emitter: InterviewEmitter,
  ): Promise<InterviewMessageDto> {
    const interview = await this.interviews.findById(interviewId).exec();
    if (!interview || interview.respondentId !== respondentId) {
      throw new NotFoundException('Interview not found');
    }
    if (interview.status !== 'in_progress') {
      throw new ConflictException('This interview is already finished.');
    }
    if (this.running.has(interviewId)) {
      throw new ConflictException('Wait for the moderator to finish.');
    }

    this.running.add(interviewId);
    let session: ModeratorSession;
    let saved: InterviewMessageDocument;
    try {
      session = await this.moderatorSession(interview);
      const awaiting = await this.awaitingAnswer(session);
      if (!awaiting) {
        throw new ConflictException('The moderator is not waiting for an answer.');
      }
      saved = await this.saveMessage(interview, {
        role: 'respondent',
        kind: 'answer',
        questionKey: awaiting.questionKey,
        followUpIndex: awaiting.followUpIndex,
        content: text,
      });
    } catch (error) {
      this.running.delete(interviewId);
      throw error;
    }

    const resume = new Command({ resume: { messageId: saved.id, text } });
    void this.runTurn(interview, session, resume, emitter).finally(() =>
      this.running.delete(interviewId),
    );
    return toMessageDto(saved);
  }

  private async createInterview(
    studyId: string,
    questionnaireId: string,
    respondentId: string,
  ): Promise<InterviewDocument> {
    const promptVersion = await this.analytics.moderatorPromptVersion(respondentId);
    try {
      const interview = await this.interviews.create({
        studyId: new Types.ObjectId(studyId),
        questionnaireId: new Types.ObjectId(questionnaireId),
        respondentId,
        promptVersion,
      });
      this.analytics.capture(respondentId, ANALYTICS_EVENTS.interviewStarted, studyId, {
        interview_id: interview.id,
        prompt_version: promptVersion,
        [`$feature/${MODERATOR_PROMPT_FLAG}`]: promptVersion,
      });
      return interview;
    } catch (error) {
      // Two tabs (or React's double effects in dev) can join at the same
      // moment. The unique index lets one create the interview; the other
      // picks it up.
      if ((error as { code?: number }).code === 11000) {
        const existing = await this.interviews.findOne({ studyId, respondentId }).exec();
        if (existing) return existing;
      }
      throw error;
    }
  }

  private async questionsOf(interview: InterviewDocument): Promise<Question[]> {
    const questionnaire = await this.questionnaires.findById(interview.questionnaireId);
    if (!questionnaire) {
      throw new NotFoundException('The questionnaire for this interview is missing.');
    }
    return questionnaire.questions.map(({ key, text, goal }) => ({ key, text, goal }));
  }

  /**
   * Builds the graph for this interview's prompt version. The thread id is the
   * interview id, so the checkpointer finds the interview's saved state, and a
   * fresh Langfuse handler makes each turn its own trace in the interview's
   * session.
   */
  private async moderatorSession(interview: InterviewDocument): Promise<ModeratorSession> {
    const [questions, { chains, promptSources }] = await Promise.all([
      this.questionsOf(interview),
      this.chainsFactory.create(interview.promptVersion),
    ]);
    const handler = this.langfuse.handler({
      sessionId: `interview-${interview.id}`,
      userId: interview.respondentId,
      tags: ['moderator', `prompt-${interview.promptVersion}`, ...promptSources],
      metadata: { studyId: interview.studyId.toString(), interviewId: interview.id },
    });
    return {
      graph: compileModeratorGraph(chains, this.checkpointer),
      config: {
        configurable: { thread_id: interview.id },
        callbacks: [handler],
        runName: 'moderator-turn',
      },
      questions,
    };
  }

  private async awaitingAnswer(session: ModeratorSession): Promise<AwaitingAnswer | null> {
    const snapshot = await session.graph.getState(session.config);
    const pending = snapshot.tasks.flatMap((task) => task.interrupts)[0];
    return (pending?.value as AwaitingAnswer | undefined) ?? null;
  }

  private async runTurn(
    interview: InterviewDocument,
    session: ModeratorSession,
    input: ModeratorInput | Command | null,
    emitter: InterviewEmitter,
  ): Promise<void> {
    const id = interview.id;
    try {
      const outcome = await runModeratorTurn(session.graph, input, session.config, {
        onDelta: (delta) => emitter.delta(id, delta),
        onModeratorTurn: async (turn) => {
          const saved = toMessageDto(await this.saveMessage(interview, turn));
          emitter.done(id, saved);
          if (turn.kind === 'question') {
            emitter.progress(id, progressOf(session.questions, [saved]));
          }
        },
      });
      if (outcome.status === 'completed') {
        await this.complete(interview, emitter);
      }
    } catch (error) {
      this.report(id, error, emitter);
    }
  }

  private async complete(interview: InterviewDocument, emitter: InterviewEmitter): Promise<void> {
    interview.status = 'completed';
    interview.completedAt = new Date();
    await interview.save();
    this.analytics.capture(
      interview.respondentId,
      ANALYTICS_EVENTS.interviewCompleted,
      interview.studyId.toString(),
      {
        interview_id: interview.id,
        prompt_version: interview.promptVersion,
        [`$feature/${MODERATOR_PROMPT_FLAG}`]: interview.promptVersion,
      },
    );
    emitter.completed(interview.id);
  }

  private async saveMessage(
    interview: InterviewDocument,
    turn: Omit<Turn, 'messageId'>,
  ): Promise<InterviewMessageDocument> {
    const last = await this.messages
      .findOne({ interviewId: interview._id })
      .sort({ seq: -1 })
      .select('seq')
      .lean()
      .exec();
    return this.messages.create({
      interviewId: interview._id,
      studyId: interview.studyId,
      seq: (last?.seq ?? 0) + 1,
      role: turn.role,
      kind: turn.kind,
      questionKey: turn.questionKey,
      followUpIndex: turn.followUpIndex,
      content: turn.content,
    });
  }

  private report(interviewId: string, error: unknown, emitter: InterviewEmitter): void {
    if (error instanceof LlmNotConfiguredError) {
      emitter.error(interviewId, error.message);
      return;
    }
    this.logger.error(`Moderator turn failed for interview ${interviewId}`, error);
    emitter.error(interviewId, 'The moderator ran into a problem. Try again in a moment.');
  }
}
