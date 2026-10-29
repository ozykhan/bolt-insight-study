import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ANALYTICS_EVENTS,
  type InsightQuoteDto,
  type StudyDetailDto,
  type StudyInsightsDto,
} from '@probe-lab/shared';
import { track } from '../lib/analytics';
import { api } from '../lib/api';

/** The full answer behind a quote, with the quoted words marked. */
function QuoteSource({ quote }: { quote: InsightQuoteDto }) {
  const start = quote.answer.indexOf(quote.text);
  return (
    <details className="quote-source">
      <summary>Show the full answer</summary>
      {quote.question && <p className="muted">Answer to: {quote.question}</p>}
      <p>
        {start === -1 ? (
          quote.answer
        ) : (
          <>
            {quote.answer.slice(0, start)}
            <mark>{quote.text}</mark>
            {quote.answer.slice(start + quote.text.length)}
          </>
        )}
      </p>
    </details>
  );
}

export function InsightsPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<StudyDetailDto | null>(null);
  const [insights, setInsights] = useState<StudyInsightsDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const viewed = useRef<string | null>(null);

  useEffect(() => {
    Promise.all([api.getStudy(id), api.getInsights(id)]).then(
      ([study, result]) => {
        setDetail(study);
        setInsights(result);
      },
      (e: Error) => setError(e.message),
    );
  }, [id]);

  // One event per summary shown. The ref also absorbs React's double effects in development.
  const summary = insights?.summary;
  useEffect(() => {
    if (!summary || viewed.current === summary.id) return;
    viewed.current = summary.id;
    track(ANALYTICS_EVENTS.summaryViewed, id, {
      summary_id: summary.id,
      theme_count: summary.themes.length,
      interview_count: summary.interviewCount,
    });
  }, [id, summary]);

  if (!detail || !insights) {
    return <p className={error ? 'error' : 'muted'}>{error ?? 'Loading...'}</p>;
  }

  const { completed, started } = insights.interviews;

  async function generate() {
    setBusy(true);
    setError(null);
    try {
      setInsights(await api.generateInsights(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="card">
        <p className="muted">
          <Link to={`/studies/${id}`}>{detail.study.title}</Link>
        </p>
        <h1>Interviews and insights</h1>
        <p>
          {started === 0
            ? 'No interviews yet. Share the respondent link from the study page.'
            : `${started} ${started === 1 ? 'interview' : 'interviews'} started, ${completed} completed.`}
        </p>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={generate}
            disabled={busy || completed === 0}
            title={completed === 0 ? 'Summaries use completed interviews only' : undefined}
          >
            {busy ? 'Writing...' : summary ? 'Write a new summary' : 'Write summary with Claude'}
          </button>
          {busy && <span className="muted">This usually takes 20 to 60 seconds.</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </section>

      {summary && (
        <>
          <section className="card">
            <h2>Summary</h2>
            <p>{summary.overview}</p>
            <p className="muted small">
              From {summary.interviewCount} completed{' '}
              {summary.interviewCount === 1 ? 'interview' : 'interviews'} and {summary.answerCount}{' '}
              answers. Every quote below was checked against the answer it came from.
              {summary.rejectedQuoteCount > 0 &&
                ` ${summary.rejectedQuoteCount} ${summary.rejectedQuoteCount === 1 ? 'quote' : 'quotes'} that did not match an answer word for word ${summary.rejectedQuoteCount === 1 ? 'was' : 'were'} left out.`}
            </p>
          </section>

          {summary.themes.map((theme, index) => (
            <section key={`${index}-${theme.title}`} className="card theme">
              <h2>{theme.title}</h2>
              <p>{theme.summary}</p>
              <ul className="quotes">
                {theme.quotes.map((quote) => (
                  <li key={`${quote.messageId}-${quote.text}`}>
                    <blockquote>{quote.text}</blockquote>
                    <QuoteSource quote={quote} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </>
  );
}
