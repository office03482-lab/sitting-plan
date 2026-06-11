import { useEffect, useState } from 'react';
import type { Hostel, HostelRoom, StudentHostelRequest } from '@types';
import { apiService } from '@services/api';
import { useAuth } from '@/contexts/AuthProvider';

const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-slate-900 focus:ring-2 focus:ring-slate-200';

type HostelFormState = {
  name: string;
  hostel_head: string;
  warden_name: string;
  gender_category: string;
  address: string;
  total_rooms: number;
};

const initialHostelForm: HostelFormState = {
  name: '',
  hostel_head: '',
  warden_name: '',
  gender_category: '',
  address: '',
  total_rooms: 0,
};

const stringifyErrorValue = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          const loc = Array.isArray(record.loc) ? record.loc.join(' > ') : '';
          const msg = typeof record.msg === 'string' ? record.msg : JSON.stringify(item);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item ?? '');
      })
      .filter(Boolean);
    return parts.join(' | ') || fallback;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.msg === 'string') return record.msg;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  if (value != null) return String(value);
  return fallback;
};

const readApiError = (error: any, fallback: string) =>
  stringifyErrorValue(
    error?.response?.data?.detail ??
      error?.response?.data?.error ??
      error?.message,
    fallback,
  );

const toArray = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

const normalizeRoom = (room: any): HostelRoom => ({
  id: room?.id ?? '',
  hostel_id: room?.hostel_id ?? '',
  room_number: String(room?.room_number || ''),
  total_beds: Number(room?.total_beds || 0),
  occupied_beds: Number(room?.occupied_beds || 0),
  available_beds: Number(room?.available_beds || 0),
  is_active: Boolean(room?.is_active),
});

const normalizeHostel = (hostel: any): Hostel => {
  const rooms = toArray<unknown>(hostel?.rooms).map(normalizeRoom);
  return {
    id: hostel?.id ?? '',
    name: String(hostel?.name || 'Unnamed Hostel'),
    hostel_head: hostel?.hostel_head ? String(hostel.hostel_head) : undefined,
    warden_name: hostel?.warden_name ? String(hostel.warden_name) : undefined,
    gender_category: hostel?.gender_category ? String(hostel.gender_category) : undefined,
    address: hostel?.address ? String(hostel.address) : undefined,
    is_active: hostel?.is_active !== false,
    total_rooms: Number(hostel?.total_rooms || rooms.length || 0),
    total_capacity: Number(hostel?.total_capacity || 0),
    occupied_beds: Number(hostel?.occupied_beds || 0),
    available_beds: Number(hostel?.available_beds || 0),
    rooms,
  };
};

const normalizeRequest = (request: any): StudentHostelRequest => ({
  id: request?.id ?? '',
  student_id: request?.student_id ?? '',
  student_name: String(request?.student_name || ''),
  roll_number: String(request?.roll_number || ''),
  batch: String(request?.batch || ''),
  reference_name: request?.reference_name ? String(request.reference_name) : undefined,
  reference_number: request?.reference_number ? String(request.reference_number) : undefined,
  reference_remark: request?.reference_remark ? String(request.reference_remark) : undefined,
  hostel_id: request?.hostel_id ?? '',
  hostel_name: String(request?.hostel_name || ''),
  room_id: request?.room_id ?? undefined,
  room_number: request?.room_number ? String(request.room_number) : undefined,
  requested_notes: request?.requested_notes ? String(request.requested_notes) : undefined,
  status: String(request?.status || ''),
  assigned_bed_label: request?.assigned_bed_label ? String(request.assigned_bed_label) : undefined,
  reviewed_by: request?.reviewed_by ? String(request.reviewed_by) : undefined,
  review_notes: request?.review_notes ? String(request.review_notes) : undefined,
  requested_at: String(request?.requested_at || ''),
  reviewed_at: request?.reviewed_at ? String(request.reviewed_at) : undefined,
});

