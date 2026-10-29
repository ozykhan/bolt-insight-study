import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import { RunnableLambda } from '@langchain/core/runnables';
import { FakeListChatModel } from '@langchain/core/utils/testing';
import { Command, MemorySaver } from '@langchain/langgraph';
import type { Question } from '@probe-lab/shared';
import {
  CLOSING_TEXT,
  STOPPED_TEXT,
  compileModeratorGraph,
  routeAfterDecide,
  type BridgeInput,
  type DecideInput,
  type FollowUpInput,
  type ModeratorChains,
} from './moderator.graph.js';
import { runModeratorTurn, type TurnOutcome } from './moderator.run.js';
import type { Decision, Turn } from './moderator.state.js';

const questions: Question[] = [
  { key: 'q1', text: 'How do you usually get to work?', goal: 'Understand the routine' },
  { key: 'q2', text: 'What would make you change that?', goal: 'Find triggers' },
  { key: 'q3', text: 'How do you see your commute in a year?', goal: 'Forward-looking close' },
];

type Action = Decision['action'];

/** Scripted chains: decide returns the next action from the list, the speakers return fixed lines. */
function scriptedChains(actions: Action[]): ModeratorChains & { decideInputs: DecideInput[] } {
  const queue = [...actions];
  const decideInputs: DecideInput[] = [];
  let followUps = 0;
  return {
    decideInputs,
    decide: RunnableLambda.from(async (input: DecideInput): Promise<Decision> => {
      decideInputs.push(input);
      return { action: queue.shift() ?? 'next', reason: 'scripted' };
    }),
    followUp: RunnableLambda.from(
      async (_input: FollowUpInput): Promise<BaseMessage> =>
        new AIMessage(`Follow-up number ${++followUps}?`),
    ),
    bridge: RunnableLambda.from(
      async (_input: BridgeInput): Promise<BaseMessage> => new AIMessage('Thanks for explaining.'),
    ),
  };
}

let threadCounter = 0;

/** Drives one interview thread the way the gateway does, collecting what the respondent would see. */
function interview(chains: ModeratorChains) {
  const graph = compileModeratorGraph(chains, new MemorySaver());
  const config = { configurable: { thread_id: `thread-${++threadCounter}` } };
  const said: Turn[] = [];
  const deltas: string[] = [];
  const handlers = {
    onDelta: (delta: string) => void deltas.push(delta),
    onModeratorTurn: async (turn: Turn) => void said.push(turn),
  };
  let answers = 0;
  return {
    graph,
    config,
    said,
    deltas,
    start: (): Promise<TurnOutcome> =>
      runModeratorTurn(graph, { studyTitle: 'Commuting', questions }, config, handlers),
    answer: (text: string): Promise<TurnOutcome> =>
      runModeratorTurn(
        graph,
        new Command({ resume: { messageId: `m${++answers}`, text } }),
        config,
        handlers,
      ),
    state: async () => (await graph.getState(config)).values as { turns: Turn[]; questionIndex: number },
  };
}

describe('routeAfterDecide', () => {
  const base = { questions, questionIndex: 0, followUpCount: 0 };
  const decision = (action: Action) => ({ action, reason: '' });

  it.each([
    ['follows up when asked and under the limit', { decision: decision('follow_up') }, 'askFollowUp'],
    ['moves on once two follow-ups were asked', { decision: decision('follow_up'), followUpCount: 2 }, 'advance'],
    ['moves on when the model says next', { decision: decision('next') }, 'advance'],
    ['closes after the last question', { decision: decision('next'), questionIndex: 2 }, 'close'],
    ['closes after the last question even if a follow-up is allowed', { decision: decision('follow_up'), questionIndex: 2, followUpCount: 2 }, 'close'],
    ['closes when the respondent wants to stop', { decision: decision('end') }, 'close'],
  ] as const)('%s', (_name, patch, expected) => {
    expect(routeAfterDecide({ ...base, ...patch })).toBe(expected);
  });
});

