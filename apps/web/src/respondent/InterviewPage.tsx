import { useParams } from 'react-router';

/** The respondent chat arrives on Day 2 with the moderator graph and Socket.io. */
export function InterviewPage() {
  const { studyId } = useParams<{ studyId: string }>();
  return (
    <div className="respondent">
      <div className="card">
        <h1>Thanks for taking part</h1>
        <p className="muted">
          The interview chat for study {studyId} is not built yet. It comes next, with the AI
          moderator.
        </p>
      </div>
    </div>
  );
}
