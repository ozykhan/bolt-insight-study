import type { BaseMessage } from '@langchain/core/messages';
import type { Runnable } from '@langchain/core/runnables';
import {
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import { MAX_FOLLOW_UPS } from '@probe-lab/shared';
import {
  ModeratorState,
  type AnswerResume,
  type AwaitingAnswer,
  type Decision,
  type ModeratorStateUpdate,
  type ModeratorStateValue,
  type Turn,
} from './moderator.state.js';

export type DecideInput = {
  question: string;
  goal: string;
  thread: string;
  followUps: number;
  maxFollowUps: number;
};
export type FollowUpInput = { question: string; goal: string; thread: string };
export type BridgeInput = { lastAnswer: string; nextQuestion: string };

/** The three LLM calls the moderator makes. Tests swap them for scripted fakes. */
export interface ModeratorChains {
  decide: Runnable<DecideInput, Decision>;
  followUp: Runnable<FollowUpInput, BaseMessage>;
  bridge: Runnable<BridgeInput, BaseMessage>;
}

/** Nodes whose model output is shown to the respondent while it streams. */
export const SPEAKING_NODES = new Set(['askQuestion', 'askFollowUp', 'close']);

export const CLOSING_TEXT =
  'That was my last question. Thank you for your time and for sharing your experience so openly.';
export const STOPPED_TEXT = 'No problem, we can stop here. Thank you for your time.';
const FALLBACK_FOLLOW_UP = 'Could you tell me a little more about that?';

export function introText(studyTitle: string, questionCount: number): string {
  return `Hi, and thank you for taking part. I'd like to ask you ${questionCount} questions about ${studyTitle.toLowerCase()}. There are no right or wrong answers, so just tell me what you think.`;
}

/**
 * The conditional edge after each answer. The model only suggests an action;
 * this function enforces the follow-up limit and decides when the interview
 * is over, so the rule holds whatever the model says.
 */
export function routeAfterDecide(
  state: Pick<ModeratorStateValue, 'decision' | 'followUpCount' | 'questionIndex' | 'questions'>,
): 'askFollowUp' | 'advance' | 'close' {
  const action = state.decision?.action ?? 'next';
  if (action === 'end') return 'close';
  if (action === 'follow_up' && state.followUpCount < MAX_FOLLOW_UPS) return 'askFollowUp';
  return state.questionIndex + 1 < state.questions.length ? 'advance' : 'close';
}

function currentQuestion(state: ModeratorStateValue) {
  const question = state.questions[state.questionIndex];
  if (!question) {
    throw new Error(`No question at index ${state.questionIndex}`);
  }
  return question;
}

/** Formats turns for the decide and follow-up prompts. The evals use it too, so they see what production sees. */
export function formatThread(turns: Array<Pick<Turn, 'role' | 'content'>>): string {
  return turns
    .map((turn) => `${turn.role === 'moderator' ? 'Moderator' : 'Respondent'}: ${turn.content}`)
    .join('\n');
}

/** The current question's exchange, formatted for the prompts. */
function questionThread(state: ModeratorStateValue): string {
  const key = currentQuestion(state).key;
  return formatThread(state.turns.filter((turn) => turn.questionKey === key));
}

function lastAnswer(state: ModeratorStateValue): string {
  return state.turns.findLast((turn) => turn.role === 'respondent')?.content ?? '';
}

export function buildModeratorGraph(chains: ModeratorChains) {
  /**
   * Asks the current question. The questionnaire wording is never changed:
   * the model only writes a one-line bridge from the previous answer, and the
   * exact question text is appended after it.
   */
  const askQuestion = async (
    state: ModeratorStateValue,
    config: LangGraphRunnableConfig,
  ): Promise<ModeratorStateUpdate> => {
    const question = currentQuestion(state);
    let opener: string;
    if (state.questionIndex === 0) {
      opener = introText(state.studyTitle, state.questions.length);
    } else {
      const reply = await chains.bridge.invoke(
        { lastAnswer: lastAnswer(state), nextQuestion: question.text },
        config,
      );
      opener = reply.text.trim();
    }
    const turn: Turn = {
      role: 'moderator',
      kind: 'question',
      questionKey: question.key,
      followUpIndex: 0,
      content: opener ? `${opener}\n\n${question.text}` : question.text,
    };
    return { turns: [turn], decision: null };
  };

  /**
   * Pauses the graph until the respondent answers. `interrupt()` saves the
   * state through the checkpointer and stops the run; the gateway resumes it
   * with `new Command({ resume: { messageId, text } })`, and that value is
   * what `interrupt()` returns here. On resume LangGraph re-runs this node
   * from the top, so nothing before `interrupt()` may have side effects.
   */
  const awaitAnswer = (state: ModeratorStateValue): ModeratorStateUpdate => {
    const question = currentQuestion(state);
    const answer = interrupt<AwaitingAnswer, AnswerResume>({
      questionKey: question.key,
      followUpIndex: state.followUpCount,
    });
    const turn: Turn = {
      role: 'respondent',
      kind: 'answer',
      questionKey: question.key,
      followUpIndex: state.followUpCount,
      content: answer.text,
      messageId: answer.messageId,
    };
    return { turns: [turn] };
  };

  const decide = async (
    state: ModeratorStateValue,
    config: LangGraphRunnableConfig,
  ): Promise<ModeratorStateUpdate> => {
    const question = currentQuestion(state);
    const decision = await chains.decide.invoke(
      {
        question: question.text,
        goal: question.goal,
        thread: questionThread(state),
        followUps: state.followUpCount,
        maxFollowUps: MAX_FOLLOW_UPS,
      },
      config,
    );
    return { decision };
  };

  const askFollowUp = async (
    state: ModeratorStateValue,
    config: LangGraphRunnableConfig,
  ): Promise<ModeratorStateUpdate> => {
    const question = currentQuestion(state);
    const reply = await chains.followUp.invoke(
      { question: question.text, goal: question.goal, thread: questionThread(state) },
      config,
    );
    const followUpIndex = state.followUpCount + 1;
    const turn: Turn = {
      role: 'moderator',
      kind: 'follow_up',
      questionKey: question.key,
      followUpIndex,
      content: reply.text.trim() || FALLBACK_FOLLOW_UP,
    };
    return { followUpCount: followUpIndex, turns: [turn] };
  };

  const advance = (state: ModeratorStateValue): ModeratorStateUpdate => ({
    questionIndex: state.questionIndex + 1,
    followUpCount: 0,
  });

  const close = (state: ModeratorStateValue): ModeratorStateUpdate => {
    const turn: Turn = {
      role: 'moderator',
      kind: 'closing',
      questionKey: null,
      followUpIndex: 0,
      content: state.decision?.action === 'end' ? STOPPED_TEXT : CLOSING_TEXT,
    };
    return { turns: [turn] };
  };

  return new StateGraph(ModeratorState)
    .addNode('askQuestion', askQuestion)
    .addNode('awaitAnswer', awaitAnswer)
    .addNode('decide', decide)
    .addNode('askFollowUp', askFollowUp)
    .addNode('advance', advance)
    .addNode('close', close)
    .addEdge(START, 'askQuestion')
    .addEdge('askQuestion', 'awaitAnswer')
    .addEdge('awaitAnswer', 'decide')
    .addConditionalEdges('decide', routeAfterDecide, ['askFollowUp', 'advance', 'close'])
    .addEdge('askFollowUp', 'awaitAnswer')
    .addEdge('advance', 'askQuestion')
    .addEdge('close', END);
}

/** Compiles the graph with a checkpointer, which `interrupt()` needs to pause and resume. */
export function compileModeratorGraph(chains: ModeratorChains, checkpointer: BaseCheckpointSaver) {
  return buildModeratorGraph(chains).compile({ checkpointer, name: 'moderator' });
}

export type ModeratorGraph = ReturnType<typeof compileModeratorGraph>;
