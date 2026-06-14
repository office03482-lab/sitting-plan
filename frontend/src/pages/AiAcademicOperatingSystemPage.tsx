import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { Bot, BrainCircuit, CheckCircle2, RefreshCcw, ShieldAlert, Sparkles, XCircle } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { AiAgentDashboard, AiAgentRecommendation } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

const severityTone: Record<string, string> = {
  critical: 'bg-rose-50 text-rose-700',
  warning: 'bg-amber-50 text-amber-700',
  positive: 'bg-emerald-50 text-emerald-700',
  info: 'bg-sky-50 text-sky-700',
};

export default function AiAcademicOperatingSystemPage() {
  const { user } = useAuth();
  const [dashboard, setDashboard] = useState<AiAgentDashboard | null>(null);
  const [recommendations, setRecommendations] = useState<AiAgentRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [workingKey, setWorkingKey] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  const isPlatformAdmin = user?.role_key === 'platform_admin';
  const canRun = ['teacher', 'school_admin', 'platform_admin'].includes(user?.role_key || '') || user?.role === 'admin';

  const loadCommandCenter = async () => {
    try {
      setLoading(true);
      setError('');
      const [dashboardResponse, recommendationsResponse] = await Promise.all([
        apiService.getAiAgentsDashboard(),
        apiService.listAiAgentRecommendations(),
      ]);
      setDashboard(dashboardResponse.data);
      setRecommendations(recommendationsResponse.data);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI command center load nahi ho paaya.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCommandCenter();
  }, []);

  const summaryCards = useMemo(
    () => [
      { label: 'Agents', value: dashboard?.summary.agents || 0 },
      { label: 'Recommendations', value: dashboard?.summary.recommendations || 0 },
      { label: 'Pending Approvals', value: dashboard?.summary.pending_approvals || 0 },
      { label: 'Critical Alerts', value: dashboard?.summary.critical_alerts || 0 },
    ],
    [dashboard],
  );

  const handleRun = async (agentKey?: string) => {
    try {
      setWorkingKey(`run-${agentKey || 'all'}`);
      setError('');
      const response = await apiService.runAiAgents({ agent_key: agentKey });
      setBanner(`${response.data.recommendations_created} recommendations regenerated.`);
      await loadCommandCenter();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'AI agent run fail ho gaya.'));
    } finally {
      setWorkingKey('');
    }
  };

  const handleDecision = async (recommendationId: string, decision: 'approved' | 'rejected') => {
    try {
      setWorkingKey(`${decision}-${recommendationId}`);
      setError('');
      await apiService.approveAiAgentRecommendation({
        recommendation_id: recommendationId,
        decision,
        notes: decision === 'approved' ? 'Approved from AI command center.' : 'Rejected from AI command center.',
      });
      setBanner(`Recommendation ${decision}.`);
      await loadCommandCenter();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, `Recommendation ${decision} nahi ho paayi.`));
    } finally {
      setWorkingKey('');
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="rounded-[2rem] bg-gradient-to-br from-slate-950 via-emerald-900 to-cyan-700 p-8 text-white shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-100/80">AI Academic Operating System</p>
            <h1 className="mt-3 text-3xl font-bold">AI Command Center</h1>
            <p className="mt-3 max-w-3xl text-sm text-emerald-50/90">
              AI Principal, Academic Coordinator, Attendance Officer, Exam Coordinator, Faculty Advisor, Student Success Advisor, Parent Advisor, Revenue Advisor, aur Operations Advisor existing modules ko orchestrate karke approval-ready recommendations generate karte hain.
            </p>
          </div>
          {canRun ? (
            <button
              onClick={() => void handleRun()}
              disabled={workingKey === 'run-all'}
              className="inline-flex items-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15 disabled:opacity-70"
            >
              <RefreshCcw className="h-4 w-4" />
              Run All Agents
            </button>
          ) : null}
        </div>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}
      {loading ? <LoadingSpinner message="AI command center orchestrations load ho rahe hain..." /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((item) => (
          <div key={item.label} className={cardClass}>
            <div className="text-sm text-slate-500">{item.label}</div>
            <div className="mt-2 text-2xl font-bold text-slate-900">{item.value}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={cardClass}>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-slate-700" />
            <h2 className="text-lg font-semibold text-slate-900">Agent Framework</h2>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(dashboard?.agent_cards || []).map((card) => (
              <div key={card.agent_key} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{card.agent_name}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{card.domain_key}</div>
                  </div>
                  {canRun ? (
                    <button
                      onClick={() => void handleRun(card.agent_key)}
                      disabled={workingKey === `run-${card.agent_key}`}
                      className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
                    >
                      Run
                    </button>
                  ) : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <MiniMetric label="Recs" value={card.recommendation_count} />
                  <MiniMetric label="Pending" value={card.pending_count} />
                  <MiniMetric label="Critical" value={card.critical_count} />
                </div>
                <div className="mt-4 text-sm text-slate-600">
                  Sources: {card.source_modules.join(', ') || 'ai_agents'}
                </div>
                <div className="mt-3 text-sm text-slate-600">
                  Approval: <span className="font-semibold uppercase">{card.approval_scope}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Panel title="Critical Alerts" icon={ShieldAlert}>
            <RecommendationList items={dashboard?.critical_alerts || []} compact />
          </Panel>
          <Panel title="Pending Approvals" icon={Sparkles}>
            <RecommendationList
              items={dashboard?.pending_approvals || []}
              workingKey={workingKey}
              onApprove={handleDecision}
              isPlatformAdmin={isPlatformAdmin}
            />
          </Panel>
        </div>
      </section>

      <section className={cardClass}>
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Recommendations Feed</h2>
        </div>
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <RecommendationList
            items={recommendations}
            workingKey={workingKey}
            onApprove={handleDecision}
            isPlatformAdmin={isPlatformAdmin}
          />
        </div>
      </section>
    </div>
  );
}

function Panel({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof BrainCircuit;
  children: ReactNode;
}) {
  return (
    <div className={cardClass}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</div>
      <div className="mt-2 text-lg font-bold text-slate-900">{value}</div>
    </div>
  );
}

function RecommendationList({
  items,
  compact = false,
  workingKey = '',
  onApprove,
  isPlatformAdmin = false,
}: {
  items: AiAgentRecommendation[];
  compact?: boolean;
  workingKey?: string;
  onApprove?: (recommendationId: string, decision: 'approved' | 'rejected') => void;
  isPlatformAdmin?: boolean;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.id} className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-slate-900">{item.title}</div>
              <div className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                {item.agent_name || item.agent_key} • {item.recommendation_type} • {item.approval_scope}
              </div>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${severityTone[item.severity] || 'bg-slate-100 text-slate-700'}`}>
              {item.severity.toUpperCase()}
            </span>
          </div>
          <div className="mt-3 text-sm text-slate-600">{item.summary}</div>
          {!compact ? (
            <>
              <div className="mt-3 text-sm text-slate-600">
                Confidence: <span className="font-semibold">{item.confidence_score.toFixed(1)}%</span>
              </div>
              {item.actions.length ? (
                <div className="mt-3 space-y-2">
                  {item.actions.map((action) => (
                    <div key={action.id || action.action_label} className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
                      {action.action_label} • {action.target_module} • {action.execution_status}
                    </div>
                  ))}
                </div>
              ) : null}
              {item.approval_status === 'pending' && onApprove ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onApprove(item.id, 'approved')}
                    disabled={workingKey === `approved-${item.id}` || (!isPlatformAdmin && item.approval_scope === 'platform')}
                    className="inline-flex items-center gap-2 rounded-full bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => onApprove(item.id, 'rejected')}
                    disabled={workingKey === `rejected-${item.id}` || (!isPlatformAdmin && item.approval_scope === 'platform')}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-60"
                  >
                    <XCircle className="h-4 w-4" />
                    Reject
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ))}
      {!items.length ? <div className="text-sm text-slate-500">No recommendations available right now.</div> : null}
    </div>
  );
}
