import { useEffect, useState } from 'react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { LmsAssignment } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function LmsAssignments() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const isStudent = user?.role === 'student';

  const [assignments, setAssignments] = useState<LmsAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');
  const [drafts, setDrafts] = useState<Record<string, { submission_text: string; attachment_url: string }>>({});

  useEffect(() => {
    if (!canRunRequests) return;
    void loadAssignments();
  }, [canRunRequests]);

  const loadAssignments = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await apiService.listLmsAssignments();
      setAssignments(response.data || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Assignments load nahi hue.'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (assignmentId: string) => {
    try {
      setSavingId(assignmentId);
      await apiService.submitLmsAssignment(assignmentId, drafts[assignmentId] || {});
      setBanner('Assignment submit ho gaya.');
      await loadAssignments();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Assignment submit nahi hua.'));
    } finally {
      setSavingId('');
    }
  };

  if (loading) {
    return <LoadingSpinner message="Assignments load ho rahe hain..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Assignments</h1>
        <p className="mt-1 text-sm text-slate-600">Submission tracking, downloadable briefs, aur completion view.</p>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      {!assignments.length ? (
        <section className={`${cardClass} text-center`}>
          <h2 className="text-lg font-semibold text-slate-900">No assignments available</h2>
          <p className="mt-2 text-sm text-slate-600">Teacher assignment publish karega to yahan show hoga.</p>
        </section>
      ) : (
        <section className="grid gap-5 xl:grid-cols-2">
          {assignments.map((assignment) => (
            <article key={assignment.id} className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{assignment.title}</h2>
                  <p className="mt-2 text-sm text-slate-600">{assignment.description || 'No assignment description.'}</p>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold capitalize text-slate-600">{assignment.status}</span>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Due</p><p className="mt-2 text-sm font-semibold text-slate-900">{assignment.due_at ? new Date(assignment.due_at).toLocaleString() : 'No deadline'}</p></div>
                <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs uppercase tracking-[0.16em] text-slate-500">Submissions</p><p className="mt-2 text-sm font-semibold text-slate-900">{assignment.submission_count}</p></div>
              </div>

              {assignment.attachment_url ? (
                <a href={assignment.attachment_url} target="_blank" rel="noreferrer" className="mt-4 inline-flex rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Open Brief
                </a>
              ) : null}

              {isStudent ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Your Submission</p>
                  <textarea
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                    rows={3}
                    placeholder="Submission text"
                    value={drafts[assignment.id]?.submission_text || assignment.submission?.submission_text || ''}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [assignment.id]: { submission_text: e.target.value, attachment_url: current[assignment.id]?.attachment_url || assignment.submission?.attachment_url || '' },
                      }))
                    }
                  />
                  <input
                    className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm"
                    placeholder="Attachment URL"
                    value={drafts[assignment.id]?.attachment_url || assignment.submission?.attachment_url || ''}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [assignment.id]: { submission_text: current[assignment.id]?.submission_text || assignment.submission?.submission_text || '', attachment_url: e.target.value },
                      }))
                    }
                  />
                  <button onClick={() => void handleSubmit(assignment.id)} disabled={savingId === assignment.id} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70">
                    {savingId === assignment.id ? 'Submitting...' : assignment.submission ? 'Update Submission' : 'Submit Assignment'}
                  </button>
                  {assignment.submission ? (
                    <p className="text-xs text-slate-500">
                      Status: {assignment.submission.status}
                      {assignment.submission.score_awarded !== null && assignment.submission.score_awarded !== undefined ? ` | Score: ${assignment.submission.score_awarded}` : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
