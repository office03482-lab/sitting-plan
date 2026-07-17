import React, { useState, useEffect } from 'react';
import { Users, Search, Plus, Edit, Trash2, Mail, Phone } from 'lucide-react';
import { apiService } from '../services/api';
import { useRefDataStore } from '@store/referenceData';
import { Teacher } from '../types';
import { Alert } from '../components/Alert';
import { LoadingSpinner } from '../components/LoadingSpinner';

const DualManagement: React.FC = () => {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingItem, setEditingItem] = useState<Teacher | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    subject: '',
    email: '',
    phone: '',
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const data = await useRefDataStore.getState().getTeachers(1);
      setTeachers(data);
    } catch (error) {
      console.error('Error loading teachers:', error);
      setAlert({ type: 'error', message: 'Failed to load teachers' });
    } finally {
      setLoading(false);
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
    setEditingItem(null);
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      setAlert({ type: 'error', message: 'Name is required' });
      return;
    }

    if (!formData.subject.trim()) {
      setAlert({ type: 'error', message: 'Subject is required' });
      return;
    }

    try {
      const teacherData = {
        name: formData.name,
        subject: formData.subject,
        email: formData.email,
        phone: formData.phone,
      };

      if (editingItem) {
        await apiService.updateTeacher(editingItem.id, teacherData);
        setAlert({ type: 'success', message: 'Teacher updated successfully' });
      } else {
        await apiService.createTeacher(teacherData);
        setAlert({ type: 'success', message: 'Teacher created successfully' });
      }
      resetForm();
      loadData();
    } catch (error) {
      console.error('Error saving teacher:', error);
      setAlert({ type: 'error', message: 'Failed to save teacher' });
    }
  };

  const handleEdit = (teacher: Teacher) => {
    setEditingItem(teacher);
    setFormData({
      name: teacher.name,
      subject: teacher.subject,
      email: teacher.email || '',
      phone: teacher.phone || '',
    });
    setShowForm(true);
  };

  const handleDelete = async (teacher: Teacher) => {
    if (!confirm('Are you sure you want to delete this teacher?')) return;

    try {
      await apiService.deleteTeacher(teacher.id);
      setAlert({ type: 'success', message: 'Teacher deleted successfully' });
      loadData();
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
        <h1 className="text-2xl font-bold text-gray-900">Teacher Management</h1>
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus size={20} />
          Add Teacher
        </button>
      </div>

      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search teachers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Form Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingItem ? 'Edit Teacher' : 'Add New Teacher'}
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
                  {editingItem ? 'Update' : 'Create'}
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
                    {searchTerm ? 'No teachers found matching your search.' : 'No teachers added yet.'}
                  </td>
                </tr>
              ) : (
                filteredTeachers.map((teacher) => (
                  <tr key={teacher.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <Users className="h-8 w-8 text-gray-400 mr-3" />
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
                          onClick={() => handleDelete(teacher)}
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
          <span className="font-semibold text-gray-900">Total Teachers:</span> {teachers.length}
          {searchTerm && (
            <> | Showing: <span className="font-semibold text-gray-900">{filteredTeachers.length}</span></>
          )}
        </div>
      </div>
    </div>
  );
};

export default DualManagement;
