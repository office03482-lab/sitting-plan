import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock3, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { apiService, getRequestErrorMessage } from '@services/api';
import type { Invigilator } from '@types';

export default function NonTeachingManagement() {
  const navigate = useNavigate();
  const [staff, setStaff] = useState<Invigilator[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [threshold, setThreshold] = useState(75);
  const [showForm, setShowForm] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Invigilator | null>(null);
  const [shiftForm, setShiftForm] = useState({
    working_hours_start: '09:00',
    working_hours_end: '17:00',
  });
  const [formData, setFormData] = useState({
    staff_id: '',
    name: '',
    email: '',
    phone: '',
    department: '',
    designation: '',
    is_active: true,
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [staffRes, settingsRes] = await Promise.all([
        apiService.listInvigilators(1, undefined, 0, 500),
        apiService.getAttendanceSettings(),
      ]);
      setStaff(staffRes.data);
      setShiftForm({
        working_hours_start: settingsRes.data.working_hours_start,
        working_hours_end: settingsRes.data.working_hours_end,
      });
      setThreshold(settingsRes.data.minimum_attendance_threshold);
    } catch (error) {
      setStaff([]);
      setMessage(getRequestErrorMessage(error, 'Failed to load non-teaching staff.'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSaveShift = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSaving(true);
      await apiService.updateAttendanceSettings({
        minimum_attendance_threshold: threshold,
        working_hours_start: shiftForm.working_hours_start,
        working_hours_end: shiftForm.working_hours_end,
      });
      setMessage('Non-teaching shift timings saved.');
      setTimeout(() => setMessage(''), 2500);
    } finally {
      setSaving(false);
    }
  };

  const clearForm = () => {
      setFormData({
        staff_id: '',
        name: '',
        email: '',
        phone: '',
        department: '',
        designation: '',
        is_active: true,
      });
    setEditingStaff(null);
    setShowForm(false);
  };

  const handleAddStaff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSaving(true);
      await apiService.createInvigilator(formData, 1);
      setMessage('Non-teaching staff added successfully.');
      clearForm();
      await loadData();
      setTimeout(() => setMessage(''), 2500);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setMessage(typeof detail === 'string' ? detail : 'Failed to add non-teaching staff.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditClick = (member: Invigilator) => {
    setEditingStaff(member);
    setFormData({
      staff_id: member.staff_id,
      name: member.name,
      email: member.email || '',
      phone: member.phone || '',
      department: member.department || '',
      designation: member.designation || '',
      is_active: member.is_active,
    });
    setShowForm(true);
  };

  const handleUpdateStaff = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingStaff) return;
    try {
      setSaving(true);
      await apiService.updateInvigilator(editingStaff.id, formData);
      setMessage('Non-teaching staff updated successfully.');
      clearForm();
      await loadData();
      setTimeout(() => setMessage(''), 2500);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setMessage(typeof detail === 'string' ? detail : 'Failed to update non-teaching staff.');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteStaff = async (id: number) => {
    if (!window.confirm('Delete this non-teaching staff member?')) return;
    try {
      setSaving(true);
      await apiService.deleteInvigilator(id);
      setMessage('Non-teaching staff deleted successfully.');
      await loadData();
      setTimeout(() => setMessage(''), 2500);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setMessage(typeof detail === 'string' ? detail : 'Failed to delete non-teaching staff.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-3xl bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold text-slate-900">Non Teaching Management</h1>
          <p className="mt-2 text-sm text-slate-600">
            Non-teaching attendance data yahan exam modules se auto-sync hota hai.
          </p>
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Clock3 className="h-5 w-5 text-indigo-600" />
            <h2 className="text-xl font-semibold text-slate-900">Shift Timings</h2>
          </div>
          <form onSubmit={handleSaveShift} className="grid gap-3 md:grid-cols-3">
            <input
              value={shiftForm.working_hours_start}
              onChange={(e) => setShiftForm({ ...shiftForm, working_hours_start: e.target.value })}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="Start time"
            />
            <input
              value={shiftForm.working_hours_end}
              onChange={(e) => setShiftForm({ ...shiftForm, working_hours_end: e.target.value })}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
              placeholder="End time"
            />
            <button
              disabled={saving}
              className="rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-70"
            >
              {saving ? 'Saving...' : 'Save Timings'}
            </button>
          </form>
          {message ? <p className="mt-3 text-sm text-emerald-700">{message}</p> : null}
        </section>

        <section className="mt-6 rounded-3xl bg-white p-6 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-5 w-5 text-indigo-600" />
            <h2 className="text-xl font-semibold text-slate-900">Non-Teaching Staff</h2>
          </div>
          <div className="mb-4">
            <button
              onClick={() => navigate('/staff/add')}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              Add Staff
            </button>
          </div>

          {showForm ? (
            <form
              onSubmit={editingStaff ? handleUpdateStaff : handleAddStaff}
              className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2"
            >
              <input
                value={formData.staff_id}
                onChange={(e) => setFormData({ ...formData, staff_id: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Staff ID"
                required
              />
              <input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Full Name"
                required
              />
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Email"
              />
              <input
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Phone"
              />
              <input
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Department"
                required
              />
              <input
                value={formData.designation}
                onChange={(e) => setFormData({ ...formData, designation: e.target.value })}
                className="rounded-xl border border-slate-300 px-4 py-3 text-sm"
                placeholder="Designation"
              />
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 md:col-span-2">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
                Active
              </label>
              <div className="md:col-span-2 flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-70"
                >
                  {saving ? 'Saving...' : editingStaff ? 'Update Non-Teaching' : 'Add Non-Teaching'}
                </button>
                <button
                  type="button"
                  onClick={clearForm}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : null}

          {loading ? (
            <p className="text-sm text-slate-500">Loading staff...</p>
          ) : (
            <div className="space-y-2">
              {staff.map((member) => (
                <div key={member.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{member.name}</p>
                      <p>{member.staff_id} | {member.department || 'Department not set'}</p>
                      <p className="text-xs text-slate-500">{member.designation || 'Staff'}</p>
                      {member.email ? <p className="text-xs text-slate-500">{member.email}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditClick(member)}
                        className="rounded-lg border border-slate-300 bg-white p-2 text-slate-700 hover:bg-slate-100"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteStaff(member.id)}
                        className="rounded-lg border border-red-200 bg-red-50 p-2 text-red-600 hover:bg-red-100"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {!staff.length ? <p className="text-sm text-slate-500">No non-teaching staff found.</p> : null}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
