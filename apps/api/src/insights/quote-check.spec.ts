import type { InsightsDraft } from '@probe-lab/shared';
import { checkDraft, checkQuote, type AnswerRef } from './quote-check.js';

const answer = (messageId: string, content: string): AnswerRef => ({
  messageId,
  interviewId: 'interview-1',
  questionKey: 'q1',
  content,
});

const answers = new Map<string, AnswerRef>([
  ['A1', answer('m1', 'Honestly? The price went up twice in a year, and my health visitor said any brand is fine.')],
  ['A2', answer('m2', "I didn't trust the new tin.\nIt looked   cheaper than before.")],
  ['A3', answer('m3', 'We switched because of reflux 😟 and never looked back')],
]);

describe('checkQuote', () => {
  it('accepts an exact excerpt and returns it as the respondent wrote it', () => {
    const result = checkQuote({ ref: 'A1', text: 'the price went up twice in a year' }, answers);
    expect(result).toEqual({
      ok: true,
      quote: { answer: answers.get('A1'), text: 'The price went up twice in a year' },
    });
  });

  it('tolerates the edits models make around a quote', () => {
    const cases = [
      '"The price went up twice in a year."',
      '...the price went up twice in a year...',
      '“the price went up twice in a year”',
    ];
    for (const text of cases) {
      expect(checkQuote({ ref: 'A1', text }, answers).ok).toBe(true);
    }
  });

  it('matches across collapsed whitespace and curly apostrophes', () => {
    const result = checkQuote({ ref: '[a2]', text: 'I didn’t trust the new tin. It looked cheaper' }, answers);
    expect(result.ok && result.quote.text).toBe("I didn't trust the new tin.\nIt looked   cheaper");
  });

  it('keeps an emoji at the end of a quote whole', () => {
    const result = checkQuote({ ref: 'A3', text: 'because of reflux 😟' }, answers);
    expect(result.ok && result.quote.text).toBe('because of reflux 😟');
  });

  it('rejects a reference that does not exist', () => {
    const result = checkQuote({ ref: 'A9', text: 'the price went up' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'unknown_ref' } });
  });

  it('rejects a quote taken from a different answer than the one cited', () => {
    const result = checkQuote({ ref: 'A2', text: 'the price went up twice' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'not_in_answer' } });
  });

  it('rejects a paraphrase', () => {
    const result = checkQuote({ ref: 'A1', text: 'the price rose twice in one year' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'not_in_answer' } });
  });

  it('rejects a quote stitched together with an ellipsis', () => {
    const result = checkQuote({ ref: 'A1', text: 'the price went up ... any brand is fine' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'stitched' } });
  });

  it('rejects part of a word', () => {
    const result = checkQuote({ ref: 'A1', text: 'rice went up' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'not_in_answer' } });
  });

  it('rejects a quote too short to mean anything', () => {
    const result = checkQuote({ ref: 'A1', text: '"Hi."' }, answers);
    expect(result).toMatchObject({ ok: false, rejected: { reason: 'too_short' } });
  });
});

describe('checkDraft', () => {
  const draft: InsightsDraft = {
    overview: 'Price rises and trust in packaging drive switching.',
    themes: [
      {
        title: 'Price rises',
        summary: 'Two respondents mentioned price.',
        quotes: [
          { ref: 'A1', text: 'The price went up twice in a year' },
          { ref: 'A1', text: 'the price went up twice in a year.' },
          { ref: 'A2', text: 'it was too expensive' },
        ],
      },
      {
        title: 'Invented theme',
        summary: 'Nobody said this.',
        quotes: [{ ref: 'A7', text: 'I love the new formula' }],
      },
    ],
  };

  it('keeps checked quotes, drops duplicates and themes left without evidence', () => {
    const result = checkDraft(draft, answers);
    expect(result.themes).toHaveLength(1);
    expect(result.themes[0]!.quotes.map((q) => q.text)).toEqual(['The price went up twice in a year']);
    expect(result.rejected).toEqual([
      { ref: 'A2', text: 'it was too expensive', reason: 'not_in_answer' },
      { ref: 'A7', text: 'I love the new formula', reason: 'unknown_ref' },
    ]);
  });
});
