import { useEffect, useMemo, useState } from 'react';
import { Trash, MapPin, Users, CheckCircle, AlertCircle, Download, FileText } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';
import { useRefDataStore } from '@store/referenceData';
import type { Teacher, Invigilator, RoomInvigilator, Room } from '@types';

type StaffType = 'teaching' | 'non_teaching';

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const isTemporaryAssignmentId = (value: string | number | null | undefined) =>
  String(value ?? '').trim().startsWith('temp-');
const isTeachingMirrorInvigilator = (staff: Invigilator) =>
  /^TCH-\d+$/i.test((staff.staff_id || '').trim()) || (staff.designation || '').trim().toLowerCase() === 'teacher';
const teacherIdFromStaffCode = (staffId?: string) => {
  const match = (staffId || '').trim().match(/^TCH-(\d+)$/i);
  return match ? Number(match[1]) : null;
};
const formatApiError = (error: any, fallback: string) => {
  const detail = error?.response?.data?.detail;

  if (typeof detail === 'string' && detail.trim()) {
    return detail;
  }

  if (Array.isArray(detail) && detail.length > 0) {
    const joined = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const location = Array.isArray(item.loc) ? item.loc.join(' -> ') : '';
          const message = typeof item.msg === 'string' ? item.msg : '';
          if (location && message) return `${location}: ${message}`;
          if (message) return message;
        }
        return '';
      })
      .filter(Boolean)
      .join(' | ');

    if (joined) {
      return joined;
    }
  }

  if (detail && typeof detail === 'object') {
    if (typeof detail.msg === 'string' && detail.msg.trim()) {
      return detail.msg;
    }
    return fallback;
  }

  if (typeof error?.message === 'string' && error.message.trim()) {
    return error.message;
  }

  return fallback;
};

