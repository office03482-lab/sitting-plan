import { useState, useEffect } from 'react';
import { Upload, Download, CheckCircle, XCircle, Eye, Users, MapPin, AlertTriangle, Trash2, Archive, FileText, FileSpreadsheet, Shield } from 'lucide-react';
import {
  apiService,
  isTemporarilyUnavailableDataError,
  logIfUnexpectedRequestError,
} from '@services/api';
import { useRefDataStore } from '@store/referenceData';
import { UnavailableStatCard } from '@components/UnavailableStatCard';
import type { Batch, Room, SeatingPlan } from '@types';

interface ImportResult {
  success: boolean;
  imported_count: number;
  skipped_count: number;
  errors: Array<{row?: number, roll_no?: string, error: string}>;
  room_summary: Record<string, number>;
}

interface AuditResult {
  plan_id: string;
  status: string;
  plan_type: string;
  is_valid: boolean;
  validation_errors: string[];
  stats: {
    total_students_in_layout: number;
    students_assigned: number;
    total_desks: number;
    occupied: number;
    batch_distribution: Record<string, number>;
  };
  issues: string[];
  healthy: boolean;
}

type TabId = 'view' | 'manage' | 'export' | 'archive' | 'audit';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'view', label: 'View Plans', icon: Eye },
  { id: 'manage', label: 'Import & Maintenance', icon: Upload },
  { id: 'export', label: 'Export Center', icon: Download },
  { id: 'archive', label: 'Archive Plans', icon: Archive },
  { id: 'audit', label: 'Plan Audit', icon: Shield },
];

const extractBatchesFromPlanName = (planName: string) => {
  const labeledMatch = planName.match(/Batches:\s*(.+?)\s*-\s*Plan\s+[AB]\b/i);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }
  const legacyMatch = planName.match(/Batches\s+(.+)$/i);
  return legacyMatch?.[1]?.trim() || '';
};

