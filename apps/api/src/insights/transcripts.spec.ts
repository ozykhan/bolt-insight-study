import type { Question } from '@probe-lab/shared';
import { formatAnswers, type Transcript, type TranscriptMessage } from './transcripts.js';

const questions: Question[] = [
  { key: 'q1', text: 'How did you choose your current formula?', goal: 'Understand the decision.' },
  { key: 'q2', text: 'What would make you switch again?', goal: 'Find switching triggers.' },
];

let seq = 0;
const msg = (partial: Omit<TranscriptMessage, 'id'>): TranscriptMessage => ({ id: `m${++seq}`, ...partial });

const transcripts: Transcript[] = [
  {
    interviewId: 'i1',
    messages: [
      msg({ role: 'moderator', kind: 'question', questionKey: 'q1', followUpIndex: 0, content: 'Hi...\n\nHow did you choose?' }),
      msg({ role: 'respondent', kind: 'answer', questionKey: 'q1', followUpIndex: 0, content: 'My sister\nrecommended it.' }),
      msg({ role: 'moderator', kind: 'follow_up', questionKey: 'q1', followUpIndex: 1, content: 'What did she say about it?' }),
      msg({ role: 'respondent', kind: 'answer', questionKey: 'q1', followUpIndex: 1, content: 'That it was gentle.' }),
      msg({ role: 'moderator', kind: 'closing', questionKey: null, followUpIndex: 0, content: 'Thanks!' }),
    ],
  },
  {
    interviewId: 'i2',
    messages: [
      msg({ role: 'moderator', kind: 'question', questionKey: 'q1', followUpIndex: 0, content: 'How did you choose?' }),
      msg({ role: 'respondent', kind: 'answer', questionKey: 'q1', followUpIndex: 0, content: 'Price.' }),
    ],
  },
];

describe('formatAnswers', () => {
  it('groups answers by question with references, respondents and follow-up context', () => {
    const { text } = formatAnswers(questions, transcripts);
    expect(text).toBe(
      [
        'Q1. How did you choose your current formula?',
        'Goal: Understand the decision.',
        '[A1] Respondent 1: My sister recommended it.',
        '[A2] Respondent 1, asked "What did she say about it?": That it was gentle.',
        '[A3] Respondent 2: Price.',
        '',
        'Q2. What would make you switch again?',
        'Goal: Find switching triggers.',
        '(no answers)',
      ].join('\n'),
    );
  });

  it('maps each reference back to the original message', () => {
    const { answers } = formatAnswers(questions, transcripts);
    expect([...answers.keys()]).toEqual(['A1', 'A2', 'A3']);
    expect(answers.get('A1')).toEqual({
      messageId: 'm2',
      interviewId: 'i1',
      questionKey: 'q1',
      content: 'My sister\nrecommended it.',
    });
    expect(answers.get('A3')?.interviewId).toBe('i2');
  });

  it('never offers moderator messages as answers', () => {
    const { answers } = formatAnswers(questions, transcripts);
    const offered = [...answers.values()].map((a) => a.messageId);
    expect(offered).not.toContain('m1');
    expect(offered).not.toContain('m3');
  });
});