export default function HostelManagement() {
  const { authReady, sessionReady, schoolContextReady, session, user } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const [hostels, setHostels] = useState<Hostel[]>([]);
  const [requests, setRequests] = useState<StudentHostelRequest[]>([]);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingHostelId, setEditingHostelId] = useState<string | number | null>(null);
  const [deletingHostelId, setDeletingHostelId] = useState<string | number | null>(null);
  const [approvingRequestId, setApprovingRequestId] = useState<string | number | null>(null);
  const [moveSelections, setMoveSelections] = useState<Record<string, { hostelId: string; roomId: string }>>({});
  const [hostelForm, setHostelForm] = useState<HostelFormState>(initialHostelForm);
  const [roomForms, setRoomForms] = useState<Record<string, string>>({});

  const upsertHostel = (nextHostel: Hostel) => {
    setHostels((current) => {
      const remaining = current.filter((item) => String(item.id) !== String(nextHostel.id));
      return [...remaining, nextHostel].sort((left, right) => left.name.localeCompare(right.name));
    });
  };

  const upsertRequest = (nextRequest: StudentHostelRequest) => {
    setRequests((current) => {
      const remaining = current.filter((item) => String(item.id) !== String(nextRequest.id));
      return [nextRequest, ...remaining].sort((left, right) => String(right.requested_at || '').localeCompare(String(left.requested_at || '')));
    });
  };

  const loadHostels = async () => {
    const response = await apiService.listHostels();
    setHostels(toArray(response.data).map(normalizeHostel));
  };

  const loadRequests = async () => {
    const schoolId = user?.school_id || 1;
    const [pendingRes, approvedRes] = await Promise.allSettled([
      apiService.listStudentHostelRequests(schoolId, 'pending'),
      apiService.listStudentHostelRequests(schoolId, 'approved'),
    ]);

    const nextRequests: StudentHostelRequest[] = [];
    const errors: string[] = [];

    if (pendingRes.status === 'fulfilled') {
      nextRequests.push(...toArray(pendingRes.value.data).map(normalizeRequest));
    } else {
      errors.push(readApiError(pendingRes.reason, 'Failed to load pending hostel requests'));
    }

    if (approvedRes.status === 'fulfilled') {
      nextRequests.push(...toArray(approvedRes.value.data).map(normalizeRequest));
    } else {
      errors.push(readApiError(approvedRes.reason, 'Failed to load approved hostel allocations'));
    }

    setRequests(nextRequests);
    return errors;
  };

  const loadAll = async () => {
    if (!canRunRequests) return;
    setLoading(true);
    const [hostelsRes, requestsErrors] = await Promise.allSettled([
      loadHostels(),
      loadRequests(),
    ]);

    const errors: string[] = [];

    if (hostelsRes.status === 'fulfilled') {
    } else {
      setHostels([]);
      errors.push(readApiError(hostelsRes.reason, 'Failed to load hostels'));
    }

    if (requestsErrors.status === 'fulfilled') {
      errors.push(...requestsErrors.value);
    } else {
      setRequests([]);
      errors.push(readApiError(requestsErrors.reason, 'Failed to load hostel requests'));
    }

    setMessage(errors[0] || '');
    setLoading(false);
  };

  useEffect(() => {
    if (!canRunRequests) return;
    void loadAll();
  }, [canRunRequests]);

  const pendingRequests = requests.filter((request) => request.status === 'pending');
  const allocatedStudents = requests.filter((request) => request.status === 'approved');
  const isEditing = editingHostelId !== null;
  const getMoveSelection = (request: StudentHostelRequest) => moveSelections[request.id] || {
    hostelId: String(request.hostel_id || ''),
    roomId: request.room_id ? String(request.room_id) : '',
  };
  const updateMoveSelection = (requestId: string | number, field: 'hostelId' | 'roomId', value: string) => {
    setMoveSelections((current) => ({
      ...current,
      [requestId]: {
        hostelId: current[requestId]?.hostelId || '',
        roomId: current[requestId]?.roomId || '',
        [field]: value,
      },
    }));
  };
  const getHostelRooms = (hostelId: string | number, includeRoomId?: string | number) =>
    (hostels.find((hostel) => String(hostel.id) === String(hostelId))?.rooms || []).filter(
      (room) => room.available_beds > 0 || String(room.id) === String(includeRoomId),
    );

  const handleCreateHostel = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!hostelForm.name.trim()) {
      setMessage('Hostel name required hai.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: hostelForm.name.trim(),
        hostel_head: hostelForm.hostel_head.trim() || undefined,
        warden_name: hostelForm.warden_name.trim() || undefined,
        gender_category: hostelForm.gender_category.trim() || undefined,
        address: hostelForm.address.trim() || undefined,
      };

      if (isEditing && editingHostelId) {
        const response = await apiService.updateHostel(editingHostelId, payload);
        upsertHostel(normalizeHostel(response.data));
        setMessage('Hostel updated successfully');
      } else {
        const response = await apiService.createHostel({
          ...payload,
          total_rooms: Number(hostelForm.total_rooms) || 0,
        });
        upsertHostel(normalizeHostel(response.data));
        setMessage('Hostel created successfully');
      }

      setHostelForm(initialHostelForm);
      setEditingHostelId(null);
    } catch (error: any) {
      setMessage(readApiError(error, isEditing ? 'Failed to update hostel' : 'Failed to create hostel'));
    } finally {
      setSaving(false);
    }
  };

  const handleEditHostel = (hostel: Hostel) => {
    setEditingHostelId(hostel.id);
    setHostelForm({
      name: hostel.name || '',
      hostel_head: hostel.hostel_head || '',
      warden_name: hostel.warden_name || '',
      gender_category: hostel.gender_category || '',
      address: hostel.address || '',
      total_rooms: hostel.total_rooms || hostel.rooms.length || 0,
    });
    setMessage(`Editing ${hostel.name}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleCancelEdit = () => {
    setEditingHostelId(null);
    setHostelForm(initialHostelForm);
    setMessage('');
  };

  const handleDeleteHostel = async (hostel: Hostel) => {
    const confirmed = confirm(`Delete hostel "${hostel.name}"?`);
    if (!confirmed) return;

    setDeletingHostelId(hostel.id);
    try {
      const response = await apiService.deleteHostel(hostel.id);
      setHostels((current) => current.filter((item) => String(item.id) !== String(hostel.id)));
      setRequests((current) => current.filter((item) => String(item.hostel_id) !== String(hostel.id)));
      if (editingHostelId === hostel.id) {
        setEditingHostelId(null);
        setHostelForm(initialHostelForm);
      }
      setMessage(response.data.message || 'Hostel deleted successfully');
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to delete hostel'));
    } finally {
      setDeletingHostelId(null);
    }
  };

  const handleAddHostelRoom = async (hostelId: string | number) => {
    const roomNumber = (roomForms[hostelId] || '').trim();
    if (!roomNumber) {
      setMessage('Room number required hai.');
      return;
    }

    try {
      await apiService.addHostelRoom(hostelId, {
        room_number: roomNumber,
        total_beds: 2,
      });
      setRoomForms((current) => ({ ...current, [hostelId]: '' }));
      setMessage('Hostel room added successfully');
      await loadHostels();
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to add hostel room'));
    }
  };

  const handleApproveRequest = async (request: StudentHostelRequest, roomId?: string | number) => {
    const selection = getMoveSelection(request);
    const selectedHostelId = selection.hostelId || String(request.hostel_id || '');
    const selectedRoomId = selection.roomId || (roomId ? String(roomId) : '');
    setApprovingRequestId(request.id);
    try {
      const response = await apiService.approveStudentHostelRequest(request.id, {
        hostel_id: selectedHostelId,
        room_id: selectedRoomId || undefined,
        reviewed_by: 'Hostel Head',
      });
      upsertRequest(normalizeRequest(response.data));
      setMessage(`Hostel approved for ${request.student_name}`);
      await loadHostels();
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to approve hostel request'));
    } finally {
      setApprovingRequestId(null);
    }
  };

  const handleMoveAllocation = async (request: StudentHostelRequest) => {
    const selection = getMoveSelection(request);
    const selectedHostelId = selection.hostelId || String(request.hostel_id || '');
    if (!selectedHostelId) {
      setMessage('Move ke liye hostel select karo.');
      return;
    }

    setApprovingRequestId(request.id);
    try {
      const response = await apiService.moveStudentHostelAllocation(request.id, {
        hostel_id: selectedHostelId,
        room_id: selection.roomId || undefined,
        reviewed_by: 'Hostel Head',
      });
      upsertRequest(normalizeRequest(response.data));
      setMessage(`Hostel moved for ${request.student_name}`);
      await loadHostels();
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to move hostel allocation'));
    } finally {
      setApprovingRequestId(null);
    }
  };

  const handleRejectRequest = async (requestId: string | number) => {
    setApprovingRequestId(requestId);
    try {
      const response = await apiService.rejectStudentHostelRequest(requestId, {
        reviewed_by: 'Hostel Head',
      });
      upsertRequest(normalizeRequest(response.data));
      setMessage('Hostel request rejected');
      await loadHostels();
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to reject hostel request'));
    } finally {
      setApprovingRequestId(null);
    }
  };

  const handleVacateAllocation = async (requestId: string | number) => {
    const confirmed = confirm('Is student ko hostel se vacate karna confirm hai?');
    if (!confirmed) return;
    setApprovingRequestId(requestId);
    try {
      const response = await apiService.vacateStudentHostelAllocation(requestId);
      upsertRequest(normalizeRequest(response.data));
      setMessage('Hostel allocation vacated successfully');
      await loadHostels();
    } catch (error: any) {
      setMessage(readApiError(error, 'Failed to vacate hostel allocation'));
    } finally {
      setApprovingRequestId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">Hostel Management</h1>
          <p className="mt-2 text-sm text-slate-500">Hostel create karo, total rooms do, aur request approval yahin se manage karo.</p>
        </div>

        {message ? <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div> : null}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Hostels</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{hostels.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Pending Requests</p>
            <p className="mt-2 text-3xl font-bold text-amber-700">{pendingRequests.length}</p>
          </div>
          <div className="rounded-3xl bg-white p-5 shadow-sm">
            <p className="text-sm font-medium text-slate-500">Allocated Students</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">{allocatedStudents.length}</p>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">{isEditing ? 'Edit Hostel' : 'Create Hostel'}</h2>
            <form onSubmit={handleCreateHostel} className="mt-4 grid gap-3">
              <div className="grid gap-3 md:grid-cols-2">
                <input value={hostelForm.name} onChange={(e) => setHostelForm((current) => ({ ...current, name: e.target.value }))} placeholder="Hostel name" className={inputClass} />
                <input value={hostelForm.gender_category} onChange={(e) => setHostelForm((current) => ({ ...current, gender_category: e.target.value }))} placeholder="Boys / Girls / Mixed" className={inputClass} />
                <input value={hostelForm.hostel_head} onChange={(e) => setHostelForm((current) => ({ ...current, hostel_head: e.target.value }))} placeholder="Hostel head" className={inputClass} />
                <input value={hostelForm.warden_name} onChange={(e) => setHostelForm((current) => ({ ...current, warden_name: e.target.value }))} placeholder="Warden name" className={inputClass} />
                <input
                  type="number"
                  min="0"
                  value={hostelForm.total_rooms}
                  onChange={(e) => setHostelForm((current) => ({ ...current, total_rooms: Number(e.target.value) || 0 }))}
                  placeholder="Total rooms"
                  className={inputClass}
                  disabled={isEditing}
                />
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                  {isEditing ? 'Total rooms add karne ke liye niche Add Room use karo.' : `Student Capacity Auto: ${(Number(hostelForm.total_rooms) || 0) * 2}`}
                </div>
              </div>
              <textarea value={hostelForm.address} onChange={(e) => setHostelForm((current) => ({ ...current, address: e.target.value }))} placeholder="Address / note" className={`${inputClass} min-h-[72px]`} />
              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={saving} className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-black disabled:opacity-50">
                  {saving ? 'Saving...' : isEditing ? 'Update Hostel' : 'Create Hostel'}
                </button>
                {isEditing ? (
                  <button type="button" onClick={handleCancelEdit} className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Cancel Edit
                  </button>
                ) : null}
              </div>
            </form>
          </section>

          <section className="rounded-3xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Hostel Directory</h2>
            {loading ? <p className="mt-4 text-sm text-slate-500">Loading hostels...</p> : null}
            <div className="mt-4 space-y-4">
              {hostels.map((hostel) => (
                <div key={hostel.id || hostel.name} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{hostel.name}</p>
                      <p className="text-sm text-slate-500">Head: {hostel.hostel_head || 'N/A'} | Warden: {hostel.warden_name || 'N/A'}</p>
                      <p className="text-sm text-slate-500">Rooms: {hostel.total_rooms} | Seats: {hostel.occupied_beds}/{hostel.total_capacity} occupied | {hostel.available_beds} available</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEditHostel(hostel)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={deletingHostelId === hostel.id}
                        onClick={() => handleDeleteHostel(hostel)}
                        className="rounded-lg bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                      >
                        {deletingHostelId === hostel.id ? 'Deleting...' : 'Delete'}
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {hostel.rooms.map((room) => (
                      <div key={room.id || room.room_number} className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        Room {room.room_number}: {room.occupied_beds}/{room.total_beds} beds
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                    <input
                      value={roomForms[hostel.id] || ''}
                      onChange={(e) => setRoomForms((current) => ({ ...current, [hostel.id]: e.target.value }))}
                      placeholder="Add room number"
                      className={inputClass}
                    />
                    <button type="button" onClick={() => handleAddHostelRoom(hostel.id)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                      Add Room
                    </button>
                  </div>
                </div>
              ))}
              {!loading && hostels.length === 0 ? <p className="text-sm text-slate-500">No hostels created yet.</p> : null}
            </div>
          </section>
        </div>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Approval Queue</h2>
              <p className="text-sm text-slate-500">Student request approve karte hi seat count auto reduce ho jayega.</p>
            </div>
            <div className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">Pending {pendingRequests.length}</div>
          </div>
          <div className="mt-4 space-y-3">
            {pendingRequests.map((request) => {
              const selection = getMoveSelection(request);
              const selectedHostelId = selection.hostelId || String(request.hostel_id || '');
              const availableRooms = getHostelRooms(selectedHostelId);

              return (
                <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{request.student_name}</p>
                  <p className="text-sm text-slate-500">
                    Roll: {request.roll_number} | Batch: {request.batch} | Class: {[request.class_name, request.section].filter(Boolean).join(' | ') || '-'}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Reference: {request.reference_name || 'N/A'} | Contact: {request.reference_number || 'N/A'}</p>
                  {request.reference_remark ? <p className="mt-1 text-sm text-slate-500">Reference Detail: {request.reference_remark}</p> : null}
                  <p className="mt-1 text-sm text-slate-600">Requested Hostel: {request.hostel_name}</p>
                  {request.requested_notes ? <p className="mt-1 text-sm text-slate-500">Note: {request.requested_notes}</p> : null}
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                    <select
                      value={selection.hostelId || String(request.hostel_id)}
                      onChange={(e) => updateMoveSelection(request.id, 'hostelId', e.target.value)}
                      className={inputClass}
                    >
                      {hostels.map((hostel) => (
                        <option key={hostel.id} value={hostel.id}>
                          {hostel.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selection.roomId}
                      onChange={(e) => updateMoveSelection(request.id, 'roomId', e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Auto room</option>
                      {availableRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.room_number} ({room.available_beds} free)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={approvingRequestId === request.id}
                      onClick={() => handleApproveRequest(request)}
                      className="rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {approvingRequestId === request.id ? 'Allocating...' : 'Allocate'}
                    </button>
                    <button
                      type="button"
                      disabled={approvingRequestId === request.id}
                      onClick={() => handleRejectRequest(request.id)}
                      className="rounded-lg bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                  {availableRooms.length === 0 ? <p className="mt-3 text-sm text-rose-600">Is hostel me abhi koi room seat available nahi hai.</p> : null}
                </div>
              );
            })}
            {pendingRequests.length === 0 ? <p className="text-sm text-slate-500">No pending hostel requests.</p> : null}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Allocated Students</h2>
              <p className="text-sm text-slate-500">Approved students ko yahan se dusre hostel ya room me move kar sakte ho.</p>
            </div>
            <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Allocated {allocatedStudents.length}</div>
          </div>
          <div className="mt-4 space-y-3">
            {allocatedStudents.map((request) => {
              const selection = getMoveSelection(request);
              const selectedHostelId = selection.hostelId || String(request.hostel_id || '');
              const availableRooms = getHostelRooms(selectedHostelId, request.room_id);
              return (
                <div key={request.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="font-semibold text-slate-900">{request.student_name}</p>
                  <p className="text-sm text-slate-500">
                    Current Hostel: {request.hostel_name} | Room: {request.room_number || 'Not assigned'} | Bed: {request.assigned_bed_label || 'N/A'}
                  </p>
                  <div className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
                    <select
                      value={selection.hostelId || String(request.hostel_id)}
                      onChange={(e) => updateMoveSelection(request.id, 'hostelId', e.target.value)}
                      className={inputClass}
                    >
                      {hostels.map((hostel) => (
                        <option key={hostel.id} value={hostel.id}>
                          {hostel.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={selection.roomId || (request.room_id ? String(request.room_id) : '')}
                      onChange={(e) => updateMoveSelection(request.id, 'roomId', e.target.value)}
                      className={inputClass}
                    >
                      <option value="">Auto room</option>
                      {availableRooms.map((room) => (
                        <option key={room.id} value={room.id}>
                          {room.room_number} ({room.available_beds} free)
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={approvingRequestId === request.id}
                      onClick={() => handleMoveAllocation(request)}
                      className="rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      {approvingRequestId === request.id ? 'Moving...' : 'Move Student'}
                    </button>
                    <button
                      type="button"
                      disabled={approvingRequestId === request.id}
                      onClick={() => handleVacateAllocation(request.id)}
                      className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-300 disabled:opacity-50"
                    >
                      Vacate
                    </button>
                  </div>
                </div>
              );
            })}
            {allocatedStudents.length === 0 ? <p className="text-sm text-slate-500">No approved hostel allocations yet.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
