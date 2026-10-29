import { describe, expect, it } from 'vitest';
import {
  QuestionnaireDraftSchema,
  QuestionnaireUpdateSchema,
  assignQuestionKeys,
} from './questionnaire.js';

const question = (n: number) => ({
  text: `What made you first think about question number ${n}?`,
  goal: `Understand trigger ${n}`,
});

const draft = (questionCount: number) => ({
  title: 'Infant formula switching',
  audience: 'UK mothers aged 25 to 40',
  topics: ['reasons for switching', 'information sources'],
  questions: Array.from({ length: questionCount }, (_, i) => question(i + 1)),
});

describe('QuestionnaireDraftSchema', () => {
  it('accepts 6 to 10 questions', () => {
    expect(QuestionnaireDraftSchema.safeParse(draft(6)).success).toBe(true);
    expect(QuestionnaireDraftSchema.safeParse(draft(10)).success).toBe(true);
  });

  it('rejects fewer than 6 or more than 10 questions', () => {
    expect(QuestionnaireDraftSchema.safeParse(draft(5)).success).toBe(false);
    expect(QuestionnaireDraftSchema.safeParse(draft(11)).success).toBe(false);
  });

  it('rejects a question without a goal', () => {
    const bad = draft(6);
    bad.questions[2] = { ...bad.questions[2], goal: '' };
    const result = QuestionnaireDraftSchema.safeParse(bad);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['questions', 2, 'goal']);
  });

  it('rejects a brief restatement with no topics', () => {
    expect(QuestionnaireDraftSchema.safeParse({ ...draft(6), topics: [] }).success).toBe(false);
  });
});

describe('QuestionnaireUpdateSchema', () => {
  it('lets the client go below 6 questions but not to zero', () => {
    const base = { title: 'Formula study', audience: 'Parents', topics: [] };
    expect(
      QuestionnaireUpdateSchema.safeParse({ ...base, questions: [question(1)] }).success,
    ).toBe(true);
    expect(QuestionnaireUpdateSchema.safeParse({ ...base, questions: [] }).success).toBe(false);
  });

  it('trims whitespace the editor leaves behind', () => {
    const parsed = QuestionnaireUpdateSchema.parse({
      title: '  Formula study  ',
      audience: 'Parents',
      topics: [],
      questions: [{ ...question(1), goal: '  Understand triggers  ' }],
    });
    expect(parsed.title).toBe('Formula study');
    expect(parsed.questions[0]?.goal).toBe('Understand triggers');
  });

  it('rejects malformed question keys', () => {
    const result = QuestionnaireUpdateSchema.safeParse({
      title: 'Formula study',
      audience: 'Parents',
      topics: [],
      questions: [{ ...question(1), key: 'first' }],
    });
    expect(result.success).toBe(false);
  });
});

describe('assignQuestionKeys', () => {
  it('numbers a fresh list from q1', () => {
    const keys = assignQuestionKeys([question(1), question(2), question(3)]).map((q) => q.key);
    expect(keys).toEqual(['q1', 'q2', 'q3']);
  });

  it('keeps existing keys when questions are reordered', () => {
    const keys = assignQuestionKeys([
      { key: 'q3', ...question(3) },
      { key: 'q1', ...question(1) },
    ]).map((q) => q.key);
    expect(keys).toEqual(['q3', 'q1']);
  });

  it('gives new questions a key above the highest existing one, even after deletions', () => {
    const keys = assignQuestionKeys([
      { key: 'q1', ...question(1) },
      { key: 'q4', ...question(4) },
      question(5),
    ]).map((q) => q.key);
    expect(keys).toEqual(['q1', 'q4', 'q5']);
  });

  it('re-keys a duplicated key instead of letting two questions share it', () => {
    const keys = assignQuestionKeys([
      { key: 'q2', ...question(1) },
      { key: 'q2', ...question(2) },
    ]).map((q) => q.key);
    expect(keys).toEqual(['q2', 'q3']);
  });
});
