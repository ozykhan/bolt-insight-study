import posthog from 'posthog-js';
import { STUDY_GROUP, type AnalyticsEvent } from '@probe-lab/shared';

const key = import.meta.env.POSTHOG_PROJECT_KEY;
const enabled = Boolean(key);

if (key) {
  posthog.init(key, {
    api_host: import.meta.env.POSTHOG_HOST || 'https://us.i.posthog.com',
    // Opt in to PostHog's recommended defaults as of this date.
    defaults: '2026-08-30',
    // The server sends events for this same distinct id, and those always
    // create a person. Processing browser events as a person too keeps the
    // whole funnel on one person.
    person_profiles: 'always',
  });
}

const FALLBACK_KEY = 'probe-lab-distinct-id';

/**
 * The id that ties browser events, server events and the respondent's
 * interview together. posthog-js owns it when PostHog is configured; without
 * a key a random id is kept in localStorage so interviews still resume.
 */
export function distinctId(): string {
  if (enabled) return posthog.get_distinct_id();
  let id = localStorage.getItem(FALLBACK_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(FALLBACK_KEY, id);
  }
  return id;
}

/** Sends a browser-side funnel event, grouped by study like the server's events. */
export function track(event: AnalyticsEvent, studyId: string, properties: Record<string, unknown> = {}) {
  if (!enabled) return;
  posthog.capture(event, { ...properties, study_id: studyId, $groups: { [STUDY_GROUP]: studyId } });
}
