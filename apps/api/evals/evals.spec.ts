import { ChatAnthropic } from '@langchain/anthropic';
import type { QuestionnaireDraft } from '@probe-lab/shared';
import { BRIEF_ITEMS } from './brief-expansion.dataset.js';
import {
  briefExpansionSuite,
  coverageScore,
  distinctScore,
  nonLeadingScore,
} from './brief-expansion.suite.js';
import { aggregate, UsageTracker, type EvalContext, type RunRecord } from './harness.js';
import { MODERATOR_ITEMS } from './moderator.dataset.js';
import { moderatorSuite, singleQuestionScore } from './moderator.suite.js';
import { renderReport, replaceBetweenMarkers } from './report.js';

const draft = (count: number): QuestionnaireDraft => ({
  title: 'Test',
  audience: 'Adults',
  topics: ['price', 'advice'],
  questions: Array.from({ length: count }, (_, i) => ({ text: `Question number ${i + 1}?`, goal: 'A goal.' })),
});

describe('eval datasets', () => {
  it('has ten briefs and twelve moderator moments with unique ids', () => {
    expect(BRIEF_ITEMS).toHaveLength(10);
    expect(MODERATOR_ITEMS).toHaveLength(12);
    const ids = [...BRIEF_ITEMS, ...MODERATOR_ITEMS].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ends every moderator moment on a respondent answer', () => {
    for (const item of MODERATOR_ITEMS) {
      expect(item.input.turns.at(-1)?.role).toBe('respondent');
      const asked = item.input.turns.filter((t) => t.role === 'moderator').length;
      expect(item.input.followUps).toBe(asked - 1);
    }
  });
});

describe('brief expansion scores', () => {
  it('scores leading questions and ignores verdicts for questions that do not exist', () => {
    const result = nonLeadingScore(draft(8), {
      questions: [
        { number: 2, leading: true, reason: 'Assumes they liked it.' },
        { number: 3, leading: false, reason: 'Neutral.' },
        { number: 12, leading: true, reason: 'Out of range.' },
      ],
      duplicates: [],
    });
    expect(result).toMatchObject({ name: 'questions_non_leading', value: 7 / 8 });
    expect(result.comment).toBe('Q2: Assumes they liked it.');
  });

  it('counts the later question of each duplicate pair once', () => {
    const result = distinctScore(draft(8), {
      questions: [],
      duplicates: [
        { first: 1, second: 4, reason: 'Same thing.' },
        { first: 2, second: 4, reason: 'Same again.' },
        { first: 5, second: 5, reason: 'A question cannot duplicate itself.' },
      ],
    });
    expect(result.value).toBe(7 / 8);
  });

  it('scores coverage by topic number', () => {
    const result = coverageScore(
      { topics: ['price', 'speed', 'choice', 'loyalty'] },
      {
        topics: [
          { number: 1, covered: true, questions: [2] },
          { number: 2, covered: false, questions: [] },
          { number: 3, covered: true, questions: [4, 5] },
          { number: 4, covered: true, questions: [6] },
        ],
      },
    );
    expect(result).toMatchObject({ name: 'topic_coverage', value: 0.75, comment: 'Missed: speed.' });
  });
});

describe('moderator scores', () => {
  it('wants exactly one short question', () => {
    expect(singleQuestionScore('What made you pick that one?').value).toBe(1);
    expect(singleQuestionScore('Why? And when?').value).toBe(0);
    expect(singleQuestionScore('Tell me more.').value).toBe(0);
  });
});

/**
 * A real ChatAnthropic with a fake HTTP client that answers by request type,
 * so the suites run end to end (prompt loading, chains, judges, evaluators)
 * without an API key.
 */
function fakeModel(requests: Array<Record<string, unknown>>) {
  const reply = (request: Record<string, unknown>): unknown => {
    const format = (request.output_config as { format?: { schema: { properties: Record<string, unknown> } } })?.format;
    const fields = Object.keys(format?.schema.properties ?? {});
    if (fields.includes('action')) return { action: 'follow_up', reason: 'The answer is vague.' };
    if (fields.includes('grounded')) {
      return { grounded: true, groundedReason: 'Picks up "picked".', leading: false, leadingReason: 'Neutral.' };
    }
    if (fields.includes('duplicates')) {
      return { questions: [{ number: 1, leading: true, reason: 'Presumes an answer.' }], duplicates: [] };
    }
    if (fields.includes('topics') && !fields.includes('title')) {
      return { topics: [{ number: 1, covered: true, questions: [1] }] };
    }
    if (fields.includes('title')) return draft(6);
    return 'What made you pick that one?';
  };
  const create = async (request: Record<string, unknown>) => {
    requests.push(request);
    const body = reply(request);
    return {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 100, output_tokens: 20 },
    };
  };
  return new ChatAnthropic({
    model: 'test-model',
    createClient: () => ({ messages: { create }, beta: { messages: { create } } }),
  });
}

function fakeContext(variant: 'v1' | 'v2', requests: Array<Record<string, unknown>>): EvalContext {
  return { variant, langfuse: null, model: () => fakeModel(requests), judgeCallbacks: () => [] };
}

const systemText = (request: Record<string, unknown>) => JSON.stringify(request.system ?? '');

