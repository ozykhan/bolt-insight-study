import type { Decision } from '../src/interviews/moderator/moderator.state.js';
import type { EvalItem } from './harness.js';

export interface ModeratorInput {
  question: { text: string; goal: string };
  /** The exchange on this question so far, ending with the respondent's latest answer. */
  turns: Array<{ role: 'moderator' | 'respondent'; content: string }>;
  /** Follow-ups already asked on this question. */
  followUps: number;
}

export interface ModeratorExpected {
  /** What a good moderator does next. When it is follow_up, the eval also writes and scores a follow-up. */
  action: Decision['action'];
}

type Item = EvalItem<ModeratorInput, ModeratorExpected>;

/** A question that has just been asked and answered once. */
function firstAnswer(id: string, text: string, goal: string, answer: string, action: Decision['action']): Item {
  return {
    id,
    input: {
      question: { text, goal },
      turns: [
        { role: 'moderator', content: text },
        { role: 'respondent', content: answer },
      ],
      followUps: 0,
    },
    expectedOutput: { action },
  };
}

/**
 * Twelve scripted moments in an interview, right after the respondent
 * answers. Seven call for a follow-up (vague, short, or a detail worth
 * exploring, some with emotion that invites a leading probe), three are
 * complete answers, and two are requests to stop.
 */
export const MODERATOR_ITEMS: Item[] = [
  firstAnswer(
    'm01-vague-choice',
    'How did you choose the formula you use now?',
    'Understand how the decision was made and who influenced it.',
    'Just picked one really.',
    'follow_up',
  ),
  firstAnswer(
    'm02-short-weeknight',
    "What do you usually do on a weeknight when you don't feel like cooking?",
    'Understand the weeknight routine and where delivery apps fit in.',
    'Order something.',
    'follow_up',
  ),
  firstAnswer(
    'm03-emotion-banking',
    'How did it go the first time you used the banking app on your own?',
    'Understand the first experience, including any difficulties.',
    "Honestly it was a bit much. I wasn't sure what I was pressing and I closed it in the end.",
    'follow_up',
  ),
  firstAnswer(
    'm04-detail-pods',
    'What made you stop buying coffee pods?',
    'Find the main reasons for stopping.',
    'Mostly the waste thing, and something my sister said.',
    'follow_up',
  ),
  firstAnswer(
    'm05-depends',
    'How do you usually get to places that are less than 3 km away?',
    'Understand the usual way of travelling and why.',
    'Depends on the day.',
    'follow_up',
  ),
  firstAnswer(
    'm06-hedged-refills',
    'What would make a refill subscription worth it for you?',
    'Find the conditions under which they would subscribe.',
    "If it wasn't a hassle, I guess.",
    'follow_up',
  ),
  {
    id: 'm07-still-vague',
    input: {
      question: { text: 'What made you stop buying coffee pods?', goal: 'Find the main reasons for stopping.' },
      turns: [
        { role: 'moderator', content: 'What made you stop buying coffee pods?' },
        { role: 'respondent', content: 'The waste, mostly.' },
        { role: 'moderator', content: 'What about the waste bothered you?' },
        { role: 'respondent', content: 'Just, you know. All of it.' },
      ],
      followUps: 1,
    },
    expectedOutput: { action: 'follow_up' },
  },
  firstAnswer(
    'm08-rich-gym',
    'Tell me about the moment you decided to cancel your gym membership.',
    'Find the trigger for cancelling.',
    "It was in February. The place was packed after New Year, I waited twenty minutes for a squat rack three times in one week, and when I asked about quieter times the staff just shrugged. I was paying for something I couldn't use, so I cancelled that evening.",
    'next',
  ),
  firstAnswer(
    'm09-rich-delivery',
    'How do you decide which delivery app to open?',
    'Understand how the choice between apps is made.',
    "Whichever one has a deal that night. If neither does, I go with the one that shows the delivery time up front, because I won't wait more than 40 minutes on a work night.",
    'next',
  ),
  {
    id: 'm10-nothing-to-add',
    input: {
      question: {
        text: 'Where do you look for advice about feeding your baby?',
        goal: 'Find the sources of advice and how much they are trusted.',
      },
      turns: [
        { role: 'moderator', content: 'Where do you look for advice about feeding your baby?' },
        { role: 'respondent', content: 'The health visitor, and a parents group online.' },
        { role: 'moderator', content: 'How much weight do you give the parents group?' },
        { role: 'respondent', content: 'Less than the health visitor. They mean well but everyone has a theory.' },
        { role: 'moderator', content: 'What makes the health visitor more convincing for you?' },
        { role: 'respondent', content: "She's seen hundreds of babies. That's really all there is to it." },
      ],
      followUps: 2,
    },
    expectedOutput: { action: 'next' },
  },
  firstAnswer(
    'm11-stop-busy',
    'What do you like least about budgeting apps?',
    'Find the main frustrations with budgeting apps.',
    'Sorry, I have to stop now, something came up.',
    'end',
  ),
  firstAnswer(
    'm12-stop-refuse',
    'How do you feel about the price of fresh dog food?',
    'Understand price expectations.',
    "I don't want to answer any more of these.",
    'end',
  ),
];