export default function InvigilatorManagement() {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const schoolId = 1;
  const [invigilators, setInvigilators] = useState<Invigilator[]>([]);
  const [teachingStaff, setTeachingStaff] = useState<Teacher[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [assignments, setAssignments] = useState<RoomInvigilator[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState<'success' | 'error'>('success');
  const [showAssignmentForm, setShowAssignmentForm] = useState(false);
  const [deletingAllAssignments, setDeletingAllAssignments] = useState(false);

  const [assignmentData, setAssignmentData] = useState({
    room_id: '',
    staff_type: '' as StaffType | '',
    assignee_key: '',
    notes: '',
  });

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!canRunRequests) return;
    void loadData();
  }, [canRunRequests]);

  const teacherStaffCode = (teacher: Teacher) => `TCH-${teacher.id}`;

  const loadData = async () => {
    try {
      setLoading(true);
      const { getInvigilators, getRooms, getTeachers } = useRefDataStore.getState();
      const [invRes, roomRes, assignRes, teachingRes] = await Promise.allSettled([
        getInvigilators(schoolId),
        getRooms(schoolId),
        apiService.listRoomAssignments(schoolId),
        getTeachers(schoolId),
      ]);

      const invigilatorsData = invRes.status === 'fulfilled' ? toArray<Invigilator>(invRes.value) : [];
      const roomsData = roomRes.status === 'fulfilled' ? toArray<Room>(roomRes.value) : [];
      const assignmentsData = assignRes.status === 'fulfilled' ? toArray<RoomInvigilator>(assignRes.value.data) : [];
      const teachingData = teachingRes.status === 'fulfilled' ? toArray<Teacher>(teachingRes.value) : [];

      setInvigilators(invigilatorsData);
      setRooms(roomsData);
      setTeachingStaff(teachingData);

      if (assignmentsData.length > 0) {
        setAssignments(assignmentsData);
      } else if (roomsData.length > 0) {
        const fallbackAssignmentResults = await Promise.allSettled(
          roomsData.map((room) => apiService.getRoomInvigilators(room.id))
        );

        const synthesizedAssignments = fallbackAssignmentResults.flatMap((result, index) => {
          if (result.status !== 'fulfilled') return [];

          const room = roomsData[index];
          const roomInvigilators = toArray<Invigilator>(result.value.data);
          return roomInvigilators.map((invigilator) => ({
            id: `temp-assignment-${index + 1}-${String(invigilator.id)}`,
            room_id: room.id,
            invigilator_id: invigilator.id,
            school_id: schoolId,
            exam_id: undefined,
            notes: '',
            is_active: true,
            created_at: '',
            updated_at: '',
            room,
            invigilator,
          }));
        });

        setAssignments(synthesizedAssignments);
      } else {
        setAssignments([]);
      }
    } catch (error) {
      console.error('Error loading data:', error);
      showMessage(getRequestErrorMessage(error, 'Failed to load data'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const showMessage = (msg: string, type: 'success' | 'error' = 'success') => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => setMessage(''), 3000);
  };

  const nonTeachingOptions = useMemo(
    () =>
      invigilators.filter(
        (item) =>
          item.is_active &&
          !isTeachingMirrorInvigilator(item)
      ),
    [invigilators]
  );
  const teachingOptions = useMemo(
    () => teachingStaff.filter((item) => item.is_active),
    [teachingStaff]
  );
  const enrichedAssignments = useMemo(
    () =>
      assignments.map((item) => ({
        ...item,
        room: item.room || rooms.find((room) => room.id === item.room_id),
        invigilator: item.invigilator || invigilators.find((invigilator) => invigilator.id === item.invigilator_id),
      })),
    [assignments, rooms, invigilators]
  );
  const visibleAssignmentIds = useMemo(
    () =>
      new Set(
        invigilators
          .filter((item) => item.is_active && (isTeachingMirrorInvigilator(item) ? teacherIdFromStaffCode(item.staff_id) !== null : true))
          .map((item) => item.id)
      ),
    [invigilators]
  );
  const activeAssignments = useMemo(
    () =>
      enrichedAssignments
        .filter((item) => item.is_active && visibleAssignmentIds.has(item.invigilator_id))
        .sort((a, b) => {
          const roomA = a.room?.name || rooms.find((room) => room.id === a.room_id)?.name || '';
          const roomB = b.room?.name || rooms.find((room) => room.id === b.room_id)?.name || '';
          return roomA.localeCompare(roomB) || (a.invigilator?.name || '').localeCompare(b.invigilator?.name || '');
        }),
    [enrichedAssignments, rooms, visibleAssignmentIds]
  );
  const selectedRoomAssignments = useMemo(
    () => activeAssignments.filter((item) => String(item.room_id) === assignmentData.room_id),
    [activeAssignments, assignmentData.room_id]
  );
  const roomWiseAssignments = useMemo(
    () =>
      rooms
        .map((room) => ({
          room,
          assignments: activeAssignments.filter((item) => String(item.room_id) === String(room.id)),
        }))
        .filter((item) => item.assignments.length > 0),
    [rooms, activeAssignments]
  );
  const assignmentsByInvigilator = useMemo(
    () =>
      activeAssignments.reduce<Record<string, typeof activeAssignments>>((acc, item) => {
        const invigilatorKey = String(item.invigilator_id);
        if (!acc[invigilatorKey]) {
          acc[invigilatorKey] = [];
        }
        acc[invigilatorKey].push(item);
        return acc;
      }, {} as Record<string, typeof activeAssignments>),
    [activeAssignments]
  );
  const assignmentsByStaffCode = useMemo(
    () =>
      activeAssignments.reduce<Record<string, typeof activeAssignments>>((acc, item) => {
        const staffCode = (item.invigilator?.staff_id || '').trim().toLowerCase();
        if (!staffCode) return acc;
        if (!acc[staffCode]) {
          acc[staffCode] = [];
        }
        acc[staffCode].push(item);
        return acc;
      }, {}),
    [activeAssignments]
  );
  const assignedTeachingKeys = useMemo(
    () =>
      new Set(
        Object.keys(assignmentsByStaffCode)
          .map((key) => key.trim().toLowerCase())
          .filter(Boolean)
      ),
    [assignmentsByStaffCode]
  );
  const assignedNonTeachingIds = useMemo(
    () => new Set(activeAssignments.map((item) => item.invigilator_id)),
    [activeAssignments]
  );
  const assignmentReportRows = useMemo(
    () =>
      activeAssignments.map((assign) => ({
        room_name: assign.room?.name || rooms.find((room) => room.id === assign.room_id)?.name || 'Unknown Room',
        room_capacity: assign.room?.capacity || rooms.find((room) => room.id === assign.room_id)?.capacity || '',
        invigilator_name: assign.invigilator?.name || 'Unknown Invigilator',
        staff_id: assign.invigilator?.staff_id || '',
        department: assign.invigilator?.department || assign.invigilator?.designation || '',
        notes: assign.notes || '',
        assigned_on: new Date(assign.created_at).toLocaleDateString(),
      })),
    [activeAssignments, rooms]
  );

  const handleExportAssignmentsCsv = () => {
    if (!assignmentReportRows.length) {
      showMessage('No assignment data available for export', 'error');
      return;
    }
    const headers = ['Room', 'Capacity', 'Invigilator', 'Staff ID', 'Department', 'Notes', 'Assigned On'];
    const rows = assignmentReportRows.map((row) =>
      [
        row.room_name,
        row.room_capacity,
        row.invigilator_name,
        row.staff_id,
        row.department,
        row.notes,
        row.assigned_on,
      ]
        .map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
    downloadFile([headers.join(','), ...rows].join('\n'), 'invigilator-room-assignments.csv', 'text/csv;charset=utf-8;');
    showMessage('Assignment CSV exported successfully', 'success');
  };

  const handleExportAssignmentsText = () => {
    if (!assignmentReportRows.length) {
      showMessage('No assignment data available for export', 'error');
      return;
    }
    const content = [
      'INVIGILATOR ROOM ASSIGNMENT REPORT',
      '',
      ...assignmentReportRows.map(
        (row, index) =>
          `${index + 1}. Room: ${row.room_name} | Invigilator: ${row.invigilator_name} | Staff ID: ${row.staff_id} | Department: ${row.department || 'N/A'} | Notes: ${row.notes || 'N/A'} | Assigned On: ${row.assigned_on}`
      ),
    ].join('\n');
    downloadFile(content, 'invigilator-room-assignments.txt', 'text/plain;charset=utf-8;');
    showMessage('Assignment text report exported successfully', 'success');
  };

  const resolveAssigneeInvigilatorId = async () => {
    const { staff_type, assignee_key } = assignmentData;
    if (!staff_type) {
      throw new Error('Please select staff type');
    }
    if (!assignee_key) {
      throw new Error('Please select staff member');
    }

    if (staff_type === 'non_teaching') {
      return parseInt(assignee_key.replace('inv-', ''), 10);
    }

    const teacherId = parseInt(assignee_key.replace('teach-', ''), 10);
    const teacher = teachingStaff.find((member) => member.id === teacherId);
    if (!teacher) {
      throw new Error('Selected teaching staff not found');
    }

    const teacherStaffId = teacherStaffCode(teacher).trim();
    const existing = invigilators.find(
      (item) => item.staff_id.trim().toLowerCase() === teacherStaffId.toLowerCase()
    );
    if (existing) {
      return existing.id;
    }

    const created = await apiService.createInvigilator(
      {
        staff_id: teacherStaffId,
        name: teacher.name,
        email: teacher.email || '',
        phone: teacher.phone || '',
        department: teacher.subject || 'Academics',
        designation: 'Teacher',
        is_active: teacher.is_active ?? true,
      },
      schoolId
    );
    const createdInvigilator = created.data;
    setInvigilators((prev) => [createdInvigilator, ...prev]);
    return createdInvigilator.id;
  };

  const handleAssignToRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const invigilatorId = await resolveAssigneeInvigilatorId();
      const roomId = assignmentData.room_id;
      const existingRoomAssignment = activeAssignments.find((item) => String(item.room_id) === roomId);
      const selectedInvigilator = invigilators.find((item) => item.id === invigilatorId);
      const selectedStaffCode = (selectedInvigilator?.staff_id || '').trim().toLowerCase();
      const duplicateAssignment = activeAssignments.find((item) => {
        if (existingRoomAssignment && item.id === existingRoomAssignment.id) return false;
        if (String(item.room_id) === String(roomId)) return false;
        if (item.invigilator_id === invigilatorId) return true;
        const currentStaffCode = (item.invigilator?.staff_id || '').trim().toLowerCase();
        return Boolean(selectedStaffCode) && currentStaffCode === selectedStaffCode;
      });

      if (duplicateAssignment) {
        throw new Error(
          `${selectedInvigilator?.name || 'Selected staff'} is already assigned to ${duplicateAssignment.room?.name || `Room ${duplicateAssignment.room_id}`}`
        );
      }

      if (existingRoomAssignment) {
        if (existingRoomAssignment.invigilator_id === invigilatorId) {
          await apiService.updateRoomAssignment(existingRoomAssignment.id, {
            notes: assignmentData.notes,
            is_active: true,
          });
        } else {
          await apiService.updateRoomAssignment(existingRoomAssignment.id, {
            invigilator_id: invigilatorId,
            notes: assignmentData.notes,
            is_active: true,
          });
        }
      } else {
        await apiService.assignInvigilatorToRoom(
          {
            room_id: roomId,
            invigilator_id: invigilatorId,
            notes: assignmentData.notes,
          },
          schoolId
        );
      }
      setAssignmentData({ room_id: '', staff_type: '', assignee_key: '', notes: '' });
      setShowAssignmentForm(false);
      await loadData();
      showMessage(existingRoomAssignment ? 'Room assignment updated successfully' : 'Invigilator assigned successfully', 'success');
    } catch (error: any) {
      console.error('Error assigning invigilator:', error);
      showMessage(formatApiError(error, 'Failed to assign invigilator'), 'error');
    }
  };

  const handleRemoveAssignment = async (assignmentId: string | number) => {
    if (isTemporaryAssignmentId(assignmentId)) {
      showMessage('Please refresh/restart backend once. Temporary assignment view cannot remove directly.', 'error');
      return;
    }
    if (!window.confirm('Remove this invigilator from the room?')) return;
    try {
      await apiService.deleteRoomAssignment(assignmentId);
      await loadData();
      showMessage('Assignment removed successfully', 'success');
    } catch (error: any) {
      console.error('Error removing assignment:', error);
      showMessage(formatApiError(error, 'Failed to remove assignment'), 'error');
    }
  };

  const handleDeleteAllAssignments = async () => {
    if (!activeAssignments.length) return;
    if (!window.confirm('All invigilator assignments delete karne hain?')) return;

    try {
      setDeletingAllAssignments(true);
      const persistedAssignments = activeAssignments.filter((item) => !isTemporaryAssignmentId(item.id));

      if (persistedAssignments.length === 0) {
        setAssignments([]);
        showMessage('Visible assignments cleared. Backend refresh/restart ke baad full sync ho jayega.', 'success');
        return;
      }

      await Promise.all(
        persistedAssignments.map((item) => apiService.deleteRoomAssignment(item.id))
      );

      setAssignments((current) => current.filter((item) => isTemporaryAssignmentId(item.id)));
      await loadData();
      showMessage('All invigilator assignments deleted successfully', 'success');
    } catch (error: any) {
      console.error('Error deleting all assignments:', error);
      showMessage(formatApiError(error, 'Failed to delete all assignments'), 'error');
    } finally {
      setDeletingAllAssignments(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-b-2 border-blue-600" />
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8">
          <div className="flex items-center space-x-4">
            <div className="rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 p-3 shadow-lg">
              <Users className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-4xl font-bold text-transparent">
                Invigilator Management
              </h1>
              <p className="text-gray-600">Assign teaching and non-teaching staff to rooms</p>
            </div>
          </div>
        </header>

        {message && (
          <div
            className={`mb-6 flex items-center space-x-3 rounded-lg p-4 ${
              messageType === 'success'
                ? 'border border-green-300 bg-green-100 text-green-800'
                : 'border border-red-300 bg-red-100 text-red-800'
            }`}
          >
            {messageType === 'success' ? <CheckCircle className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            <span>{message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-lg">
              <h2 className="text-2xl font-bold text-gray-900">Available Staff</h2>
              <p className="mt-1 text-sm text-gray-600">
                Staff Add se create hua teaching aur non-teaching staff yahin se assign hoga.
              </p>
              <p className="mt-1 text-sm text-gray-600">
                Teaching: {teachingOptions.length} | Non Teaching: {nonTeachingOptions.length}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Active backend staff yahan automatically show hoga. `Add Staff` se add kiya hua staff bhi isi list mein aayega.
              </p>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-sky-100 bg-sky-50 p-4">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-sky-700">Teaching</h3>
                  <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                    {teachingOptions.map((teacher) => (
                      <div key={teacher.id} className="rounded-md border border-sky-200 bg-white px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{teacher.name}</p>
                        <p className="text-xs text-gray-600">{teacherStaffCode(teacher)}</p>
                        {(assignmentsByStaffCode[teacherStaffCode(teacher).trim().toLowerCase()] || []).length ? (
                          <div className="mt-2 border-t border-sky-100 pt-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Assigned Rooms</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {(assignmentsByStaffCode[teacherStaffCode(teacher).trim().toLowerCase()] || []).map((assignment) => (
                                <span key={assignment.id} className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-800">
                                  {assignment.room?.name || `Room ${assignment.room_id}`}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {teachingOptions.length === 0 && <p className="text-sm text-gray-500">No teaching staff found.</p>}
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-4">
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-emerald-700">Non Teaching</h3>
                  <div className="max-h-[22rem] space-y-2 overflow-y-auto pr-1">
                    {nonTeachingOptions.map((staff) => (
                      <div key={staff.id} className="rounded-md border border-emerald-200 bg-white px-3 py-2">
                        <p className="text-sm font-semibold text-gray-900">{staff.name}</p>
                        <p className="text-xs text-gray-600">{staff.staff_id}</p>
                        {assignmentsByInvigilator[staff.id]?.length ? (
                          <div className="mt-2 border-t border-emerald-100 pt-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Assigned Rooms</p>
                            <div className="mt-1 flex flex-wrap gap-1">
                              {assignmentsByInvigilator[staff.id].map((assignment) => (
                                <span key={assignment.id} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-800">
                                  {assignment.room?.name || `Room ${assignment.room_id}`}
                                </span>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {nonTeachingOptions.length === 0 && (
                      <p className="text-sm text-gray-500">No non-teaching staff found.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div>
            <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-lg">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Assignments</h2>
                  <p className="mt-1 text-sm text-gray-600">Total: {assignments.length}</p>
                </div>
                <div className="flex items-center gap-2">
                  {activeAssignments.length > 0 && (
                    <button
                      onClick={handleDeleteAllAssignments}
                      disabled={deletingAllAssignments}
                      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-md transition hover:bg-red-700 disabled:opacity-50"
                      title="Delete All Assignments"
                    >
                      {deletingAllAssignments ? 'Deleting...' : 'Delete All'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowAssignmentForm(!showAssignmentForm)}
                    className="rounded-lg bg-gradient-to-r from-green-500 to-green-600 px-4 py-2 font-semibold text-white shadow-md transition-all duration-300 hover:from-green-600 hover:to-green-700"
                    title="Add Assignment"
                  >
                    <MapPin className="h-5 w-5" />
                  </button>
                </div>
              </div>

              {showAssignmentForm && (
                <form
                  onSubmit={handleAssignToRoom}
                  className="mb-6 rounded-lg border border-gray-200 bg-gradient-to-br from-gray-50 to-gray-100 p-4"
                >
                  <h3 className="mb-4 font-semibold text-gray-900">Assign Staff</h3>
                  <select
                    value={assignmentData.room_id}
                    onChange={(e) => setAssignmentData({ ...assignmentData, room_id: e.target.value })}
                    className="mb-3 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                    required
                  >
                    <option value="">Select Room</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name} (Cap: {room.capacity})
                      </option>
                    ))}
                  </select>
                  {assignmentData.room_id ? (
                    <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                      <p className="font-semibold">Current room assignments</p>
                      {selectedRoomAssignments.length ? (
                        <div className="mt-2 space-y-1">
                          {selectedRoomAssignments.map((item) => (
                            <p key={item.id}>
                              {item.invigilator?.name || 'Unknown Invigilator'} ({item.invigilator?.staff_id || 'No ID'})
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-blue-700">Abhi is room par koi invigilator assigned nahi hai.</p>
                      )}
                    </div>
                  ) : null}
                  <select
                    value={assignmentData.staff_type}
                    onChange={(e) =>
                      setAssignmentData({
                        ...assignmentData,
                        staff_type: e.target.value as StaffType,
                        assignee_key: '',
                      })
                    }
                    className="mb-3 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                    required
                  >
                    <option value="">Select Type</option>
                    <option value="teaching">Teaching</option>
                    <option value="non_teaching">Non Teaching</option>
                  </select>
                  <select
                    value={assignmentData.assignee_key}
                    onChange={(e) => setAssignmentData({ ...assignmentData, assignee_key: e.target.value })}
                    className="mb-3 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-transparent focus:ring-2 focus:ring-green-500"
                    required
                    disabled={!assignmentData.staff_type}
                  >
                    <option value="">Select Staff</option>
                    {assignmentData.staff_type === 'non_teaching' &&
                      nonTeachingOptions.map((staff) => (
                        <option
                          key={`inv-${staff.id}`}
                          value={`inv-${staff.id}`}
                          disabled={assignedNonTeachingIds.has(staff.id)}
                        >
                          {staff.name} ({staff.staff_id})
                        </option>
                      ))}
                    {assignmentData.staff_type === 'teaching' &&
                      teachingOptions.map((teacher) => (
                        <option
                          key={`teach-${teacher.id}`}
                          value={`teach-${teacher.id}`}
                          disabled={assignedTeachingKeys.has(teacherStaffCode(teacher).trim().toLowerCase())}
                        >
                          {teacher.name} ({teacherStaffCode(teacher)})
                        </option>
                      ))}
                  </select>
                  <textarea
                    placeholder="Notes (optional)"
                    value={assignmentData.notes}
                    onChange={(e) => setAssignmentData({ ...assignmentData, notes: e.target.value })}
                    className="mb-3 w-full rounded-lg border border-gray-300 px-4 py-2 text-sm focus:border-transparent focus:ring-2 focus:ring-green-500"
                    rows={2}
                  />
                  <div className="flex gap-3">
                    <button
                      type="submit"
                      className="flex-1 rounded-lg bg-green-600 py-2 font-semibold text-white transition-all hover:bg-green-700"
                    >
                      Assign
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAssignmentForm(false)}
                      className="flex-1 rounded-lg bg-gray-300 py-2 font-semibold text-gray-700 transition-all hover:bg-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {activeAssignments.length === 0 ? (
                <div className="py-8 text-center">
                  <MapPin className="mx-auto mb-3 h-12 w-12 text-gray-300" />
                  <p className="text-gray-500">No assignments yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeAssignments.map((assign) => (
                    <div key={assign.id} className="rounded-lg border border-gray-200 p-4 transition-all hover:bg-green-50">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">
                            {assign.invigilator?.name || 'Unknown Invigilator'}
                          </p>
                          <p className="mt-1 text-xs text-gray-600">
                            Room: {assign.room?.name || rooms.find((room) => room.id === assign.room_id)?.name || 'Unknown Room'}
                          </p>
                           {assign.notes && <p className="mt-2 text-xs italic text-gray-500">&quot;{assign.notes}&quot;</p>}
                        </div>
                        <button
                          onClick={() => handleRemoveAssignment(assign.id)}
                          className="rounded p-1 text-red-600 transition-all hover:bg-red-100"
                          title="Remove Assignment"
                        >
                          <Trash className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-8 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-lg">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Assigned Invigilators List</h2>
                <p className="mt-1 text-sm text-gray-600">Room-wise live assignment view. Assign hote hi yahan update ho jayega.</p>
              </div>
              <div className="rounded-full bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700">
                Rooms with assignments: {roomWiseAssignments.length}
              </div>
            </div>

            {roomWiseAssignments.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-300 px-6 py-8 text-center text-gray-500">
                Koi room assignment available nahi hai.
              </div>
            ) : (
              <div className="space-y-4">
                {roomWiseAssignments.map(({ room, assignments: roomAssignments }) => (
                  <div key={room.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{room.name}</h3>
                        <p className="text-sm text-slate-500">Capacity: {room.capacity} | Assigned: {roomAssignments.length}</p>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {roomAssignments.map((assign) => (
                        <div key={assign.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
                          <p className="font-semibold text-slate-900">{assign.invigilator?.name || 'Unknown Invigilator'}</p>
                          <p className="text-sm text-slate-500">{assign.invigilator?.staff_id || 'No Staff ID'}</p>
                          <p className="text-xs text-slate-500">{assign.invigilator?.department || assign.invigilator?.designation || 'Department not set'}</p>
                           {assign.notes ? <p className="mt-2 text-xs italic text-slate-500">&quot;{assign.notes}&quot;</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-lg">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Assignment Report & Export</h2>
                <p className="mt-1 text-sm text-gray-600">Assigned invigilators ka export-ready summary.</p>
              </div>
              <FileText className="h-6 w-6 text-indigo-600" />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Assignments</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{activeAssignments.length}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Rooms</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{roomWiseAssignments.length}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Invigilators</p>
                <p className="mt-2 text-2xl font-bold text-slate-900">{new Set(activeAssignments.map((item) => item.invigilator_id)).size}</p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleExportAssignmentsCsv}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
              >
                <Download className="h-4 w-4" />
                Export CSV
              </button>
              <button
                type="button"
                onClick={handleExportAssignmentsText}
                className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 font-semibold text-white transition hover:bg-indigo-700"
              >
                <FileText className="h-4 w-4" />
                Export Text
              </button>
            </div>

            <div className="mt-6 max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
              <div className="grid grid-cols-[1fr_1fr_0.8fr] gap-4 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                <span>Room</span>
                <span>Invigilator</span>
                <span>Staff ID</span>
              </div>
              <div className="divide-y divide-slate-100">
                {assignmentReportRows.length ? (
                  assignmentReportRows.map((row, index) => (
                    <div key={`${row.room_name}-${row.staff_id}-${index}`} className="grid grid-cols-[1fr_1fr_0.8fr] gap-4 px-4 py-3 text-sm text-slate-700">
                      <div>
                        <p className="font-medium text-slate-900">{row.room_name}</p>
                        <p className="text-xs text-slate-500">Cap: {row.room_capacity || 'N/A'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{row.invigilator_name}</p>
                        <p className="text-xs text-slate-500">{row.department || 'Department not set'}</p>
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{row.staff_id || 'No ID'}</p>
                        <p className="text-xs text-slate-500">{row.assigned_on}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-8 text-center text-sm text-slate-500">
                    Export ke liye abhi koi assignment available nahi hai.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