describe('suites, run end to end against a fake model', () => {
  it('moderator: decides, writes a follow-up with the v2 prompt, and scores it', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const prepared = await moderatorSuite.prepare(fakeContext('v2', requests));
    const item = MODERATOR_ITEMS[0]!;
    const tracker = new UsageTracker();

    const output = await prepared.task(item, [tracker]);
    expect(output).toEqual({
      decision: { action: 'follow_up', reason: 'The answer is vague.' },
      followUp: 'What made you pick that one?',
    });
    expect(tracker.outputTokens).toBe(40);
    expect(prepared.promptSources).toEqual(['moderator-decide@repo:v2', 'moderator-follow-up@repo:v2']);
    expect(requests.some((r) => systemText(r).includes('Build it on one specific thing'))).toBe(true);

    const scores = (
      await Promise.all(prepared.evaluators.map((e) => e({ input: item.input, output, expectedOutput: item.expectedOutput })))
    ).flat();
    expect(Object.fromEntries(scores.map((s) => [s.name, s.value]))).toEqual({
      decision_correct: 1,
      follow_up_grounded: 1,
      follow_up_non_leading: 1,
      follow_up_single_question: 1,
    });
  });

  it('moderator: skips the follow-up and its scores when the right move is to go on', async () => {
    const prepared = await moderatorSuite.prepare(fakeContext('v1', []));
    const item = MODERATOR_ITEMS.find((i) => i.expectedOutput.action === 'next')!;
    const output = await prepared.task(item, []);
    expect(output.followUp).toBeNull();
    const scores = (
      await Promise.all(prepared.evaluators.map((e) => e({ input: item.input, output, expectedOutput: item.expectedOutput })))
    ).flat();
    expect(scores.map((s) => [s.name, s.value])).toEqual([['decision_correct', 0]]);
  });

  it('brief expansion: drafts with the chosen variant and scores the draft', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const prepared = await briefExpansionSuite.prepare(fakeContext('v2', requests));
    const item = BRIEF_ITEMS[0]!;
    const output = await prepared.task(item, []);
    expect(output.questions).toHaveLength(6);
    expect(systemText(requests[0]!)).toContain('rather than');

    const scores = (
      await Promise.all(prepared.evaluators.map((e) => e({ input: item.input, output, expectedOutput: item.expectedOutput })))
    ).flat();
    expect(Object.fromEntries(scores.map((s) => [s.name, s.value]))).toEqual({
      questions_non_leading: 5 / 6,
      questions_distinct: 1,
      topic_coverage: 1 / 4,
    });
  });
});

describe('results', () => {
  const record = (variant: 'v1' | 'v2', grounded: number[], seconds: number): RunRecord => {
    const items = grounded.map((value, i) => ({
      id: `m${i}`,
      scores: { follow_up_grounded: value, decision_correct: 1 },
      comments: {},
      latencySeconds: seconds,
      inputTokens: 1000,
      outputTokens: 200 + i,
      output: null,
    }));
    return {
      suite: 'moderator',
      variant,
      ranAt: '2026-10-30T10:00:00.000Z',
      runName: `moderator-${variant}`,
      experimentUrl: null,
      model: 'test-model',
      promptSources: [`moderator-follow-up@langfuse:${variant === 'v1' ? 1 : 2}`],
      itemCount: grounded.length,
      failedItems: [],
      ...aggregate(items),
      items,
    };
  };

  it('averages each score over the items that have it', () => {
    const result = aggregate([
      { id: 'a', scores: { x: 1, y: 0 }, comments: {}, latencySeconds: 2, inputTokens: 10, outputTokens: 4, output: null },
      { id: 'b', scores: { x: 0 }, comments: {}, latencySeconds: 4, inputTokens: 30, outputTokens: 6, output: null },
    ]);
    expect(result).toEqual({
      scores: { x: { mean: 0.5, n: 2 }, y: { mean: 0, n: 1 } },
      latencySeconds: 3,
      inputTokens: 20,
      outputTokens: 5,
    });
  });

  it('renders a before and after table', () => {
    const table = renderReport(
      [{ name: 'moderator', title: 'Moderator', scores: moderatorSuite.scores }],
      [record('v1', [1, 0, 0, 1], 2.04), record('v2', [1, 1, 1, 0], 2.5)],
    );
    expect(table).toContain('**Moderator**: 4 items, run on 2026-10-30 with test-model');
    expect(table).toContain('| Follow-ups grounded in the answer | 4 | 50% | 75% | +25 pts |');
    expect(table).toContain('| Decision matches the label | 4 | 100% | 100% | 0 |');
    expect(table).toContain('| Follow-ups not leading | 0 | not run | not run |  |');
    expect(table).toContain('| Seconds per item | 4 | 2.0 | 2.5 | +0.5 |');
  });

  it('replaces only the text between the markers', () => {
    const readme = 'Intro\n<!-- eval-results:start -->\nold\n<!-- eval-results:end -->\nOutro';
    expect(replaceBetweenMarkers(readme, 'new')).toBe(
      'Intro\n<!-- eval-results:start -->\nnew\n<!-- eval-results:end -->\nOutro',
    );
  });
});
