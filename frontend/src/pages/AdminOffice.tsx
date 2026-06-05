import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  Building,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  LayoutGrid,
  MapPinned,
  RefreshCcw,
  Tag,
  Target,
  UserCheck,
  Users,
  Zap,
} from 'lucide-react';

import { useAuth } from '@/contexts/AuthProvider';
import { useAuthStore } from '@store/auth';
import { apiService, getRequestErrorMessage, logIfUnexpectedRequestError } from '@services/api';
import type { Exam, Room, RoomInvigilator, SeatingPlan } from '@types';

type PlannerSnapshot = {
  exams: Exam[];
  rooms: Room[];
  plans: SeatingPlan[];
  assignments: RoomInvigilator[];
  roomSummary: {
    count: number;
    totalCapacity: number;
  };
  totalStudents: number;
  sourceStatus: {
    exams: boolean;
    rooms: boolean;
    plans: boolean;
    assignments: boolean;
    roomSummary: boolean;
    totalStudents: boolean;
  };
};

type HubAction = {
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
  tone: string;
  description: string;
};

type ReadinessState = 'ready' | 'pending' | 'attention';
type AlertSeverity = 'critical' | 'warning' | 'info';

type ReadinessItem = {
  label: string;
  state: ReadinessState;
  detail: string;
};

type AlertItem = {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
  actionPath?: string;
  actionLabel?: string;
};

type ActivityItem = {
  id: string;
  kind: 'exam_created' | 'room_added' | 'plan_generated' | 'invigilator_assigned';
  title: string;
  detail: string;
  timestamp: string;
  path: string;
};

const EMPTY_SNAPSHOT: PlannerSnapshot = {
  exams: [],
  rooms: [],
  plans: [],
  assignments: [],
  roomSummary: {
    count: 0,
    totalCapacity: 0,
  },
  totalStudents: 0,
  sourceStatus: {
    exams: false,
    rooms: false,
    plans: false,
    assignments: false,
    roomSummary: false,
    totalStudents: false,
  },
};

const sameId = (left: string | number | null | undefined, right: string | number | null | undefined) =>
  String(left ?? '').trim() === String(right ?? '').trim();

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const formatDate = (value?: string) => {
  if (!value) return 'Date not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

const formatDateTime = (value?: string) => {
  if (!value) return 'Time unavailable';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};

const formatPercent = (value: number) => `${Math.max(0, Math.min(100, Math.round(value)))}%`;

const getExamDateTime = (exam: Exam) => {
  if (!exam.exam_date) return Number.POSITIVE_INFINITY;
  const date = new Date(exam.exam_date).getTime();
  return Number.isNaN(date) ? Number.POSITIVE_INFINITY : date;
};

const getExtraTimestamp = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { created_at?: unknown; updated_at?: unknown };
  const createdAt = String(candidate.created_at || '').trim();
  const updatedAt = String(candidate.updated_at || '').trim();
  return createdAt || updatedAt || null;
};

const isFutureOrTodayExam = (exam: Exam) => {
  if (!exam.exam_date) return true;
  const examDate = new Date(exam.exam_date);
  if (Number.isNaN(examDate.getTime())) return true;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return examDate.getTime() >= startOfToday;
};

const getPlanLifecycleLabel = (plansForExam: SeatingPlan[]) => {
  if (plansForExam.length === 0) return 'Planning';
  const finalizedCount = plansForExam.filter((plan) => plan.status === 'finalized').length;
  const reviewedCount = plansForExam.filter((plan) => plan.status === 'reviewed').length;
  if (finalizedCount === plansForExam.length) return 'Ready';
  if (finalizedCount > 0 || reviewedCount > 0) return 'In Progress';
  return 'Draft';
};

