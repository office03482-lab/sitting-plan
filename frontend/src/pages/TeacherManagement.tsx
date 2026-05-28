import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit, Trash2, Search, User, Mail, Phone } from 'lucide-react';
import {
  apiService,
  getMigrationUnavailableMessage,
  isMigrationGuardError,
  logIfUnexpectedRequestError,
} from '../services/api';
import { Alert } from '../components/Alert';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { MigrationUnavailableNotice } from '../components/MigrationUnavailableNotice';
import type { Teacher } from '../types';

const TeacherManagement: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingTeacher, setEditingTeacher] = useState<Teacher | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [migrationUnavailable, setMigrationUnavailable] = useState(false);
  const [shiftForm, setShiftForm] = useState({ working_hours_start: '09:00', working_hours_end: '17:00' });
  const [attendanceThreshold, setAttendanceThreshold] = useState(75);
  const navigate = useNavigate();

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    loadTeachers();
    loadShiftSettings();
  }, []);

  const loadTeachers = async () => {
    try {
      setLoading(true);
      const response = await apiService.listTeachers();
      setTeachers(response.data);
      setMigrationUnavailable(false);
    } catch (error) {
      logIfUnexpectedRequestError('Error loading teachers:', error);
      const guarded = isMigrationGuardError(error);
      setMigrationUnavailable(guarded);
      setAlert({
        type: 'error',
        message: guarded
          ? getMigrationUnavailableMessage('Teaching staff management')
          : 'Failed to load teachers',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadShiftSettings = async () => {
    try {
      const response = await apiService.getAttendanceSettings();
      setShiftForm({
        working_hours_start: response.data.working_hours_start,
        working_hours_end: response.data.working_hours_end,
      });
      setAttendanceThreshold(response.data.minimum_attendance_threshold);
    } catch (error) {
      console.warn('Unable to load shift settings', error);
    }
  };

  const handleSaveShiftSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiService.updateAttendanceSettings({
        minimum_attendance_threshold: attendanceThreshold,
        working_hours_start: shiftForm.working_hours_start,
        working_hours_end: shiftForm.working_hours_end,
      });
      setAlert({ type: 'success', message: 'Teaching shift timings updated successfully' });
    } catch (error) {
      console.error('Error updating shift settings:', error);
      setAlert({ type: 'error', message: 'Failed to update teaching shift timings' });
    }
  };

  const filteredTeachers = teachers.filter(teacher =>
    teacher.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    teacher.subject.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const resetForm = () => {
    setFormData({
      name: '',
      subject: '',
      email: '',
      phone: '',
    });
    setEditingTeacher(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim() || !formData.subject.trim()) {
      setAlert({ type: 'error', message: 'Name and subject are required' });
      return;
    }

    try {
      if (editingTeacher) {
        await apiService.updateTeacher(editingTeacher.id, formData);
        setAlert({ type: 'success', message: 'Teacher updated successfully' });
      } else {
        await apiService.createTeacher(formData);
        setAlert({ type: 'success', message: 'Teacher created successfully' });
      }
      resetForm();
      loadTeachers();
    } catch (error) {
      console.error('Error saving teacher:', error);
      setAlert({ type: 'error', message: 'Failed to save teacher' });
    }
  };

  const handleEdit = (teacher: Teacher) => {
    setEditingTeacher(teacher);
    setFormData({
      name: teacher.name,
      subject: teacher.subject,
      email: teacher.email || '',
      phone: teacher.phone || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (teacherId: string | number) => {
    if (!confirm('Are you sure you want to delete this teacher?')) return;

    try {
      await apiService.deleteTeacher(teacherId);
      setAlert({ type: 'success', message: 'Teacher deleted successfully' });
      loadTeachers();
    } catch (error) {
      console.error('Error deleting teacher:', error);
      setAlert({ type: 'error', message: 'Failed to delete teacher' });
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Teaching Managment</h1>
        <button
          onClick={() => navigate('/staff/add')}
          disabled={migrationUnavailable}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus size={20} />
          Add Staff
        </button>
      </div>

      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {migrationUnavailable ? (
        <div className="mb-6">
          <MigrationUnavailableNotice message={getMigrationUnavailableMessage('Teaching staff management')} />
        </div>
      ) : null}

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search teachers by name or subject..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900">Teaching Shift Timings</h2>
        <form onSubmit={handleSaveShiftSettings} className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            value={shiftForm.working_hours_start}
            onChange={(e) => setShiftForm({ ...shiftForm, working_hours_start: e.target.value })}
            placeholder="Start time"
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <input
            value={shiftForm.working_hours_end}
            onChange={(e) => setShiftForm({ ...shiftForm, working_hours_end: e.target.value })}
            placeholder="End time"
            className="rounded-lg border border-gray-300 px-3 py-2"
          />
          <button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-700">
            Save Timings
          </button>
        </form>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingTeacher ? 'Edit Teacher' : 'Add New Teacher'}
            </h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Subject *
                </label>
                <input
                  type="text"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700"
                >
                  {editingTeacher ? 'Update' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={resetForm}
                  className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-400"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Teachers Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Teacher
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Subject
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredTeachers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-center text-gray-500">
                    {migrationUnavailable
                      ? 'Teaching staff data temporarily unavailable.'
                      : searchTerm
                        ? 'No teachers found matching your search.'
                        : 'No teachers added yet.'}
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((teacher) => (
                  <tr key={teacher.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <User className="h-8 w-8 text-gray-400 mr-3" />
                        <div>
                          <div className="text-sm font-medium text-gray-900">
                            {teacher.name}
                          </div>
                          <div className="text-sm text-gray-500">
                            ID: {teacher.id}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 py-1 text-xs font-medium bg-blue-100 text-blue-800 rounded-full">
                        {teacher.subject}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900 space-y-1">
                        {teacher.email && (
                          <div className="flex items-center">
                            <Mail size={14} className="mr-1 text-gray-400" />
                            {teacher.email}
                          </div>
                        )}
                        {teacher.phone && (
                          <div className="flex items-center">
                            <Phone size={14} className="mr-1 text-gray-400" />
                            {teacher.phone}
                          </div>
                        )}
                        {!teacher.email && !teacher.phone && (
                          <span className="text-gray-400">No contact info</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleEdit(teacher)}
                          className="text-indigo-600 hover:text-indigo-900"
                          title="Edit teacher"
                        >
                          <Edit size={16} />
                        </button>
                        <button
                          onClick={() => handleDelete(teacher.id)}
                          className="text-red-600 hover:text-red-900"
                          title="Delete teacher"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      <div className="mt-6 bg-white rounded-lg shadow p-4">
        <div className="text-sm text-gray-600">
          Total Teachers: <span className="font-semibold text-gray-900">{teachers.length}</span>
          {searchTerm && (
            <> | Showing: <span className="font-semibold text-gray-900">{filteredTeachers.length}</span></>
          )}
        </div>
      </div>
    </div>
  );
};

export default TeacherManagement;
