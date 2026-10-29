import type { EvalItem } from './harness.js';

export interface BriefInput {
  brief: string;
}

export interface BriefExpected {
  /** Topics a good guide must cover, written by hand from the brief. */
  topics: string[];
}

/**
 * Ten briefs across different categories. Some are deliberately hard: a
 * brief that already assumes the answer (b02, b09) tempts the model into
 * leading questions, and briefs that list many topics (b03, b06, b09) test
 * coverage. No real brand is named.
 */
export const BRIEF_ITEMS: Array<EvalItem<BriefInput, BriefExpected>> = [
  {
    id: 'b01-formula',
    input: { brief: 'Why are parents switching infant formula brands? UK mothers 25 to 40.' },
    expectedOutput: {
      topics: ['reasons for switching', 'sources of advice', 'price', "the baby's reaction"],
    },
  },
  {
    id: 'b02-packaging',
    input: {
      brief:
        'We think shoppers love our new plant-based packaging. Confirm that it makes them more likely to buy. Adults 30 to 55 who do a weekly grocery shop.',
    },
    expectedOutput: {
      topics: [
        'noticing the packaging',
        'opinions of plant-based packaging',
        'effect on what they buy',
        'drawbacks such as price or practicality',
      ],
    },
  },
  {
    id: 'b03-delivery-apps',
    input: {
      brief:
        'How do people in their twenties decide which food delivery app to open on a weeknight? Cover price, delivery speed, choice of restaurants and loyalty schemes.',
    },
    expectedOutput: {
      topics: ['price', 'delivery speed', 'choice of restaurants', 'loyalty schemes'],
    },
  },
  {
    id: 'b04-gym-cancel',
    input: {
      brief: 'Understand why gym members cancel within their first three months. Members aged 18 to 45 who cancelled this year.',
    },
    expectedOutput: {
      topics: [
        'why they joined',
        'their first weeks at the gym',
        'reasons for cancelling',
        'what would have kept them',
      ],
    },
  },
  {
    id: 'b05-banking-app',
    input: {
      brief: 'Explore how retired people start using a banking app on a smartphone for the first time.',
    },
    expectedOutput: {
      topics: ['reasons to start', 'setting the app up', 'trust and security', 'where they get help'],
    },
  },
  {
    id: 'b06-refills',
    input: {
      brief:
        'Test reactions to a subscription for refillable household cleaning products. City renters aged 25 to 40. We want to know about current habits, the appeal of refills, worries about subscriptions, expected price and storage space.',
    },
    expectedOutput: {
      topics: [
        'current cleaning product habits',
        'appeal of refills',
        'worries about subscriptions',
        'expected price',
        'storage space',
      ],
    },
  },
  {
    id: 'b07-short-trips',
    input: { brief: 'Why do commuters choose an e-scooter, the bus or walking for trips under 3 km?' },
    expectedOutput: {
      topics: ['typical short trips', 'cost and time', 'weather', 'safety', 'habit'],
    },
  },
  {
    id: 'b08-coffee-pods',
    input: {
      brief: 'Coffee drinkers who stopped buying pods: what made them stop, and what do they use now?',
    },
    expectedOutput: {
      topics: [
        'why they started using pods',
        'reasons for stopping',
        'what they use now',
        'what would bring them back',
      ],
    },
  },
  {
    id: 'b09-fresh-dog-food',
    input: {
      brief:
        "Pet owners will obviously prefer fresh food for their dogs. Find out how they feel about switching to our new home-delivered fresh dog food. Include cost, trust in the ingredients and the vet's opinion.",
    },
    expectedOutput: {
      topics: ['what they feed now', 'appeal of fresh food', 'cost', 'trust in the ingredients', "the vet's opinion"],
    },
  },
  {
    id: 'b10-budgeting',
    input: {
      brief:
        'Young adults and money: how do 18 to 25 year olds keep track of their spending, and what makes them give up on budgeting apps?',
    },
    expectedOutput: {
      topics: [
        'how they track spending',
        'why they want to track it',
        'experience with budgeting apps',
        'reasons for giving up',
      ],
    },
  },
];