export default function AdminOffice() {
  const navigate = useNavigate();
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [snapshot, setSnapshot] = useState<PlannerSnapshot>(EMPTY_SNAPSHOT);
  const [message, setMessage] = useState('');

  const canAccess = (permission?: string) => !permission || isAdmin || hasPermission(permission);
  const canAccessReports = canAccess('admin_office.reports');

  const primaryActions = useMemo<HubAction[]>(
    () => [
      {
        label: 'Generate Seating',
        path: '/seating/generate',
        icon: Zap,
        permission: 'admin_office.seating_generation',
        tone: 'from-blue-600 to-cyan-500',
        description: 'Use the existing generation workflow for exams, batches, rooms, and exports.',
      },
      {
        label: 'Manage Plans',
        path: '/seating/plans',
        icon: LayoutGrid,
        permission: 'admin_office.seating_plans',
        tone: 'from-emerald-600 to-teal-500',
        description: 'Open plan details, import tools, exports, and plan management operations.',
      },
      {
        label: 'Open Reports',
        path: '/reports',
        icon: FileText,
        permission: 'admin_office.reports',
        tone: 'from-rose-600 to-orange-500',
        description: 'Use the existing PDF, Excel, and all-rooms export flows.',
      },
      {
        label: 'Manage Rooms',
        path: '/rooms',
        icon: Building,
        permission: 'admin_office.rooms',
        tone: 'from-violet-600 to-indigo-500',
        description: 'Manage room master data in the existing room configuration module.',
      },
      {
        label: 'Assign Invigilators',
        path: '/invigilators',
        icon: UserCheck,
        permission: 'admin_office.invigilators',
        tone: 'from-amber-500 to-orange-500',
        description: 'Assign teaching and non-teaching staff from the current assignment workspace.',
      },
    ].filter((item) => canAccess(item.permission)),
    [hasPermission, isAdmin]
  );

  const supportActions = useMemo<HubAction[]>(
    () => [
      {
        label: 'Student Management',
        path: '/students',
        icon: Users,
        permission: 'admin_office.students',
        tone: 'from-sky-500 to-blue-500',
        description: 'Maintain the candidate source data used during seating generation.',
      },
      {
        label: 'Batch Management',
        path: '/batches',
        icon: Tag,
        permission: 'admin_office.batches',
        tone: 'from-pink-500 to-rose-500',
        description: 'Review active batch structure without duplicating batch controls here.',
      },
      {
        label: 'Timetable',
        path: '/timetable',
        icon: Calendar,
        permission: 'timetable',
        tone: 'from-indigo-500 to-blue-500',
        description: 'Open timetable planning when exam scheduling needs class calendar context.',
      },
      {
        label: 'Attendance',
        path: '/attendance-management',
        icon: ClipboardCheck,
        permission: 'attendance',
        tone: 'from-teal-500 to-emerald-500',
        description: 'Open attendance as a related operations module without moving any controls here.',
      },
    ].filter((item) => canAccess(item.permission)),
    [hasPermission, isAdmin]
  );

  useEffect(() => {
    if (!canRunRequests) return;
    void loadSnapshot(false);
  }, [canRunRequests]);

  const loadSnapshot = async (isManualRefresh: boolean) => {
    if (!canRunRequests) return;

    if (isManualRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await apiService.getAdminOfficeSnapshot();
      const data = response.data || {};
      setSnapshot({
        exams: toArray<Exam>(data.exams),
        rooms: toArray<Room>(data.rooms),
        plans: toArray<SeatingPlan>(data.plans),
        assignments: toArray<RoomInvigilator>(data.assignments).filter((item) => item.is_active),
        roomSummary: {
          count: Number(data.roomSummary?.count || 0),
          totalCapacity: Number(data.roomSummary?.totalCapacity || 0),
        },
        totalStudents: Number(data.totalStudents || 0),
        sourceStatus: {
          exams: Boolean(data.sourceStatus?.exams ?? true),
          rooms: Boolean(data.sourceStatus?.rooms ?? true),
          plans: Boolean(data.sourceStatus?.plans ?? true),
          assignments: Boolean(data.sourceStatus?.assignments ?? true),
          roomSummary: Boolean(data.sourceStatus?.roomSummary ?? true),
          totalStudents: Boolean(data.sourceStatus?.totalStudents ?? true),
        },
      });
      setMessage('');
    } catch (error) {
      logIfUnexpectedRequestError('[AdminOffice] Failed to load command center snapshot', error);
      if (!isManualRefresh) {
        setSnapshot((current) => {
          const hasExistingData =
            current.exams.length > 0 ||
            current.rooms.length > 0 ||
            current.plans.length > 0 ||
            current.assignments.length > 0 ||
            current.roomSummary.count > 0 ||
            current.totalStudents > 0;
          return hasExistingData ? current : EMPTY_SNAPSHOT;
        });
      }
      setMessage(getRequestErrorMessage(error, 'Failed to load exam planner command center'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const derived = useMemo(() => {
    const activePlans = snapshot.plans.filter((plan) => plan.status !== 'archived');
    const finalizedPlans = activePlans.filter((plan) => plan.status === 'finalized').length;
    const assignedSeats = activePlans.reduce((sum, plan) => sum + Number(plan.students_assigned || 0), 0);
    const roomsConfigured = snapshot.roomSummary.count || snapshot.rooms.length;
    const totalCapacity = snapshot.roomSummary.totalCapacity || snapshot.rooms.reduce((sum, room) => sum + Number(room.capacity || 0), 0);
    const activeAssignments = snapshot.assignments.filter((item) => item.is_active);
    const studentsAvailableKnown = snapshot.sourceStatus.totalStudents;
    const assignmentsKnown = snapshot.sourceStatus.assignments;
    const utilizedRoomIds = Array.from(new Set(activePlans.map((plan) => String(plan.room_id))));
    const roomsWithAssignments = new Set(activeAssignments.map((item) => String(item.room_id)));
    const assignedInvigilatorIds = new Set(activeAssignments.map((item) => String(item.invigilator_id)));
    const roomsWithCoverage = utilizedRoomIds.filter((roomId) => roomsWithAssignments.has(roomId)).length;
    const zeroCapacityRooms = snapshot.rooms.filter((room) => Number(room.capacity || 0) <= 0);

    const roomAssignmentCounts = activePlans.reduce<Record<string, number>>((accumulator, plan) => {
      const key = String(plan.room_id);
      accumulator[key] = (accumulator[key] || 0) + Number(plan.students_assigned || 0);
      return accumulator;
    }, {});

    const roomsExceedingCapacity = snapshot.rooms.filter((room) => {
      const assigned = roomAssignmentCounts[String(room.id)] || 0;
      return assigned > Number(room.capacity || 0);
    });

    const upcomingExams = [...snapshot.exams]
      .filter((exam) => isFutureOrTodayExam(exam))
      .sort((left, right) => getExamDateTime(left) - getExamDateTime(right))
      .slice(0, 6);

    const examsWithoutPlans = snapshot.exams.filter(
      (exam) => !activePlans.some((plan) => sameId(plan.exam_id, exam.id))
    );

    const examsWithoutInvigilators = assignmentsKnown
      ? snapshot.exams
          .map((exam) => {
            const plansForExam = activePlans.filter((plan) => sameId(plan.exam_id, exam.id));
            const uncoveredRooms = Array.from(
              new Set(
                plansForExam
                  .map((plan) => String(plan.room_id))
                  .filter((roomId) => !roomsWithAssignments.has(roomId))
              )
            );
            return {
              exam,
              plansForExam,
              uncoveredRooms,
            };
          })
          .filter((item) => item.plansForExam.length > 0 && item.uncoveredRooms.length > 0)
      : [];

    const emptyRoomAssignments = assignmentsKnown
      ? activeAssignments.filter((assignment) => !utilizedRoomIds.includes(String(assignment.room_id)))
      : [];

    const readinessScoreChecks = [
      snapshot.exams.length > 0,
      roomsConfigured > 0 && zeroCapacityRooms.length === 0,
      studentsAvailableKnown && snapshot.totalStudents > 0,
      assignedSeats > 0,
      activePlans.length > 0,
      assignmentsKnown && utilizedRoomIds.length > 0 ? roomsWithCoverage === utilizedRoomIds.length : false,
      activePlans.length > 0 && canAccessReports,
    ];
    const readinessScore = readinessScoreChecks.length
      ? (readinessScoreChecks.filter(Boolean).length / readinessScoreChecks.length) * 100
      : 0;

    const readinessItems: ReadinessItem[] = [
      {
        label: 'Exam Created',
        state: snapshot.exams.length > 0 ? 'ready' : 'pending',
        detail:
          snapshot.exams.length > 0
            ? `${snapshot.exams.length} exam(s) available for planning.`
            : 'Create an exam from Seating Generation to start the workflow.',
      },
      {
        label: 'Rooms Available',
        state:
          roomsConfigured === 0 ? 'pending' : zeroCapacityRooms.length > 0 ? 'attention' : 'ready',
        detail:
          roomsConfigured === 0
            ? 'No rooms are configured yet.'
            : zeroCapacityRooms.length > 0
              ? `${zeroCapacityRooms.length} room(s) need capacity correction.`
              : `${roomsConfigured} room(s) are available for use.`,
      },
      {
        label: 'Students Available',
        state: !studentsAvailableKnown ? 'attention' : snapshot.totalStudents > 0 ? 'ready' : 'pending',
        detail:
          !studentsAvailableKnown
            ? 'Student source data is temporarily unavailable.'
            : snapshot.totalStudents > 0
            ? `${snapshot.totalStudents} students are available in the current source data.`
            : 'No students are available for scheduling.',
      },
      {
        label: 'Students Scheduled',
        state: activePlans.length === 0 ? 'pending' : assignedSeats > 0 ? 'ready' : 'attention',
        detail:
          activePlans.length === 0
            ? 'Generate seating plans before scheduled-student readiness can be confirmed.'
            : assignedSeats > 0
              ? `${assignedSeats} students are currently scheduled in active seating plans.`
              : 'Active plans exist, but no students are currently scheduled.',
      },
      {
        label: 'Seating Generated',
        state: activePlans.length > 0 ? 'ready' : 'pending',
        detail:
          activePlans.length > 0
            ? `${activePlans.length} active seating plan(s) have been generated.`
            : 'Generate seating plans to unlock plan details and exports.',
      },
      {
        label: 'Invigilators Assigned',
        state:
          !assignmentsKnown
            ? 'attention'
            : utilizedRoomIds.length === 0
            ? 'pending'
            : roomsWithCoverage === utilizedRoomIds.length
              ? 'ready'
              : activeAssignments.length > 0
                ? 'attention'
                : 'pending',
        detail:
          !assignmentsKnown
            ? 'Invigilator assignment data is temporarily unavailable from the source module.'
            : utilizedRoomIds.length === 0
            ? 'Generate room plans before checking invigilator coverage.'
            : `${roomsWithCoverage}/${utilizedRoomIds.length} utilized room(s) have active invigilator coverage.`,
      },
      {
        label: 'Exports Available',
        state:
          !canAccessReports
            ? 'attention'
            : activePlans.length > 0
              ? 'ready'
              : 'pending',
        detail:
          !canAccessReports
            ? 'Reports route is not available for the current permission set.'
            : activePlans.length > 0
              ? 'Existing PDF and Excel export flows are available from Reports.'
              : 'Exports become available after seating plans are generated.',
      },
    ];

    const alerts: AlertItem[] = [
      ...examsWithoutPlans.map((exam) => ({
        id: `no-plans-${exam.id}`,
        severity: 'critical' as const,
        title: `${exam.name} has no seating plans`,
        detail: 'Open Seating Generation to create plans before exam execution.',
        actionPath: '/seating/generate',
        actionLabel: 'Generate Seating',
      })),
      ...zeroCapacityRooms.map((room) => ({
        id: `zero-capacity-${room.id}`,
        severity: 'critical' as const,
        title: `${room.name} has zero capacity`,
        detail: 'This room cannot safely participate in seating until capacity is corrected.',
        actionPath: '/rooms',
        actionLabel: 'Manage Rooms',
      })),
      ...roomsExceedingCapacity.map((room) => ({
        id: `over-capacity-${room.id}`,
        severity: 'critical' as const,
        title: `${room.name} exceeds configured capacity`,
        detail: `${roomAssignmentCounts[String(room.id)] || 0} students are assigned against capacity ${room.capacity}.`,
        actionPath: '/seating/generate',
        actionLabel: 'Review Plans',
      })),
      ...examsWithoutInvigilators.map((item) => ({
        id: `no-invigilator-${item.exam.id}`,
        severity: 'warning' as const,
        title: `${item.exam.name} is missing invigilator coverage`,
        detail: `${item.uncoveredRooms.length} room(s) for this exam do not have active assignments.`,
        actionPath: '/invigilators',
        actionLabel: 'Assign Invigilators',
      })),
      ...emptyRoomAssignments.map((assignment) => ({
        id: `empty-assignment-${assignment.id}`,
        severity: 'info' as const,
        title: `Unused room assignment detected`,
        detail: `Room ${assignment.room?.name || assignment.room_id} has an active invigilator assignment without an active seating plan.`,
        actionPath: '/invigilators',
        actionLabel: 'Review Assignments',
      })),
      ...snapshot.exams
        .filter((exam) => !activePlans.some((plan) => sameId(plan.exam_id, exam.id)))
        .map((exam) => ({
          id: `missing-export-${exam.id}`,
          severity: 'info' as const,
          title: `Exports unavailable for ${exam.name}`,
          detail: 'Reports remain unavailable for this exam until seating plans exist.',
          actionPath: '/reports',
          actionLabel: 'Open Reports',
        })),
      ...(!assignmentsKnown && utilizedRoomIds.length > 0
        ? [
            {
              id: 'invigilator-source-unavailable',
              severity: 'warning' as const,
              title: 'Invigilator coverage data unavailable',
              detail: 'The invigilator assignment source could not be loaded, so coverage alerts are temporarily paused.',
              actionPath: '/invigilators',
              actionLabel: 'Open Invigilators',
            },
          ]
        : []),
    ]
      .sort((left, right) => severityRank(left.severity) - severityRank(right.severity))
      .slice(0, 10);

    const examCards = upcomingExams.map((exam) => {
      const plansForExam = activePlans.filter((plan) => sameId(plan.exam_id, exam.id));
      const planRoomIds = Array.from(new Set(plansForExam.map((plan) => String(plan.room_id))));
      const coveredRooms = assignmentsKnown
        ? planRoomIds.filter((roomId) => roomsWithAssignments.has(roomId)).length
        : 0;
      const examOverCapacity = plansForExam.some((plan) => {
        const room = snapshot.rooms.find((item) => sameId(item.id, plan.room_id));
        return Number(plan.students_assigned || 0) > Number(room?.capacity || 0);
      });

      let readiness: ReadinessState = 'pending';
      if (plansForExam.length === 0) {
        readiness = 'pending';
      } else if (examOverCapacity || (assignmentsKnown && coveredRooms !== planRoomIds.length)) {
        readiness = 'attention';
      } else if (!assignmentsKnown) {
        readiness = 'attention';
      } else {
        readiness = 'ready';
      }

      return {
        exam,
        plansForExam,
        lifecycle: getPlanLifecycleLabel(plansForExam),
        readiness,
        readinessLabel:
          readiness === 'ready'
            ? 'Ready'
            : readiness === 'attention'
              ? 'Attention Required'
              : 'Pending',
        studentsScheduled: plansForExam.reduce((sum, plan) => sum + Number(plan.students_assigned || 0), 0),
        coveredRooms,
        roomCount: planRoomIds.length,
      };
    });

    const activity: ActivityItem[] = [
      ...snapshot.exams
        .map((exam) => {
          const timestamp = getExtraTimestamp(exam);
          if (!timestamp) return null;
          return {
            id: `exam-${exam.id}`,
            kind: 'exam_created' as const,
            title: 'Exam Created',
            detail: `${exam.name} entered the planning pipeline.`,
            timestamp,
            path: '/seating/generate',
          };
        })
        .filter(Boolean),
      ...snapshot.rooms
        .map((room) => {
          const timestamp = getExtraTimestamp(room);
          if (!timestamp) return null;
          return {
            id: `room-${room.id}`,
            kind: 'room_added' as const,
            title: 'Room Added',
            detail: `${room.name} is available in room configuration.`,
            timestamp,
            path: '/rooms',
          };
        })
        .filter(Boolean),
      ...activePlans
        .map((plan) => ({
          id: `plan-${plan.id}`,
          kind: 'plan_generated' as const,
          title: 'Plan Generated',
          detail: `${plan.name} generated for ${plan.room_name || `Room ${plan.room_id}`}.`,
          timestamp: plan.created_at,
          path: '/seating/plans',
        })),
      ...activeAssignments
        .map((assignment) => ({
          id: `assignment-${assignment.id}`,
          kind: 'invigilator_assigned' as const,
          title: 'Invigilator Assigned',
          detail: `${assignment.invigilator?.name || 'Staff'} assigned to ${assignment.room?.name || `Room ${assignment.room_id}`}.`,
          timestamp: assignment.created_at,
          path: '/invigilators',
        })),
    ]
      .filter((item): item is ActivityItem => Boolean(item && item.timestamp))
      .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
      .slice(0, 10);

    return {
      activePlans,
      finalizedPlans,
      assignedSeats,
      roomsConfigured,
      totalCapacity,
      activeAssignments,
      utilizedRoomIds,
      roomsWithCoverage,
      assignedInvigilatorIds,
      readinessScore,
      readinessItems,
      alerts,
      examCards,
      activity,
      studentsAvailableKnown,
      assignmentsKnown,
      availableCapacity: Math.max(0, totalCapacity - assignedSeats),
      utilizationPercent: totalCapacity > 0 ? (assignedSeats / totalCapacity) * 100 : 0,
      invigilatorCoveragePercent:
        assignmentsKnown && utilizedRoomIds.length > 0 ? (roomsWithCoverage / utilizedRoomIds.length) * 100 : 0,
    };
  }, [canAccessReports, snapshot]);
  const hasSnapshotData =
    snapshot.exams.length > 0 ||
    snapshot.rooms.length > 0 ||
    snapshot.plans.length > 0 ||
    snapshot.assignments.length > 0 ||
    snapshot.roomSummary.count > 0 ||
    snapshot.totalStudents > 0;
  const showSectionSkeletons = loading && !hasSnapshotData;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.7),_transparent_40%),linear-gradient(180deg,_#f7fbff_0%,_#ebf4ff_100%)]">
      <main className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
        <section className="overflow-hidden rounded-[2rem] border border-white/80 bg-white/90 p-6 shadow-[0_24px_60px_-34px_rgba(15,23,42,0.35)] backdrop-blur md:p-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-5xl">
                Exam Command Center
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void loadSnapshot(true)}
                disabled={refreshing}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                <RefreshCcw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
              </button>
              {primaryActions[0] ? (
                <button
                  type="button"
                  onClick={() => navigate(primaryActions[0].path)}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <ArrowRight className="h-4 w-4" />
                  Open {primaryActions[0].label}
                </button>
              ) : null}
            </div>
          </div>

          {message ? (
            <div className="mt-6 flex items-start gap-3 rounded-[1.25rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-5">
          {showSectionSkeletons ? (
            Array.from({ length: 5 }).map((_, index) => (
              <SkeletonBlock key={index} className="h-32 rounded-[1.5rem]" />
            ))
          ) : (
            <>
              <MetricCard
                icon={Calendar}
                title="Total Exams"
                value={String(snapshot.exams.length)}
                accent="from-blue-600 to-cyan-500"
                description="Current exams available through the existing exam planning flow."
              />
              <MetricCard
                icon={LayoutGrid}
                title="Active Plans"
                value={String(derived.activePlans.length)}
                accent="from-emerald-600 to-teal-500"
                description="Read-only count of current non-archived seating plans."
              />
              <MetricCard
                icon={Users}
                title="Students Scheduled"
                value={String(derived.assignedSeats)}
                accent="from-violet-600 to-indigo-500"
                description="Students already placed into generated seating plans."
              />
              <MetricCard
                icon={MapPinned}
                title="Rooms Utilized"
                value={String(derived.utilizedRoomIds.length)}
                accent="from-amber-500 to-orange-500"
                description="Rooms currently referenced by active seating plans."
              />
              <MetricCard
                icon={UserCheck}
                title="Invigilators Assigned"
                value={derived.assignmentsKnown ? String(derived.assignedInvigilatorIds.size) : 'Data Unavailable'}
                accent="from-rose-600 to-pink-500"
                description="Unique active invigilators assigned through the current assignment module."
              />
            </>
          )}
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[1fr_1fr]">
          <SectionCard
            eyebrow="Exam Readiness Center"
            title="Operational readiness indicators"
            subtitle="Command-center status derived from current exams, rooms, students, plans, assignments, and reports access."
          >
            {showSectionSkeletons ? (
              <div className="space-y-4">
                <SkeletonBlock className="h-24 rounded-[1.25rem]" />
                <div className="grid gap-4 md:grid-cols-2">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <SkeletonBlock key={index} className="h-28 rounded-[1.25rem]" />
                  ))}
                </div>
              </div>
            ) : (
              <>
                <div className="mb-5 flex items-center justify-between rounded-[1.25rem] bg-slate-950 px-4 py-3 text-white">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-white/70">Overall Readiness</p>
                    <p className="mt-1 text-2xl font-black">{formatPercent(derived.readinessScore)}</p>
                  </div>
                  <div className="w-28">
                    <div className="h-3 overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.max(0, Math.min(100, derived.readinessScore))}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  {derived.readinessItems.map((item) => (
                    <div key={item.label} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-slate-900">{item.label}</p>
                        <StatusBadge state={item.state} />
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{item.detail}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </SectionCard>

          <SectionCard
            eyebrow="Alerts & Issues"
            title="Attention-required items"
            subtitle="Automatically derived from current plan, room, assignment, and report availability data."
          >
            {showSectionSkeletons ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonBlock key={index} className="h-28 rounded-[1.25rem]" />
                ))}
              </div>
            ) : derived.alerts.length === 0 ? (
              <EmptyPanel
                icon={CheckCircle2}
                title="No immediate issues detected"
                detail="Current exams, rooms, seating plans, and invigilator assignments do not show any derived critical or warning conditions."
              />
            ) : (
              <div className="space-y-3">
                {derived.alerts.map((alert) => (
                  <div key={alert.id} className="rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-3">
                          <SeverityBadge severity={alert.severity} />
                          <p className="font-semibold text-slate-900">{alert.title}</p>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{alert.detail}</p>
                      </div>
                      {alert.actionPath && alert.actionLabel ? (
                        <button
                          type="button"
                          onClick={() => navigate(alert.actionPath!)}
                          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
                        >
                          {alert.actionLabel}
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <SectionCard
            eyebrow="Resource Utilization"
            title="Rooms, capacity, and coverage"
            subtitle="Read-only utilization summary from current room and seating-plan data."
          >
            {showSectionSkeletons ? (
              <div className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <SkeletonBlock key={index} className="h-28 rounded-[1.25rem]" />
                  ))}
                </div>
                {Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonBlock key={index} className="h-20 rounded-[1.25rem]" />
                ))}
              </div>
            ) : (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <MiniStat
                    icon={Users}
                    label="Total Students"
                    value={derived.studentsAvailableKnown ? String(snapshot.totalStudents) : 'Data Unavailable'}
                    helper="Student source count from existing student records"
                  />
                  <MiniStat
                    icon={Building}
                    label="Total Rooms"
                    value={String(derived.roomsConfigured)}
                    helper="Rooms available in room configuration"
                  />
                  <MiniStat
                    icon={ClipboardCheck}
                    label="Available Capacity"
                    value={String(derived.totalCapacity)}
                    helper="Total usable room capacity"
                  />
                  <MiniStat
                    icon={Target}
                    label="Occupied Capacity"
                    value={String(derived.assignedSeats)}
                    helper="Students assigned inside active plans"
                  />
                </div>

                <div className="mt-6 space-y-4">
                  <ProgressPanel
                    label="Room Utilization"
                    value={derived.utilizationPercent}
                    detail={`${derived.assignedSeats} of ${derived.totalCapacity || 0} seats are currently occupied.`}
                    color="bg-blue-500"
                  />
                  <ProgressPanel
                    label="Invigilator Coverage"
                    value={derived.invigilatorCoveragePercent}
                    detail={
                      derived.assignmentsKnown
                        ? `${derived.roomsWithCoverage} of ${derived.utilizedRoomIds.length || 0} utilized room(s) have active invigilator assignments.`
                        : 'Coverage data is temporarily unavailable from the invigilator assignment source.'
                    }
                    color="bg-emerald-500"
                    unavailable={!derived.assignmentsKnown}
                  />
                  <ProgressPanel
                    label="Spare Capacity"
                    value={derived.totalCapacity > 0 ? (derived.availableCapacity / derived.totalCapacity) * 100 : 0}
                    detail={`${derived.availableCapacity} seats remain available before full room saturation.`}
                    color="bg-violet-500"
                  />
                </div>
              </>
            )}
          </SectionCard>

          <SectionCard
            eyebrow="Upcoming Exams"
            title="Upcoming exams and readiness"
            subtitle="Quick navigation into the existing seating and reporting modules."
          >
            {showSectionSkeletons ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <SkeletonBlock key={index} className="h-36 rounded-[1.25rem]" />
                ))}
              </div>
            ) : derived.examCards.length === 0 ? (
              <EmptyPanel
                icon={Calendar}
                title="No upcoming exams"
                detail="Create or schedule exams from Seating Generation to populate the command-center queue."
              />
            ) : (
              <div className="space-y-4">
                {derived.examCards.map((item) => (
                  <div key={String(item.exam.id)} className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-lg font-semibold text-slate-900">{item.exam.name}</h3>
                          <StatusBadge state={item.readiness} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
                          <span>Date: {formatDate(item.exam.exam_date)}</span>
                          <span>Time: Not available in current API</span>
                          <span>Status: {item.lifecycle}</span>
                          <span>Readiness: {item.readinessLabel}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          {item.plansForExam.length} plan(s), {item.studentsScheduled} students scheduled, {item.coveredRooms}/{item.roomCount} room(s) covered.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => navigate('/admin-office')}
                          className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/seating/generate')}
                          className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
                        >
                          Generate Seating
                        </button>
                        {canAccessReports ? (
                          <button
                            type="button"
                            onClick={() => navigate('/reports')}
                            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            View Reports
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </section>

        <section className="mt-6 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <SectionCard
            eyebrow="Recent Activity"
            title="Latest visible activity"
            subtitle="Timeline generated from current exam, room, plan, and assignment timestamps only."
          >
            {showSectionSkeletons ? (
              <div className="space-y-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonBlock key={index} className="h-24 rounded-[1.25rem]" />
                ))}
              </div>
            ) : derived.activity.length === 0 ? (
              <EmptyPanel
                icon={Clock3}
                title="No recent activity available"
                detail="The current APIs do not expose enough timestamped records yet to build a visible recent activity timeline."
              />
            ) : (
              <div className="space-y-4">
                {derived.activity.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className="flex w-full items-start gap-4 rounded-[1.25rem] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:bg-slate-50"
                  >
                    <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700">
                      <ActivityIcon kind={item.kind} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-slate-900">{item.title}</p>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                          {formatDateTime(item.timestamp)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{item.detail}</p>
                    </div>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                  </button>
                ))}
              </div>
            )}

            {!showSectionSkeletons ? (
              <div className="mt-4 rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-500">
                Plan deletion and export download events are not exposed by the current APIs, so they are not inferred here.
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            eyebrow="Quick Action Center"
            title="Deep-link operational modules"
            subtitle="Existing modules remain the only place where mutations and exports happen."
          >
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {primaryActions.map((action) => (
                <QuickActionTile key={action.path} action={action} onOpen={() => navigate(action.path)} />
              ))}
            </div>

            {supportActions.length ? (
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {supportActions.map((action) => (
                  <SupportTile key={action.path} action={action} onOpen={() => navigate(action.path)} />
                ))}
              </div>
            ) : null}
          </SectionCard>
        </section>
      </main>
    </div>
  );
}

