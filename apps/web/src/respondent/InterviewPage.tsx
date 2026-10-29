import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import { useInterview } from './useInterview';

export function InterviewPage() {
  const { studyId = '' } = useParams<{ studyId: string }>();
  const interview = useInterview(studyId);
  const [answer, setAnswer] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view, including while the reply streams.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [interview.messages.length, interview.draft]);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    const text = answer.trim();
    if (!text || !interview.canAnswer) return;
    if (await interview.send(text)) setAnswer('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const { progress, status } = interview;
  const waiting =
    status === 'in_progress' && !interview.canAnswer && interview.draft === null && !interview.error;

  return (
    <div className="respondent">
      <header className="chat-header">
        <div>
          <p className="muted">Probe Lab interview</p>
          <h1>{interview.studyTitle ?? 'Loading...'}</h1>
        </div>
        {progress && status === 'in_progress' && (
          <span className="muted">
            Question {progress.questionIndex + 1} of {progress.total}
          </span>
        )}
      </header>

      <div className="chat" aria-live="polite">
        {interview.messages.map((message) => (
          <div key={message.id} className={`bubble bubble-${message.role}`}>
            {message.content}
          </div>
        ))}
        {interview.draft !== null && (
          <div className="bubble bubble-moderator">{interview.draft || '...'}</div>
        )}
        {waiting && <div className="bubble bubble-moderator typing">...</div>}
        <div ref={endRef} />
      </div>

      {interview.error && (
        <div className="callout callout-error">
          <span>{interview.error}</span>
          <button type="button" className="chip" onClick={interview.retry}>
            Try again
          </button>
        </div>
      )}

      {status === 'completed' ? (
        <p className="card done">Thank you, the interview is complete. You can close this page.</p>
      ) : (
        <form className="composer" onSubmit={submit}>
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            maxLength={2000}
            placeholder={interview.canAnswer ? 'Type your answer' : 'Waiting for the moderator...'}
            disabled={!interview.connected || status !== 'in_progress'}
          />
          <button type="submit" className="primary" disabled={!interview.canAnswer || !answer.trim()}>
            {interview.sending ? 'Sending...' : 'Send'}
          </button>
        </form>
      )}
      {!interview.connected && status !== 'completed' && (
        <p className="muted">Connecting...</p>
      )}
    </div>
  );
}