export default function SeatingPlanManagement() {
  const [activeTab, setActiveTab] = useState<TabId>('view');
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [studentCount, setStudentCount] = useState(0);
  const [batchCount, setBatchCount] = useState(0);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [plans, setPlans] = useState<SeatingPlan[]>([]);
  const [detailsPlan, setDetailsPlan] = useState<SeatingPlan | null>(null);
  const [detailsAuditResult, setDetailsAuditResult] = useState<AuditResult | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [deleteAllConfirm, setDeleteAllConfirm] = useState(false);
  const [deletePlanConfirm, setDeletePlanConfirm] = useState<SeatingPlan | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [message, setMessage] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [auditingPlanId, setAuditingPlanId] = useState<string | number | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [summaryUnavailable, setSummaryUnavailable] = useState<{ students: boolean; batches: boolean }>({
    students: false,
    batches: false,
  });

  useEffect(() => {
    loadSummary();
    loadPlans();
    loadRooms();
  }, []);

  const loadSummary = async () => {
    setUploading(true);
    try {
      const [studentsRes, batchesData] = await Promise.allSettled([
        apiService.getStudentsCount(),
        useRefDataStore.getState().getBatches(1),
      ]);

      if (studentsRes.status === 'fulfilled') {
        setStudentCount(Number(studentsRes.value.data || 0));
        setSummaryUnavailable((current) => ({ ...current, students: false }));
      } else {
        logIfUnexpectedRequestError('Failed to load students count:', studentsRes.reason);
        setSummaryUnavailable((current) => ({
          ...current,
          students: isTemporarilyUnavailableDataError(studentsRes.reason),
        }));
      }

      if (batchesData.status === 'fulfilled') {
        const rows = Array.isArray(batchesData.value) ? batchesData.value : [];
        const uniqueBatchNames = new Set(
          rows
            .filter((batch: Batch) => batch.is_active !== false)
            .map((batch: Batch) => String(batch.name || '').trim())
            .filter(Boolean)
        );
        setBatchCount(uniqueBatchNames.size);
        setSummaryUnavailable((current) => ({ ...current, batches: false }));
      } else {
        logIfUnexpectedRequestError('Failed to load batches summary:', batchesData.reason);
        setSummaryUnavailable((current) => ({
          ...current,
          batches: isTemporarilyUnavailableDataError(batchesData.reason),
        }));
      }
    } catch (error) {
      logIfUnexpectedRequestError('Failed to load seating summary:', error);
    } finally {
      setUploading(false);
    }
  };

  const loadPlans = async () => {
    try {
      const response = await apiService.listAllPlans();
      setPlans(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Failed to load seating plans:', error);
      setMessage('Failed to load generated seating plans');
    }
  };

  const loadRooms = async () => {
    try {
      const roomsData = await useRefDataStore.getState().getRooms(1);
      setRooms(Array.isArray(roomsData) ? roomsData : []);
    } catch (error) {
      logIfUnexpectedRequestError('Failed to load rooms:', error);
      setRooms([]);
    }
  };

  const getPlanRoom = (plan: SeatingPlan) => plan.room_name || `Room ${plan.room_id}`;
  const getPlanBatches = (plan: SeatingPlan) => {
    if (plan.batches && plan.batches.length > 0) {
      return plan.batches.join(', ');
    }
    const parsedBatches = extractBatchesFromPlanName(plan.name);
    return parsedBatches || 'Mixed / Legacy Plan';
  };

  const getPlanRoomRecord = (plan: SeatingPlan) =>
    rooms.find((room) => String(room.id) === String(plan.room_id)) || null;

  const getPlanBatchDistribution = (plan: SeatingPlan) => {
    if (Array.isArray(plan.batch_distribution) && plan.batch_distribution.length > 0) {
      return plan.batch_distribution
        .map((item) => ({
          batch: String(item.batch || '').trim() || 'Unspecified Batch',
          count: Number(item.count || 0),
        }))
        .filter((item) => item.count > 0);
    }
    return [];
  };

  const getPlanBatchCount = (plan: SeatingPlan) => {
    if (Array.isArray(plan.batch_distribution) && plan.batch_distribution.length > 0) {
      return plan.batch_distribution.filter((item) => Number(item.count || 0) > 0).length;
    }

    if (Array.isArray(plan.batches) && plan.batches.length > 0) {
      return plan.batches.length;
    }

    const parsedBatches = extractBatchesFromPlanName(plan.name)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    return parsedBatches.length;
  };

  const formatGeneratedDate = (value?: string) => {
    if (!value) return '-';
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
  };

  const openPlanDetails = async (plan: SeatingPlan) => {
    setDetailsPlan(plan);
    setDetailsAuditResult(null);
    setDetailsLoading(true);
    setMessage('');
    try {
      const response = await apiService.auditPlan(plan.id);
      setDetailsAuditResult(response.data);
    } catch (error: any) {
      console.error('Failed to load plan details:', error);
      setDetailsAuditResult(null);
      setMessage(error?.response?.data?.detail || 'Plan details loaded with limited audit information');
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDeleteAllPlans = async () => {
    if (!deleteAllConfirm) return;
    setDeletingAll(true);
    try {
      await apiService.deleteAllSeatingPlans(true);
      setPlans([]);
      setDetailsPlan(null);
      setDetailsAuditResult(null);
      setDeleteAllConfirm(false);
      setMessage('');
    } catch (error: any) {
      console.error('Failed to delete all seating plans:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete all seating plans');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleDeletePlan = async () => {
    if (!deletePlanConfirm) return;
    setDeletingPlan(true);
    try {
      await apiService.deleteSeatingPlan(deletePlanConfirm.id);
      setPlans((current) => current.filter((plan) => plan.id !== deletePlanConfirm.id));
      if (detailsPlan?.id === deletePlanConfirm.id) {
        setDetailsPlan(null);
        setDetailsAuditResult(null);
      }
      setDeletePlanConfirm(null);
      setMessage('Seating plan deleted successfully');
    } catch (error: any) {
      console.error('Failed to delete seating plan:', error);
      setMessage(error?.response?.data?.detail || 'Failed to delete seating plan');
    } finally {
      setDeletingPlan(false);
    }
  };

  const handleExport = async (planId: string | number, type: 'pdf' | 'excel') => {
    const key = `${planId}-${type}`;
    setExporting(key);
    try {
      const response = type === 'pdf'
        ? await apiService.exportPDF(planId)
        : await apiService.exportExcel(planId);
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `seating_plan_${planId}.${type === 'pdf' ? 'pdf' : 'xlsx'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error(`Failed to export ${type}:`, error);
      setMessage(error?.response?.data?.detail || `Failed to export ${type.toUpperCase()}`);
    } finally {
      setExporting(null);
    }
  };

  const handleExportAllRooms = async (plan: SeatingPlan) => {
    const key = `all-${plan.exam_id}`;
    setExporting(key);
    try {
      const response = await apiService.exportAllRoomsExcel(plan.exam_id, plan.plan_type);
      const blob = response.data;
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `all_rooms_${plan.exam_id}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error: any) {
      console.error('Failed to export all rooms:', error);
      setMessage(error?.response?.data?.detail || 'Failed to export all rooms');
    } finally {
      setExporting(null);
    }
  };

  const handleArchiveToggle = async (plan: SeatingPlan) => {
    const newStatus = plan.status === 'archived' ? 'draft' : 'archived';
    setArchiving(String(plan.id));
    try {
      await apiService.updatePlanStatus(plan.id, newStatus);
      setPlans((current) =>
        current.map((p) => (p.id === plan.id ? { ...p, status: newStatus as SeatingPlan['status'] } : p))
      );
      if (detailsPlan?.id === plan.id) {
        setDetailsPlan({ ...plan, status: newStatus as SeatingPlan['status'] });
      }
      setMessage(`Plan ${newStatus === 'archived' ? 'archived' : 'unarchived'} successfully`);
    } catch (error: any) {
      console.error('Failed to update plan status:', error);
      setMessage(error?.response?.data?.detail || 'Failed to update plan status');
    } finally {
      setArchiving(null);
    }
  };

  const handleAudit = async (plan: SeatingPlan, mode: 'tab' | 'details' = 'tab') => {
    setAuditing(true);
    setAuditingPlanId(plan.id);
    setAuditResult(null);
    try {
      const response = await apiService.auditPlan(plan.id);
      if (mode === 'tab') {
        setAuditResult(response.data);
      } else {
        setDetailsAuditResult(response.data);
      }
    } catch (error: any) {
      console.error('Failed to audit plan:', error);
      setMessage(error?.response?.data?.detail || 'Failed to audit plan');
    } finally {
      setAuditing(false);
      setAuditingPlanId(null);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        alert('Please select a valid Excel file (.xlsx)');
        return;
      }
      setSelectedFile(file);
      setImportResult(null);
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await apiService.downloadSeatingTemplate();
      const url = window.URL.createObjectURL(response.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'seating_plan_template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download template:', error);
      alert('Failed to download template. Please try again.');
    }
  };

  const handleValidateAndImport = async () => {
    if (!selectedFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      const response = await apiService.importSeatingPlan(formData);
      if (!response.data.success) {
        setImportResult(response.data);
        return;
      }
      await loadSummary();
      await loadPlans();
      setImportResult(response.data);
      setSelectedFile(null);
    } catch (error: any) {
      console.error('Import validation failed:', error);
      const errorMessage =
        error?.response?.data?.detail ||
        error?.response?.data?.errors?.[0]?.error ||
        error?.message ||
        'Failed to process file';
      setImportResult({
        success: false,
        imported_count: 0,
        skipped_count: 0,
        errors: [{ error: errorMessage }],
        room_summary: {}
      });
    } finally {
      setUploading(false);
    }
  };

  const examGroups = Array.from(
    new Map(
      plans.filter((p) => p.status !== 'archived').map((plan) => [
        `${plan.exam_id}-${plan.plan_type}`,
        {
          examId: plan.exam_id,
          examName: plan.exam_name || `Exam ${plan.exam_id}`,
          planType: plan.plan_type,
          plans: [] as SeatingPlan[],
        },
      ])
    ).values()
  );
  plans.filter((p) => p.status !== 'archived').forEach((plan) => {
    const key = `${plan.exam_id}-${plan.plan_type}`;
    const group = examGroups.find((g) => `${g.examId}-${g.planType}` === key);
    if (group) group.plans.push(plan);
  });

  const getDetailsHealthIssues = (plan: SeatingPlan, room: Room | null, audit: AuditResult | null) => {
    const issues: string[] = [];
    const roomCapacity = Number(room?.capacity || 0);
    const assignedStudents = Number(plan.students_assigned || 0);

    if (roomCapacity > 0 && assignedStudents > roomCapacity) {
      issues.push(`Capacity violation detected: ${assignedStudents} students assigned against capacity ${roomCapacity}.`);
    }

    if (roomCapacity === 0) {
      issues.push('Room capacity is missing or zero.');
    }

    if (assignedStudents === 0) {
      issues.push('No students are assigned to this plan.');
    }

    if (!plan.is_valid) {
      (plan.validation_errors || []).forEach((error) => issues.push(error));
    }

    if (audit) {
      audit.validation_errors.forEach((error) => issues.push(error));
      audit.issues.forEach((issue) => issues.push(issue));
      if (audit.stats.students_assigned !== audit.stats.total_students_in_layout) {
        issues.push(
          `Assignment mismatch detected: ${audit.stats.students_assigned} assigned vs ${audit.stats.total_students_in_layout} in audit layout.`
        );
      }
    }

    return Array.from(new Set(issues));
  };

  const getHealthChecks = (issues: string[]) => {
    if (issues.length > 0) {
      return [];
    }

    return [
      'No capacity violations',
      'No duplicate students',
      'No empty rooms',
      'No assignment issues',
    ];
  };

  const detailsRoom = detailsPlan ? getPlanRoomRecord(detailsPlan) : null;
  const detailsBatchDistribution = detailsPlan ? getPlanBatchDistribution(detailsPlan) : [];
  const detailsTotalBatches = detailsPlan ? getPlanBatchCount(detailsPlan) : 0;
  const detailsAssignedStudents = Number(detailsPlan?.students_assigned || 0);
  const detailsRoomCapacity = Number(detailsRoom?.capacity || 0);
  const detailsUtilization = detailsRoomCapacity > 0 ? Math.round((detailsAssignedStudents / detailsRoomCapacity) * 100) : null;
  const detailsHealthIssues = detailsPlan ? getDetailsHealthIssues(detailsPlan, detailsRoom, detailsAuditResult) : [];
  const detailsHealthChecks = getHealthChecks(detailsHealthIssues);

  const PlanTable = ({ plans, showExport = false, showArchive = false, showAudit = false }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Room</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Batch</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Type</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Students</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Generated Date</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">Status</th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {plans.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-500">
                No plans found.
              </td>
            </tr>
          ) : (
            plans.map((plan) => (
              <tr key={plan.id} className={detailsPlan?.id === plan.id ? 'bg-blue-50' : ''}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{getPlanRoom(plan)}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{getPlanBatches(plan)}</td>
                <td className="px-4 py-3 text-sm capitalize text-gray-600">{plan.plan_type}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{plan.students_assigned}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{formatGeneratedDate(plan.created_at)}</td>
                <td className="px-4 py-3 text-sm">
                  <span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                    plan.status === 'finalized' ? 'bg-green-100 text-green-800' :
                    plan.status === 'archived' ? 'bg-gray-100 text-gray-800' :
                    plan.status === 'reviewed' ? 'bg-blue-100 text-blue-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {plan.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      onClick={() => void openPlanDetails(plan)}
                      className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                      title="View Plan Details"
                    >
                      <Eye className="h-4 w-4" />
                      View Details
                    </button>
                    {showExport && (
                      <>
                        <button
                          onClick={() => handleExport(plan.id, 'pdf')}
                          disabled={exporting === `${plan.id}-pdf`}
                          className="rounded-lg bg-purple-600 p-2 text-white hover:bg-purple-700 disabled:opacity-50"
                          title="Export PDF"
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleExport(plan.id, 'excel')}
                          disabled={exporting === `${plan.id}-excel`}
                          className="rounded-lg bg-green-600 p-2 text-white hover:bg-green-700 disabled:opacity-50"
                          title="Export Excel"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                        </button>
                      </>
                    )}
                    {showArchive && (
                      <button
                        onClick={() => handleArchiveToggle(plan)}
                        disabled={archiving === String(plan.id)}
                        className={`rounded-lg p-2 text-white disabled:opacity-50 ${
                          plan.status === 'archived' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-gray-600 hover:bg-gray-700'
                        }`}
                        title={plan.status === 'archived' ? 'Unarchive' : 'Archive'}
                      >
                        <Archive className="h-4 w-4" />
                      </button>
                    )}
                    {showAudit && (
                      <button
                        onClick={() => handleAudit(plan)}
                        disabled={auditing && auditingPlanId === plan.id}
                        className="rounded-lg bg-indigo-600 p-2 text-white hover:bg-indigo-700 disabled:opacity-50"
                        title="Audit"
                      >
                        <Shield className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      onClick={() => setDeletePlanConfirm(plan)}
                      className="rounded-lg bg-red-600 p-2 text-white hover:bg-red-700"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Seating Plan Management</h1>
          <p className="text-gray-600">View, manage, export, archive, and audit seating plans</p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3 mb-8">
          {summaryUnavailable.students ? (
            <UnavailableStatCard icon={Users} label="Available Students" />
          ) : (
            <div className="rounded-lg bg-white p-5 shadow-md">
              <p className="text-sm text-gray-600">Available Students</p>
              <p className="text-2xl font-bold text-gray-900">{studentCount}</p>
            </div>
          )}
          {summaryUnavailable.batches ? (
            <UnavailableStatCard icon={MapPin} label="Batches" />
          ) : (
            <div className="rounded-lg bg-white p-5 shadow-md">
              <p className="text-sm text-gray-600">Batches</p>
              <p className="text-2xl font-bold text-gray-900">{batchCount}</p>
            </div>
          )}
          <div className="rounded-lg bg-white p-5 shadow-md">
            <p className="text-sm text-gray-600">Total Plans</p>
            <p className="text-2xl font-bold text-gray-900">{plans.length}</p>
          </div>
        </div>

        {message && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
            {message}
            <button className="ml-2 text-red-600 hover:text-red-800" onClick={() => setMessage('')}>×</button>
          </div>
        )}

        <div className="mb-6">
          <div className="flex border-b border-gray-200">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors ${
                    activeTab === tab.id
                      ? 'border-b-2 border-blue-600 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ───── View Plans Tab ───── */}
        {activeTab === 'view' && (
          <div className="rounded-lg bg-white p-6 shadow-md">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-800">Generated Seating Plans</h2>
              <div className="flex gap-3">
                <button onClick={loadPlans} className="rounded-lg bg-gray-700 px-4 py-2 text-white hover:bg-gray-800">
                  Refresh
                </button>
                {plans.filter((p) => p.status !== 'archived').length > 0 && (
                  <button
                    onClick={() => setDeleteAllConfirm(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Delete All
                  </button>
                )}
              </div>
            </div>

            <PlanTable plans={plans.filter((p) => p.status !== 'archived')} showExport showArchive showAudit />
          </div>
        )}

        {/* ───── Manage Plans Tab ───── */}
        {activeTab === 'manage' && (
          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow-md">
              <div className="mb-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-800">Import & Maintenance</h2>
                <button
                  onClick={handleDownloadTemplate}
                  className="flex items-center rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </button>
              </div>

              <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
                <Upload className="mx-auto mb-4 h-12 w-12 text-gray-400" />
                <div className="mb-4">
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <span className="font-medium text-blue-600 hover:text-blue-800">Click to upload</span>
                    <span className="text-gray-500"> or drag and drop</span>
                  </label>
                  <input id="file-upload" type="file" accept=".xlsx" onChange={handleFileSelect} className="hidden" />
                </div>
                <p className="mb-4 text-sm text-gray-500">
                  Only .xlsx Excel files are supported. Use the template format.
                </p>
                {selectedFile && (
                  <div className="flex items-center justify-center space-x-2 text-green-600">
                    <CheckCircle className="h-4 w-4" />
                    <span>{selectedFile.name}</span>
                  </div>
                )}
              </div>

              {selectedFile && (
                <div className="mt-6 flex space-x-4">
                  <button
                    onClick={handleValidateAndImport}
                    disabled={uploading}
                    className="flex items-center rounded-lg bg-green-600 px-6 py-2 text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    <Eye className="mr-2 h-4 w-4" />
                    {uploading ? 'Validating...' : 'Validate & Import'}
                  </button>
                </div>
              )}
            </div>

            {importResult && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <h3 className="mb-4 flex items-center text-lg font-semibold">
                  {importResult.success ? (
                    <CheckCircle className="mr-2 h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="mr-2 h-5 w-5 text-red-500" />
                  )}
                  Import Results
                </h3>
                <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-lg bg-green-50 p-4">
                    <div className="text-2xl font-bold text-green-600">{importResult.imported_count}</div>
                    <div className="text-sm text-green-800">Imported</div>
                  </div>
                  <div className="rounded-lg bg-yellow-50 p-4">
                    <div className="text-2xl font-bold text-yellow-600">{importResult.skipped_count}</div>
                    <div className="text-sm text-yellow-800">Skipped</div>
                  </div>
                  <div className="rounded-lg bg-red-50 p-4">
                    <div className="text-2xl font-bold text-red-600">{importResult.errors.length}</div>
                    <div className="text-sm text-red-800">Errors</div>
                  </div>
                </div>
                {importResult.errors.length > 0 && (
                  <div className="mt-4">
                    <h4 className="mb-2 font-medium text-red-800">Errors:</h4>
                    <div className="max-h-40 overflow-y-auto rounded border border-red-200 bg-red-50 p-4">
                      {importResult.errors.map((error, index) => (
                        <div key={index} className="mb-1 text-sm text-red-700">
                          {error.row && `Row ${error.row}: `}{error.roll_no && `${error.roll_no}: `}{error.error}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {importResult?.room_summary && Object.keys(importResult.room_summary).length > 0 && (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Object.entries(importResult.room_summary).map(([room, count]) => (
                  <div key={room} className="rounded-lg bg-white p-6 shadow-md">
                    <div className="mb-4 flex items-center">
                      <MapPin className="mr-2 h-5 w-5 text-blue-600" />
                      <h3 className="text-lg font-semibold text-gray-800">{room}</h3>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <Users className="mr-1 h-4 w-4 text-gray-500" />
                        <span className="text-sm text-gray-600">{count} students</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg bg-white p-6 shadow-md">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-800">Plan Maintenance</h2>
                {plans.length > 0 && (
                  <button
                    onClick={() => setDeleteAllConfirm(true)}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete All Plans
                  </button>
                )}
              </div>
              <PlanTable plans={plans} />
            </div>
          </div>
        )}

        {/* ───── Export Plans Tab ───── */}
        {activeTab === 'export' && (
          <div className="space-y-6">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              Seating plan PDF, Excel, and all-rooms exports are centralized here. Teacher and student reporting remains in Reports.
            </div>
            {examGroups.length === 0 ? (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <p className="text-sm text-gray-600">No active plans available for export.</p>
              </div>
            ) : (
              examGroups.map((group) => (
                <div key={`${group.examId}-${group.planType}`} className="rounded-lg bg-white p-6 shadow-md">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-800">{group.examName}</h3>
                      <p className="text-sm text-gray-500">
                        {group.plans.length} room{group.plans.length !== 1 ? 's' : ''} | {group.planType}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const plan = group.plans[0];
                        handleExportAllRooms(plan);
                      }}
                      disabled={exporting === `all-${group.examId}`}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      <Download className="h-4 w-4" />
                      {exporting === `all-${group.examId}` ? 'Exporting...' : 'Export All Rooms'}
                    </button>
                  </div>
                  <PlanTable plans={group.plans} showExport />
                </div>
              ))
            )}
          </div>
        )}

        {/* ───── Archive Plans Tab ───── */}
        {activeTab === 'archive' && (
          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow-md">
              <div className="mb-4 flex items-center gap-3">
                <Archive className="h-6 w-6 text-gray-600" />
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Archived Plans</h2>
                  <p className="text-sm text-gray-500">
                    {plans.filter((p) => p.status === 'archived').length} archived plan{plans.filter((p) => p.status === 'archived').length !== 1 ? 's' : ''}
                  </p>
                </div>
              </div>
              <PlanTable
                plans={plans.filter((p) => p.status === 'archived')}
                showArchive
              />
            </div>

            <div className="rounded-lg bg-white p-6 shadow-md">
              <div className="mb-4 flex items-center gap-3">
                <Eye className="h-6 w-6 text-gray-600" />
                <div>
                  <h2 className="text-xl font-semibold text-gray-800">Active Plans</h2>
                  <p className="text-sm text-gray-500">Archive plans that are no longer needed</p>
                </div>
              </div>
              <PlanTable
                plans={plans.filter((p) => p.status !== 'archived')}
                showArchive
              />
            </div>
          </div>
        )}

        {/* ───── Plan Audit Tab ───── */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="rounded-lg bg-white p-6 shadow-md">
              <h2 className="mb-4 text-xl font-semibold text-gray-800">Audit a Plan</h2>
              <p className="mb-4 text-sm text-gray-500">
                Select a plan below to validate its structure, batch distribution, and student assignments.
              </p>
              <PlanTable plans={plans} showAudit />
            </div>

            {auditing && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <p className="text-sm text-gray-600">Auditing plan...</p>
              </div>
            )}

            {auditResult && (
              <div className="rounded-lg bg-white p-6 shadow-md">
                <div className="mb-6 flex items-center gap-3">
                  {auditResult.healthy ? (
                    <CheckCircle className="h-6 w-6 text-green-500" />
                  ) : (
                    <AlertTriangle className="h-6 w-6 text-red-500" />
                  )}
                  <div>
                    <h3 className="text-lg font-semibold">
                      {auditResult.healthy ? 'Plan is Healthy' : 'Issues Found'}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {auditResult.plan_type} | {auditResult.status} | {auditResult.is_valid ? 'Valid' : 'Invalid'}
                    </p>
                  </div>
                </div>

                <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="rounded-lg bg-blue-50 p-3">
                    <div className="text-xl font-bold text-blue-700">{auditResult.stats.total_desks}</div>
                    <div className="text-xs text-blue-600">Total Desks</div>
                  </div>
                  <div className="rounded-lg bg-green-50 p-3">
                    <div className="text-xl font-bold text-green-700">{auditResult.stats.occupied}</div>
                    <div className="text-xs text-green-600">Occupied</div>
                  </div>
                  <div className="rounded-lg bg-purple-50 p-3">
                    <div className="text-xl font-bold text-purple-700">{auditResult.stats.total_students_in_layout}</div>
                    <div className="text-xs text-purple-600">Students in Layout</div>
                  </div>
                  <div className="rounded-lg bg-orange-50 p-3">
                    <div className="text-xl font-bold text-orange-700">{auditResult.stats.students_assigned}</div>
                    <div className="text-xs text-orange-600">Students Assigned</div>
                  </div>
                </div>

                {auditResult.issues.length > 0 && (
                  <div className="mb-6">
                    <h4 className="mb-2 font-medium text-red-800">Issues ({auditResult.issues.length})</h4>
                    <div className="space-y-2">
                      {auditResult.issues.map((issue, i) => (
                        <div key={i} className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                          {issue}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {Object.keys(auditResult.stats.batch_distribution).length > 0 && (
                  <div>
                    <h4 className="mb-2 font-medium text-gray-800">Batch Distribution</h4>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                      {Object.entries(auditResult.stats.batch_distribution).map(([batch, count]) => (
                        <div key={batch} className="rounded-lg bg-gray-50 p-2 text-center">
                          <div className="text-sm font-medium text-gray-800">{batch}</div>
                          <div className="text-lg font-bold text-gray-900">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {auditResult.validation_errors.length > 0 && (
                  <div className="mt-4">
                    <h4 className="mb-2 font-medium text-yellow-800">Validation Errors</h4>
                    <div className="space-y-1">
                      {auditResult.validation_errors.map((err, i) => (
                        <div key={i} className="text-sm text-yellow-700">{err}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {detailsPlan && (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 sm:items-center">
            <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
              <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-gray-200 bg-white px-6 py-5">
                <div>
                  <p className="text-sm font-medium uppercase tracking-wide text-blue-600">Plan Details</p>
                  <h2 className="text-2xl font-bold text-gray-900">{detailsPlan.name}</h2>
                  <p className="text-sm text-gray-600">
                    {detailsPlan.exam_name || `Exam ${detailsPlan.exam_id}`} | {getPlanRoom(detailsPlan)}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setDetailsPlan(null);
                    setDetailsAuditResult(null);
                    setDetailsLoading(false);
                  }}
                  className="rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                >
                  Close
                </button>
              </div>

              <div className="space-y-6 px-6 py-6">
                {detailsLoading ? (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, index) => (
                      <div key={index} className="animate-pulse rounded-xl border border-gray-200 bg-gray-50 p-5">
                        <div className="mb-3 h-4 w-32 rounded bg-gray-200" />
                        <div className="h-6 w-40 rounded bg-gray-200" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid gap-6 lg:grid-cols-2">
                      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Plan Information</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Exam Name</p>
                            <p className="mt-1 text-sm font-medium text-gray-900">{detailsPlan.exam_name || `Exam ${detailsPlan.exam_id}`}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plan Name</p>
                            <p className="mt-1 text-sm font-medium text-gray-900">{detailsPlan.name}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plan Type</p>
                            <p className="mt-1 text-sm capitalize text-gray-900">{detailsPlan.plan_type}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Generated Date</p>
                            <p className="mt-1 text-sm text-gray-900">{formatGeneratedDate(detailsPlan.created_at)}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Generated By</p>
                            <p className="mt-1 text-sm text-gray-900">Not available in current dataset</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Status</p>
                            <p className="mt-1 text-sm capitalize text-gray-900">{detailsPlan.status}</p>
                          </div>
                        </div>
                      </section>

                      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Student Summary</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Students</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">{detailsAssignedStudents}</p>
                          </div>
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Batches</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">{detailsTotalBatches || 0}</p>
                          </div>
                        </div>
                        <div className="mt-4 space-y-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Batch Distribution</p>
                          {detailsBatchDistribution.length > 0 ? (
                            detailsBatchDistribution.map((item) => (
                              <div key={`${detailsPlan.id}-${item.batch}`} className="flex items-center justify-between rounded-lg bg-white px-4 py-3 text-sm">
                                <span className="font-medium text-gray-800">{item.batch}</span>
                                <span className="text-gray-600">{item.count}</span>
                              </div>
                            ))
                          ) : (
                            <p className="rounded-lg bg-white px-4 py-3 text-sm text-gray-600">Batch distribution is not available for this plan.</p>
                          )}
                        </div>
                      </section>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Room Summary</h3>
                        <div className="space-y-3">
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Room Name</p>
                            <p className="mt-1 text-lg font-semibold text-gray-900">{getPlanRoom(detailsPlan)}</p>
                          </div>
                          <div className="grid gap-4 sm:grid-cols-3">
                            <div className="rounded-lg bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Capacity</p>
                              <p className="mt-2 text-xl font-bold text-gray-900">{detailsRoom ? detailsRoomCapacity : 'Data unavailable'}</p>
                            </div>
                            <div className="rounded-lg bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Students Assigned</p>
                              <p className="mt-2 text-xl font-bold text-gray-900">{detailsAssignedStudents}</p>
                            </div>
                            <div className="rounded-lg bg-white p-4">
                              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Utilization</p>
                              <p className="mt-2 text-xl font-bold text-gray-900">{detailsUtilization !== null ? `${detailsUtilization}%` : 'Data unavailable'}</p>
                            </div>
                          </div>
                        </div>
                      </section>

                      <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                        <h3 className="mb-4 text-lg font-semibold text-gray-900">Seating Summary</h3>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Rooms Used</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">1</p>
                          </div>
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Desks Used</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">
                              {detailsAuditResult ? detailsAuditResult.stats.total_desks : 'Data unavailable'}
                            </p>
                          </div>
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Seats Occupied</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">{detailsAssignedStudents}</p>
                          </div>
                          <div className="rounded-lg bg-white p-4">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Total Seats Available</p>
                            <p className="mt-2 text-2xl font-bold text-gray-900">{detailsRoom ? detailsRoomCapacity : 'Data unavailable'}</p>
                          </div>
                        </div>
                      </section>
                    </div>

                    <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <h3 className="mb-4 text-lg font-semibold text-gray-900">Health Status</h3>
                      {detailsHealthIssues.length > 0 ? (
                        <div className="space-y-3">
                          {detailsHealthIssues.map((issue) => (
                            <div key={issue} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                              {issue}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {detailsHealthChecks.map((check) => (
                            <div key={check} className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900">
                              {check}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="rounded-xl border border-gray-200 bg-gray-50 p-5">
                      <h3 className="mb-4 text-lg font-semibold text-gray-900">Quick Actions</h3>
                      <div className="flex flex-wrap gap-3">
                        <button
                          onClick={() => handleExport(detailsPlan.id, 'pdf')}
                          disabled={exporting === `${detailsPlan.id}-pdf`}
                          className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
                        >
                          <FileText className="h-4 w-4" />
                          {exporting === `${detailsPlan.id}-pdf` ? 'Exporting PDF...' : 'Export PDF'}
                        </button>
                        <button
                          onClick={() => handleExport(detailsPlan.id, 'excel')}
                          disabled={exporting === `${detailsPlan.id}-excel`}
                          className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                        >
                          <FileSpreadsheet className="h-4 w-4" />
                          {exporting === `${detailsPlan.id}-excel` ? 'Exporting Excel...' : 'Export Excel'}
                        </button>
                        <button
                          onClick={() => handleAudit(detailsPlan, 'details')}
                          disabled={auditing && auditingPlanId === detailsPlan.id}
                          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          <Shield className="h-4 w-4" />
                          {auditing && auditingPlanId === detailsPlan.id ? 'Auditing...' : 'Audit Plan'}
                        </button>
                        <button
                          onClick={() => handleArchiveToggle(detailsPlan)}
                          disabled={archiving === String(detailsPlan.id)}
                          className="inline-flex items-center gap-2 rounded-lg bg-gray-700 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                          <Archive className="h-4 w-4" />
                          {detailsPlan.status === 'archived' ? 'Unarchive Plan' : 'Archive Plan'}
                        </button>
                        <button
                          onClick={() => setDeletePlanConfirm(detailsPlan)}
                          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete Plan
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {deleteAllConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Delete All Seating Plans?</h3>
              <p className="mb-6 text-sm text-gray-600">
                This will delete all generated seating plans. This action cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeleteAllConfirm(false)}
                  disabled={deletingAll}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAllPlans}
                  disabled={deletingAll}
                  className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingAll ? 'Deleting...' : 'Delete All'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deletePlanConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-lg">
              <h3 className="mb-2 text-lg font-semibold text-gray-900">Delete Seating Plan?</h3>
              <p className="mb-6 text-sm text-gray-600">
                {getPlanRoom(deletePlanConfirm)} ka selected seating plan permanently delete ho jayega.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeletePlanConfirm(null)}
                  disabled={deletingPlan}
                  className="rounded-lg bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeletePlan}
                  disabled={deletingPlan}
                  className="rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingPlan ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
