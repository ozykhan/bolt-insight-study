/**
 * The product funnel, in order. Browser events are sent by posthog-js and
 * server events by posthog-node, with the same distinct id.
 */
export const ANALYTICS_EVENTS = {
  /** Browser: the client submitted a brief and the study was created. */
  briefSubmitted: 'brief_submitted',
  /** Server: Claude drafted a questionnaire. */
  questionnaireGenerated: 'questionnaire_generated',
  /** Server: the client saved changes to the questionnaire. */
  questionnaireEdited: 'questionnaire_edited',
  /** Server: the study went live. */
  studyLaunched: 'study_launched',
  /** Server: a respondent opened the study link and an interview was created. */
  interviewStarted: 'interview_started',
  /** Server: the moderator closed the interview. */
  interviewCompleted: 'interview_completed',
  /** Browser: the client opened the insights summary. */
  summaryViewed: 'summary_viewed',
} as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[keyof typeof ANALYTICS_EVENTS];

/** REST calls carry the browser's PostHog distinct id in this header. */
export const DISTINCT_ID_HEADER = 'x-posthog-distinct-id';

/** PostHog group type for studies, so events can be grouped per study. */
export const STUDY_GROUP = 'study';
