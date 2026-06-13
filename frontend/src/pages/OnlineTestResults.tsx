import { useEffect, useMemo, useState } from 'react';
import { Award, BarChart3, CheckCircle2, CircleOff, Target } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { OnlineTest, OnlineTestAnalytics, OnlineTestResult } from '@types';
import { onlineTestCardClass } from '@pages/onlineTestsShared';

type ResultStatCard = {
  label: string;
  value: string | number;
  icon: typeof Award;
};

export default function OnlineTestResults() {
  const navigate = useNavigate();
  const { id = '' } = useParams();
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const canViewAnalytics = user?.role === 'admin';

  const [result, setResult] = useState<OnlineTestResult | null>(null);
  const [test, setTest] = useState<OnlineTest | null>(null);
  const [peerResults, setPeerResults] = useState<OnlineTestResult[]>([]);
  const [analytics, setAnalytics] = useState<OnlineTestAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canRunRequests || !id) return;
    void loadPage();
  }, [canRunRequests, id]);

  const percentileText = useMemo(() => {
    if (!result?.percentage && result?.percentage !== 0) return 'Not published';
    if (result.percentage >= 85) return 'Outstanding performance';
    if (result.percentage >= 60) return 'On track';
    return 'Needs follow-up';
  }, [result?.percentage]);

  const statCards: ResultStatCard[] = result
    ? [
        { label: 'Score', value: `${result.score_obtained}/${result.max_score}`, icon: Award },
        { label: 'Percentage', value: `${result.percentage || 0}%`, icon: Target },
        { label: 'Correct', value: result.correct_answers, icon: CheckCircle2 },
        { label: 'Unanswered', value: result.unanswered_questions, icon: CircleOff },
      ]
    : [];

  const loadPage = async () => {
    try {
      setLoading(true);
      setError('');
      const resultResponse = await apiService.getOnlineTestResult(id);
      setResult(resultResponse.data);

      const nextRequests: Promise<unknown>[] = [apiService.getOnlineTest(resultResponse.data.test_id)];
      if (canViewAnalytics) {
        nextRequests.push(apiService.listOnlineTestResults({ test_id: resultResponse.data.test_id }));
        nextRequests.push(apiService.getOnlineTestAnalytics({ test_id: resultResponse.data.test_id }));
      }

      const responses = await Promise.all(nextRequests);
      setTest((responses[0] as Awaited<ReturnType<typeof apiService.getOnlineTest>>).data);

      if (canViewAnalytics) {
        setPeerResults((responses[1] as Awaited<ReturnType<typeof apiService.listOnlineTestResults>>).data || []);
        setAnalytics((responses[2] as Awaited<ReturnType<typeof apiService.getOnlineTestAnalytics>>).data || null);
      } else {
        setPeerResults([]);
        setAnalytics(null);
      }
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Online test result load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Online test result load ho raha hai..." />;
  }

  if (!result || !test) {
    return (
      <div className="p-4 md:p-6">
        <Alert type="error" message={error || 'Result not found.'} />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <button
            type="button"
            onClick={() => navigate('/online-tests')}
            className="mb-3 text-sm font-semibold text-slate-600 hover:text-slate-900"
          >
            Back to Online Tests
          </button>
          <h1 className="text-2xl font-bold text-slate-900">{test.title} Result</h1>
          <p className="mt-1 text-sm text-slate-600">Attempt #{result.attempt_id.slice(0, 8)} | {percentileText}</p>
        </div>
      </div>

      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon }) => (
          <section key={label} className={`${onlineTestCardClass} p-5`}>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-blue-100 p-3 text-blue-700">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500">{label}</p>
                <p className="text-2xl font-bold text-slate-900">{value}</p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className={`${onlineTestCardClass} mb-6 p-5`}>
        <h2 className="text-lg font-semibold text-slate-900">Performance Breakdown</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            ['Attempted Questions', result.attempted_questions],
            ['Incorrect Answers', result.incorrect_answers],
            ['Rank in Batch', result.rank_in_batch ?? 'Pending'],
            ['Rank in School', result.rank_in_school ?? 'Pending'],
            ['Published', result.published_at ? new Date(result.published_at).toLocaleString() : 'Pending'],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {canViewAnalytics && analytics ? (
        <section className={`${onlineTestCardClass} mb-6 p-5`}>
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">Admin Analytics</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Attempts', analytics.total_attempts],
              ['Completed', analytics.completed_attempts],
              ['Evaluated', analytics.evaluated_results],
              ['Average Score', analytics.average_score],
              ['Average %', analytics.average_percentage],
              ['Published', analytics.published_results],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-2 text-lg font-bold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canViewAnalytics ? (
        <section className={`${onlineTestCardClass} p-5`}>
          <h2 className="text-lg font-semibold text-slate-900">Peer Result Snapshot</h2>
          {!peerResults.length ? (
            <p className="mt-3 text-sm text-slate-600">No result rows available for this test yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Result ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Percentage</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Correct</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {peerResults.map((peerResult) => (
                    <tr key={peerResult.id}>
                      <td className="px-4 py-3 text-sm text-slate-700">{peerResult.id.slice(0, 8)}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{peerResult.score_obtained}/{peerResult.max_score}</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{peerResult.percentage || 0}%</td>
                      <td className="px-4 py-3 text-sm text-slate-700">{peerResult.correct_answers}</td>
                      <td className="px-4 py-3 text-sm capitalize text-slate-700">{peerResult.status.replace('_', ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