function severityRank(severity: AlertSeverity) {
  if (severity === 'critical') return 0;
  if (severity === 'warning') return 1;
  return 2;
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse bg-white/70 shadow-sm ${className}`} />;
}

function SectionCard({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-38px_rgba(15,23,42,0.35)] backdrop-blur md:p-6">
      <div className="mb-5">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-950">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function MetricCard({
  icon: Icon,
  title,
  value,
  description,
  accent,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  description: string;
  accent: string;
}) {
  return (
    <article className="rounded-[1.75rem] border border-white/80 bg-white/90 p-5 shadow-[0_20px_60px_-38px_rgba(15,23,42,0.35)] backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">{title}</p>
          <p className="mt-4 text-4xl font-black tracking-tight text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl bg-gradient-to-br ${accent} p-3 text-white shadow-lg`}>
          <Icon className="h-6 w-6" />
        </div>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">{description}</p>
    </article>
  );
}

function QuickActionTile({ action, onOpen }: { action: HubAction; onOpen: () => void }) {
  const Icon = action.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group rounded-[1.5rem] border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className={`inline-flex rounded-2xl bg-gradient-to-br ${action.tone} p-3 text-white shadow-md`}>
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-bold text-slate-900">{action.label}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{action.description}</p>
      <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span>Open module</span>
        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
      </div>
    </button>
  );
}