describe('moderator graph', () => {
  it('opens with an intro and the first question, then waits for an answer', async () => {
    const run = interview(scriptedChains([]));

    const outcome = await run.start();

    expect(outcome).toEqual({ status: 'awaiting_answer', awaiting: { questionKey: 'q1', followUpIndex: 0 } });
    expect(run.said).toHaveLength(1);
    expect(run.said[0]).toMatchObject({ kind: 'question', questionKey: 'q1' });
    expect(run.said[0]!.content).toMatch(/^Hi, and thank you for taking part\. I'd like to ask you 3 questions about commuting\./);
    expect(run.said[0]!.content.endsWith(questions[0]!.text)).toBe(true);
  });

  it('bridges to the next question and keeps its exact wording', async () => {
    const run = interview(scriptedChains(['next']));
    await run.start();

    const outcome = await run.answer('By bus, most days.');

    expect(outcome).toEqual({ status: 'awaiting_answer', awaiting: { questionKey: 'q2', followUpIndex: 0 } });
    expect(run.said[1]).toMatchObject({
      kind: 'question',
      questionKey: 'q2',
      content: `Thanks for explaining.\n\n${questions[1]!.text}`,
    });
  });

  it('asks at most two follow-ups per question, even when the model wants more', async () => {
    const chains = scriptedChains(['follow_up', 'follow_up', 'follow_up']);
    const run = interview(chains);
    await run.start();

    const first = await run.answer('Bus.');
    const second = await run.answer('It is cheap.');
    const third = await run.answer('Not much else to say.');

    expect(first).toMatchObject({ awaiting: { questionKey: 'q1', followUpIndex: 1 } });
    expect(second).toMatchObject({ awaiting: { questionKey: 'q1', followUpIndex: 2 } });
    expect(third).toMatchObject({ awaiting: { questionKey: 'q2', followUpIndex: 0 } });
    expect(run.said.map((turn) => [turn.kind, turn.questionKey, turn.followUpIndex])).toEqual([
      ['question', 'q1', 0],
      ['follow_up', 'q1', 1],
      ['follow_up', 'q1', 2],
      ['question', 'q2', 0],
    ]);
    // The prompt is told how many follow-ups were already asked.
    expect(chains.decideInputs.map((input) => input.followUps)).toEqual([0, 1, 2]);
  });

  it('gives the model the whole exchange on the current question only', async () => {
    const chains = scriptedChains(['next', 'follow_up']);
    const run = interview(chains);
    await run.start();
    await run.answer('Bus.');

    await run.answer('A cheaper bike.');

    const thread = chains.decideInputs[1]!.thread;
    expect(thread).toContain(`Moderator: Thanks for explaining.\n\n${questions[1]!.text}`);
    expect(thread).toContain('Respondent: A cheaper bike.');
    expect(thread).not.toContain('Bus.');
  });

  it('stops politely when the respondent wants to end', async () => {
    const run = interview(scriptedChains(['end']));
    await run.start();

    const outcome = await run.answer('I would rather stop now.');

    expect(outcome).toEqual({ status: 'completed' });
    expect(run.said.at(-1)).toMatchObject({ kind: 'closing', questionKey: null, content: STOPPED_TEXT });
  });

  it('closes after the last question', async () => {
    const run = interview(scriptedChains(['next', 'next', 'next']));
    await run.start();
    await run.answer('Bus.');
    await run.answer('A cheaper bike.');

    const outcome = await run.answer('Probably the same.');

    expect(outcome).toEqual({ status: 'completed' });
    expect(run.said.map((turn) => turn.kind)).toEqual(['question', 'question', 'question', 'closing']);
    expect(run.said.at(-1)!.content).toBe(CLOSING_TEXT);
  });

  it('keeps the saved message id on every answer', async () => {
    const run = interview(scriptedChains(['follow_up', 'next']));
    await run.start();
    await run.answer('Bus.');
    await run.answer('It is cheap.');

    const { turns } = await run.state();
    const answers = turns.filter((turn) => turn.role === 'respondent');
    expect(answers).toEqual([
      expect.objectContaining({ questionKey: 'q1', followUpIndex: 0, messageId: 'm1', content: 'Bus.' }),
      expect.objectContaining({ questionKey: 'q1', followUpIndex: 1, messageId: 'm2', content: 'It is cheap.' }),
    ]);
  });

  it('streams what the speaking nodes say, and nothing from the decide step', async () => {
    const decideModel = new FakeListChatModel({ responses: ['{"action":"next","reason":"clear"}'] });
    const speakModel = new FakeListChatModel({ responses: ['Thanks, that helps.'] });
    const chains: ModeratorChains = {
      decide: RunnableLambda.from((input: DecideInput) => input.thread)
        .pipe(decideModel)
        .pipe(RunnableLambda.from((message: BaseMessage) => JSON.parse(message.text) as Decision)),
      followUp: RunnableLambda.from((input: FollowUpInput) => input.thread).pipe(speakModel),
      bridge: RunnableLambda.from((input: BridgeInput) => input.nextQuestion).pipe(speakModel),
    };
    const run = interview(chains);
    await run.start();

    await run.answer('Bus.');

    expect(run.deltas.length).toBeGreaterThan(1);
    expect(run.deltas.join('')).toBe('Thanks, that helps.');
  });
});
