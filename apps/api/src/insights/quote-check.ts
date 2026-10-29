import type { InsightsDraft } from '@probe-lab/shared';

/** A respondent answer the model may quote, keyed in the prompt by a reference such as `A12`. */
export interface AnswerRef {
  messageId: string;
  interviewId: string;
  questionKey: string | null;
  content: string;
}

export type RejectReason = 'unknown_ref' | 'stitched' | 'too_short' | 'not_in_answer';

export interface CheckedQuote {
  answer: AnswerRef;
  /** The quote exactly as it appears in the answer, with the respondent's own casing and punctuation. */
  text: string;
}

export interface RejectedQuote {
  ref: string;
  text: string;
  reason: RejectReason;
}

export interface CheckedTheme {
  title: string;
  summary: string;
  quotes: CheckedQuote[];
}

export interface CheckedDraft {
  overview: string;
  /** Themes with at least one quote that checked out. A theme left with none is dropped. */
  themes: CheckedTheme[];
  rejected: RejectedQuote[];
}

/** Typographic characters a model tends to swap for plain ones, or the other way round. */
const EQUIVALENT: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201A': "'",
  '\u201B': "'",
  '\u2032': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u201E': '"',
  '\u2033': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2212': '-',
};

/**
 * Lowercases, unifies quote marks and dashes, and collapses whitespace, while
 * remembering where each character came from so a match can be cut out of the
 * original text.
 */
function normalize(source: string): { text: string; from: number[] } {
  let text = '';
  const from: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < source.length; i++) {
    const char = EQUIVALENT[source[i]!] ?? source[i]!;
    if (/\s/.test(char)) {
      pendingSpace = text.length > 0;
      continue;
    }
    if (pendingSpace) {
      text += ' ';
      from.push(i - 1);
      pendingSpace = false;
    }
    for (const lower of char.toLowerCase()) {
      text += lower;
      from.push(i);
    }
  }
  return { text, from };
}

const WRAPPING = /^["'\u2018\u2019\u201C\u201D\s]+|["'\u2018\u2019\u201C\u201D\s]+$/g;
const EDGE_ELLIPSIS = /^(\.{3}|\u2026)\s*|\s*(\.{3}|\u2026)$/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Strips what a model adds around a quote: quote marks, ellipses at the ends, final punctuation. */
function cleanQuote(text: string): string {
  let current = text;
  let previous: string;
  do {
    previous = current;
    current = current.replace(WRAPPING, '').replace(EDGE_ELLIPSIS, '').replace(TRAILING_PUNCTUATION, '');
  } while (current !== previous);
  return current;
}

/** Finds the quote in the answer, starting and ending on word boundaries. */
function findWholeWords(haystack: string, needle: string): number {
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    const startsClean = before === undefined || !WORD_CHAR.test(before) || !WORD_CHAR.test(needle[0]!);
    const endsClean = after === undefined || !WORD_CHAR.test(after) || !WORD_CHAR.test(needle.at(-1)!);
    if (startsClean && endsClean) return index;
    index = haystack.indexOf(needle, index + 1);
  }
  return -1;
}

/** Accepts `A12`, `[A12]` or `a12`. */
function normalizeRef(ref: string): string {
  return ref.replace(/[[\]\s]/g, '').toUpperCase();
}

/**
 * Checks one quote against the answer it claims to come from. A quote passes
 * only if it is a contiguous run of whole words from that answer, ignoring
 * case, whitespace and curly versus straight quote marks. It is returned as
 * the respondent wrote it, not as the model retyped it.
 */
export function checkQuote(
  quote: { ref: string; text: string },
  answers: ReadonlyMap<string, AnswerRef>,
): { ok: true; quote: CheckedQuote } | { ok: false; rejected: RejectedQuote } {
  const reject = (reason: RejectReason) => ({ ok: false as const, rejected: { ...quote, reason } });

  const answer = answers.get(normalizeRef(quote.ref));
  if (!answer) return reject('unknown_ref');

  const cleaned = cleanQuote(quote.text.trim());
  if (/\.{3}|\u2026/.test(cleaned)) return reject('stitched');

  const needle = normalize(cleaned).text;
  if (needle.length < 3) return reject('too_short');

  const haystack = normalize(answer.content);
  const start = findWholeWords(haystack.text, needle);
  if (start === -1) return reject('not_in_answer');

  const first = haystack.from[start]!;
  let last = haystack.from[start + needle.length - 1]!;
  // Keep a surrogate pair (an emoji, say) whole.
  if (/[\uD800-\uDBFF]/.test(answer.content[last]!)) last += 1;
  return { ok: true, quote: { answer, text: answer.content.slice(first, last + 1) } };
}

/**
 * Checks every quote in a summary draft. Rejected quotes are dropped and
 * reported, duplicates within a theme are dropped, and a theme with no quote
 * left is dropped, because a theme without evidence is not a finding.
 */
export function checkDraft(draft: InsightsDraft, answers: ReadonlyMap<string, AnswerRef>): CheckedDraft {
  const rejected: RejectedQuote[] = [];
  const themes: CheckedTheme[] = [];

  for (const theme of draft.themes) {
    const quotes: CheckedQuote[] = [];
    for (const candidate of theme.quotes) {
      const result = checkQuote(candidate, answers);
      if (!result.ok) {
        rejected.push(result.rejected);
        continue;
      }
      const duplicate = quotes.some(
        (q) => q.answer.messageId === result.quote.answer.messageId && q.text === result.quote.text,
      );
      if (!duplicate) quotes.push(result.quote);
    }
    if (quotes.length > 0) {
      themes.push({ title: theme.title, summary: theme.summary, quotes });
    }
  }

  return { overview: draft.overview, themes, rejected };
}