function SupportTile({ action, onOpen }: { action: HubAction; onOpen: () => void }) {
  const Icon = action.icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-start gap-4 rounded-[1.25rem] border border-slate-200 bg-slate-50/80 px-4 py-4 text-left transition hover:bg-slate-100"
    >
      <div className={`rounded-2xl bg-gradient-to-br ${action.tone} p-2.5 text-white shadow-sm`}>
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-semibold text-slate-900">{action.label}</p>
        <p className="mt-1 text-sm leading-6 text-slate-600">{action.description}</p>
      </div>
    </button>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  helper,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-white px-4 py-4 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-2xl bg-slate-100 p-2.5 text-slate-700">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900">{label}</p>
          <p className="text-xs text-slate-500">{helper}</p>
        </div>
      </div>
      <p className="mt-4 text-3xl font-black tracking-tight text-slate-950">{value}</p>
    </div>
  );
}

function ProgressPanel({
  label,
  value,
  detail,
  color,
  unavailable = false,
}: {
  label: string;
  value: number;
  detail: string;
  color: string;
  unavailable?: boolean;
}) {
  const normalized = Math.max(0, Math.min(100, value));

  return (
    <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-slate-900">{label}</p>
        <span className="text-sm font-semibold text-slate-700">
          {unavailable ? 'Data Unavailable' : formatPercent(normalized)}
        </span>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${unavailable ? 100 : normalized}%`, opacity: unavailable ? 0.25 : 1 }} />
      </div>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

function StatusBadge({ state }: { state: ReadinessState }) {
  const classes =
    state === 'ready'
      ? 'bg-emerald-100 text-emerald-700'
      : state === 'attention'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-100 text-slate-700';
  const label =
    state === 'ready' ? 'Ready' : state === 'attention' ? 'Attention Required' : 'Pending';

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}

function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const classes =
    severity === 'critical'
      ? 'bg-rose-100 text-rose-700'
      : severity === 'warning'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-sky-100 text-sky-700';
  const label =
    severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info';

  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}

function EmptyPanel({
  icon: Icon,
  title,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-500 shadow-sm">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </div>
  );
}

function ActivityIcon({
  kind,
  className,
}: {
  kind: ActivityItem['kind'];
  className?: string;
}) {
  if (kind === 'exam_created') return <Calendar className={className} />;
  if (kind === 'room_added') return <Building className={className} />;
  if (kind === 'plan_generated') return <LayoutGrid className={className} />;
  return <UserCheck className={className} />;
}
