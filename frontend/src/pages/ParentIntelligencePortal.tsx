import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bell, BookOpenCheck, CalendarClock, HeartPulse, MessageSquare, ShieldAlert, TrendingUp } from 'lucide-react';

import { Alert } from '@components/Alert';
import { LoadingSpinner } from '@components/LoadingSpinner';
import { useAuth } from '@/contexts/AuthProvider';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { ParentAlert, ParentChildDashboard, ParentDashboardResponse, ParentInsight, ParentRiskScoreResponse } from '@types';

const cardClass = 'rounded-3xl border border-slate-200 bg-white p-5 shadow-sm';

export default function ParentIntelligencePortal() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [dashboard, setDashboard] = useState<ParentDashboardResponse | null>(null);
  const [insights, setInsights] = useState<ParentInsight[]>([]);
  const [riskScore, setRiskScore] = useState<ParentRiskScoreResponse | null>(null);
  const [alerts, setAlerts] = useState<ParentAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [workingKey, setWorkingKey] = useState('');
  const [error, setError] = useState('');
  const [banner, setBanner] = useState('');

  useEffect(() => {
    if (!canRunRequests) return;
    void loadPortal();
  }, [canRunRequests]);

  const loadPortal = async () => {
    try {
      setLoading(true);
      setError('');
      const [dashboardResponse, insightsResponse, riskResponse, alertsResponse] = await Promise.all([
        apiService.getParentIntelligenceDashboard(),
        apiService.getParentIntelligenceInsights(),
        apiService.getParentIntelligenceRiskScore(),
        apiService.getParentIntelligenceAlerts(),
      ]);
      setDashboard(dashboardResponse.data);
      setInsights(insightsResponse.data?.insights || []);
      setRiskScore(riskResponse.data);
      setAlerts(alertsResponse.data?.alerts || []);
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Parent intelligence portal load nahi ho paya.'));
    } finally {
      setLoading(false);
    }
  };

  const children = dashboard?.children || [];
  const summary = useMemo(() => {
    const totalChildren = children.length || 1;
    const avgAttendance = children.reduce((sum, child) => sum + Number(child.attendance_score || 0), 0) / totalChildren;
    const avgTests = children.reduce((sum, child) => sum + Number(child.test_performance_score || 0), 0) / totalChildren;
    const avgConsistency = children.reduce((sum, child) => sum + Number(child.learning_consistency_score || 0), 0) / totalChildren;
    const avgEngagement = children.reduce((sum, child) => sum + Number(child.engagement_score || 0), 0) / totalChildren;
    return {
      attendance: avgAttendance.toFixed(1),
      tests: avgTests.toFixed(1),
      consistency: avgConsistency.toFixed(1),
      engagement: avgEngagement.toFixed(1),
    };
  }, [children]);

  const handleAcknowledgeAlert = async (alert: ParentAlert) => {
    const alertId = String(alert.id || '');
    if (!alertId) {
      setBanner('Alert snapshot acknowledge ke liye persisted alert id available nahi hai.');
      return;
    }
    try {
      setWorkingKey(`ack-${alertId}`);
      await apiService.acknowledgeParentIntelligenceAlert(alertId);
      setBanner('Alert acknowledged successfully.');
      await loadPortal();
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Alert acknowledge nahi ho paya.'));
    } finally {
      setWorkingKey('');
    }
  };

  const handleContactTeacher = async (studentId: string) => {
    try {
      setWorkingKey(`contact-${studentId}`);
      await apiService.contactParentIntelligenceTeacher({
        student_id: studentId,
        message: 'Parent portal se academic progress review request.',
      });
      setBanner('Teacher contact request log ho gaya.');
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Teacher contact request fail ho gaya.'));
    } finally {
      setWorkingKey('');
    }
  };

  const handleMeetingRequest = async (studentId: string) => {
    try {
      setWorkingKey(`meeting-${studentId}`);
      await apiService.requestParentIntelligenceMeeting({
        student_id: studentId,
        preferred_date: new Date().toISOString().slice(0, 10),
        note: 'Parent portal se performance review meeting request.',
      });
      setBanner('Meeting request log ho gayi.');
    } catch (requestError) {
      setError(getRequestErrorMessage(requestError, 'Meeting request submit nahi hui.'));
    } finally {
      setWorkingKey('');
    }
  };

  if (loading) {
    return <LoadingSpinner message="Parent intelligence portal load ho raha hai..." />;
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Parent Intelligence Portal</h1>
        <p className="mt-1 text-sm text-slate-600">
          Attendance, tests, LMS progress, live classes, study planner, hostel, assignments, aur risk signals ko ek combined parent view mein surface kiya gaya hai.
        </p>
      </div>

      {banner ? <Alert type="success" message={banner} onClose={() => setBanner('')} /> : null}
      {error ? <Alert type="error" message={error} onClose={() => setError('')} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard icon={HeartPulse} label="Academic Health" value={`${Number(dashboard?.academic_health_score || 0).toFixed(1)}`} helper={String(dashboard?.risk_level || 'low').toUpperCase()} />
        <MetricCard icon={BookOpenCheck} label="Attendance Score" value={summary.attendance} helper="Across linked children" color="emerald" />
        <MetricCard icon={TrendingUp} label="Test Score" value={summary.tests} helper="Recent performance" color="sky" />
        <MetricCard icon={CalendarClock} label="Consistency" value={summary.consistency} helper="Planner + assignments" color="amber" />
        <MetricCard icon={Bell} label="Engagement" value={summary.engagement} helper={`${alerts.length} active alerts`} color="rose" />
      </section>

      {!children.length ? (
        <section className={cardClass}>
          <p className="text-sm text-slate-600">No linked students found for this parent context.</p>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-2">
          {children.map((child) => (
            <ChildHealthCard
              key={child.student_id}
              child={child}
              onContactTeacher={() => handleContactTeacher(child.student_id)}
              onRequestMeeting={() => handleMeetingRequest(child.student_id)}
              workingKey={workingKey}
            />
          ))}
        </section>
      )}

      <section className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className={cardClass}>
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5 text-slate-700" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Risk and Trend Analytics</h2>
              <p className="text-sm text-slate-500">7 / 30 / 90 day movement across marks, attendance, and engagement.</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {(riskScore?.children || []).map((child) => (
              <div key={child.student_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{child.student_name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Risk {String(child.risk_level).toUpperCase()}</p>
                  </div>
                  <div className="text-sm text-slate-600">
                    Factors: {child.risk_factors.length ? child.risk_factors.join(', ') : 'No major risk signals'}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <TrendCell label="7 Days" metrics={child.trend_7d} />
                  <TrendCell label="30 Days" metrics={child.trend_30d} />
                  <TrendCell label="90 Days" metrics={child.trend_90d} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={cardClass}>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-slate-700" />
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Parent Alerts</h2>
              <p className="text-sm text-slate-500">Attendance, academic decline, upcoming exam, and assignment alerts.</p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.length ? alerts.map((alert, index) => (
              <div key={`${alert.student_id || 'alert'}-${alert.alert_type}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{alert.title}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                  {String(alert.severity || 'info').toUpperCase()} • {String(alert.student_name || 'Student')}
                </p>
                <p className="mt-3 text-sm text-slate-600">{alert.message}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {alert.communication_actions?.some((action) => action.action_type === 'contact_teacher') && alert.student_id ? (
                    <button
                      type="button"
                      onClick={() => handleContactTeacher(String(alert.student_id))}
                      disabled={workingKey === `contact-${alert.student_id}`}
                      className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
                    >
                      Contact Teacher
                    </button>
                  ) : null}
                  {alert.communication_actions?.some((action) => action.action_type === 'request_meeting') && alert.student_id ? (
                    <button
                      type="button"
                      onClick={() => handleMeetingRequest(String(alert.student_id))}
                      disabled={workingKey === `meeting-${alert.student_id}`}
                      className="rounded-full border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
                    >
                      Request Meeting
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleAcknowledgeAlert(alert)}
                    disabled={workingKey.startsWith('ack-')}
                    className="rounded-full bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
                  >
                    Acknowledge
                  </button>
                </div>
              </div>
            )) : (
              <p className="text-sm text-slate-600">No parent alerts available right now.</p>
            )}
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">AI Insights</h2>
          <div className="mt-4 grid gap-3">
            {insights.length ? insights.map((insight, index) => (
              <div key={`${insight.student_id || 'insight'}-${insight.title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{insight.title}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                  {String(insight.severity || 'info').toUpperCase()} • {String(insight.student_name || 'Student')}
                </p>
                <p className="mt-3 text-sm text-slate-600">{insight.summary}</p>
              </div>
            )) : (
              <p className="text-sm text-slate-600">AI insights abhi generate nahi hue hain.</p>
            )}
          </div>
        </div>

        <div className={cardClass}>
          <h2 className="text-lg font-semibold text-slate-900">Recommendations</h2>
          <div className="mt-4 space-y-4">
            {children.map((child) => (
              <div key={`recommendation-${child.student_id}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">{child.student_name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Weak topics</p>
                <p className="mt-2 text-sm text-slate-600">{child.weak_topics.length ? child.weak_topics.join(', ') : 'No weak topics flagged.'}</p>
                <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Suggestions</p>
                <ul className="mt-2 space-y-2 text-sm text-slate-600">
                  {child.suggestions.length ? child.suggestions.slice(0, 3).map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  )) : <li>No AI recommendation available.</li>}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  helper,
  color = 'blue',
}: {
  icon: typeof HeartPulse;
  label: string;
  value: string;
  helper: string;
  color?: 'blue' | 'emerald' | 'amber' | 'rose' | 'sky';
}) {
  const toneMap = {
    blue: 'bg-blue-100 text-blue-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    rose: 'bg-rose-100 text-rose-700',
    sky: 'bg-sky-100 text-sky-700',
  } as const;

  return (
    <section className={cardClass}>
      <div className="flex items-center gap-3">
        <div className={`rounded-2xl p-3 ${toneMap[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-500">{helper}</p>
        </div>
      </div>
    </section>
  );
}

function ChildHealthCard({
  child,
  onContactTeacher,
  onRequestMeeting,
  workingKey,
}: {
  child: ParentChildDashboard;
  onContactTeacher: () => void;
  onRequestMeeting: () => void;
  workingKey: string;
}) {
  return (
    <section className={cardClass}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{child.student_name}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {[child.class_name, child.section].filter(Boolean).join(' • ') || 'Student profile'}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-700">
          {child.risk_level}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <InfoCell label="Academic Health" value={child.academic_health_score.toFixed(1)} />
        <InfoCell label="Attendance" value={child.attendance_score.toFixed(1)} />
        <InfoCell label="Tests" value={child.test_performance_score.toFixed(1)} />
        <InfoCell label="Engagement" value={child.engagement_score.toFixed(1)} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <TrendCell label="30 Day Trend" metrics={child.trend_30d} />
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Risk Factors</p>
          <p className="mt-2 text-sm text-slate-600">
            {child.risk_factors.length ? child.risk_factors.join(', ') : 'No active risk factors'}
          </p>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Hostel Status</p>
          <p className="mt-2 text-sm text-slate-600">
            {String((child.hostel_status as Record<string, unknown> | null)?.status || 'No hostel issue')}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onContactTeacher}
          disabled={workingKey === `contact-${child.student_id}`}
          className="inline-flex items-center gap-2 rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-70"
        >
          <MessageSquare className="h-4 w-4" />
          Contact Teacher
        </button>
        <button
          type="button"
          onClick={onRequestMeeting}
          disabled={workingKey === `meeting-${child.student_id}`}
          className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-70"
        >
          Request Meeting
        </button>
      </div>
    </section>
  );
}

function TrendCell({
  label,
  metrics,
}: {
  label: string;
  metrics: { marks: number; attendance: number; engagement: number };
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <InfoCell label="Marks" value={Number(metrics.marks || 0).toFixed(1)} compact />
        <InfoCell label="Attendance" value={Number(metrics.attendance || 0).toFixed(1)} compact />
        <InfoCell label="Engagement" value={Number(metrics.engagement || 0).toFixed(1)} compact />
      </div>
    </div>
  );
}

function InfoCell({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 ${compact ? 'px-3 py-3' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-2 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
