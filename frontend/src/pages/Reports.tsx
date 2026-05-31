import React, { useEffect, useState } from 'react';
import { BarChart3, FileSpreadsheet, FileText, Users } from 'lucide-react';

import { Alert } from '../components/Alert';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { UnavailableStatCard } from '../components/UnavailableStatCard';
import { useAuth } from '@/contexts/AuthProvider';
import {
  apiService,
  getRequestErrorMessage as getSharedRequestErrorMessage,
  isTemporarilyUnavailableDataError,
  logIfUnexpectedRequestError,
} from '../services/api';
import type { SeatingPlan, Student, Teacher } from '../types';

const getRequestErrorMessage = (error: any, fallback: string) =>
  getSharedRequestErrorMessage(error, fallback);

const getPlanTypeLabel = (type: SeatingPlan['plan_type']) => {
  if (type === 'all_in_one') return 'All-in-One';
  if (type === 'strict') return 'Strict';
  return 'Compact';
};

const Reports: React.FC = () => {
  const { authReady, sessionReady, schoolContextReady, session } = useAuth();
  const canRunRequests = authReady && sessionReady && schoolContextReady && !!session;
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [seatingPlans, setSeatingPlans] = useState<SeatingPlan[]>([]);
  const [teacherCount, setTeacherCount] = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [availability, setAvailability] = useState({
    teachers: false,
    students: false,
  });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const examExportGroups = Array.from(
    new Map(
      seatingPlans.map((plan) => [
        `${plan.exam_id}-${plan.plan_type}`,
        {
          examId: plan.exam_id,
          examName: plan.exam_name || `Exam ${plan.exam_id}`,
          examSubject: plan.exam_subject || '',
          planType: plan.plan_type,
          roomCount: 0,
        },
      ])
    ).values()
  ).map((group) => ({
    ...group,
    roomCount: seatingPlans.filter(
      (plan) => plan.exam_id === group.examId && plan.plan_type === group.planType
    ).length,
  }));
  const filteredSeatingPlans = seatingPlans;
  const displayedSeatingPlans = filteredSeatingPlans;

  useEffect(() => {
    if (!canRunRequests) return;
    loadData();
  }, [canRunRequests]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [teachersCountRes, studentsCountRes, plansRes] = await Promise.allSettled([
        apiService.getTeachersCount(),
        apiService.getStudentsCount(),
        apiService.listAllPlans(),
      ]);

      const failedSections: string[] = [];

      if (teachersCountRes.status === 'fulfilled') {
        setTeacherCount(Number(teachersCountRes.value.data || 0));
        setAvailability((current) => ({ ...current, teachers: false }));
      } else {
        logIfUnexpectedRequestError('Error loading teachers count:', teachersCountRes.reason);
        setAvailability((current) => ({
          ...current,
          teachers: isTemporarilyUnavailableDataError(teachersCountRes.reason),
        }));
        failedSections.push('teachers');
      }

      if (studentsCountRes.status === 'fulfilled') {
        setStudentCount(Number(studentsCountRes.value.data || 0));
        setAvailability((current) => ({ ...current, students: false }));
      } else {
        logIfUnexpectedRequestError('Error loading students count:', studentsCountRes.reason);
        setAvailability((current) => ({
          ...current,
          students: isTemporarilyUnavailableDataError(studentsCountRes.reason),
        }));
        failedSections.push('students');
      }

      if (plansRes.status === 'fulfilled') {
        console.log('[Reports]', 'API_ROWS', plansRes.value.data?.length, plansRes.value.data);
        setSeatingPlans(plansRes.value.data);
      } else {
        logIfUnexpectedRequestError('Error loading seating plans:', plansRes.reason);
        setSeatingPlans([]);
        failedSections.push('seating plans');
      }

      if (failedSections.length > 0) {
        const detailedFailures = [
          teachersCountRes.status !== 'fulfilled' ? `Teachers: ${getRequestErrorMessage(teachersCountRes.reason, 'Teachers report data load nahi hua.')}` : null,
          studentsCountRes.status !== 'fulfilled' ? `Students: ${getRequestErrorMessage(studentsCountRes.reason, 'Students report data load nahi hua.')}` : null,
          plansRes.status !== 'fulfilled' ? `Seating Plans: ${getRequestErrorMessage(plansRes.reason, 'Seating plan report data load nahi hua.')}` : null,
        ].filter(Boolean);
        setAlert({
          type: 'error',
          message: detailedFailures.join(' | ') || `Some report sections could not load: ${failedSections.join(', ')}`,
        });
      } else {
        setAlert(null);
      }
    } finally {
      setLoading(false);
    }
  };

  const ensureTeachersLoaded = async () => {
    if (teachers.length > 0) return teachers;
    if (availability.teachers) {
      throw new Error('Teachers report data is temporarily unavailable.');
    }
    const response = await apiService.listTeachers();
    console.log('[Reports][Teachers]', 'API_ROWS', response.data?.length, response.data);
    setTeachers(response.data);
    return response.data;
  };

  const ensureStudentsLoaded = async () => {
    if (students.length > 0) return students;
    if (availability.students) {
      throw new Error('Students report data is temporarily unavailable.');
    }
    const response = await apiService.listStudents();
    console.log('[Reports][Students]', 'API_ROWS', response.data?.length, response.data);
    setStudents(response.data);
    return response.data;
  };

  useEffect(() => {
    console.log('[Reports]', 'SET_STATE_ROWS', seatingPlans.length);
  }, [seatingPlans]);

  useEffect(() => {
    console.log('[Reports]', 'FILTERED_ROWS', filteredSeatingPlans.length);
  }, [filteredSeatingPlans]);

  console.log('[Reports]', 'RENDER_ROWS', displayedSeatingPlans.length);

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    downloadBlob(new Blob([content], { type: mimeType }), filename);
    setAlert({ type: 'success', message: 'Report exported successfully' });
  };

  const exportTextReport = async (type: 'teachers' | 'students') => {
    if (type === 'teachers') {
      const teacherRows = await ensureTeachersLoaded();
      const content = `TEACHERS REPORT
Generated: ${new Date().toLocaleDateString()}

Total Teachers: ${teacherRows.length}

${teacherRows
  .map(
    (teacher) => `Name: ${teacher.name}
Subject: ${teacher.subject}
Email: ${teacher.email || 'N/A'}
Phone: ${teacher.phone || 'N/A'}
---
`
  )
  .join('\n')}`;
      downloadFile(content, 'teachers-report.txt', 'text/plain');
      return;
  }

  const studentRows = await ensureStudentsLoaded();
  const content = `STUDENTS REPORT
Generated: ${new Date().toLocaleDateString()}

Total Students: ${studentRows.length}

${studentRows
  .map(
    (student) => `Name: ${student.name}
Roll Number: ${student.roll_number}
Batch: ${student.batch}
Class: ${[student.class_name, student.section].filter(Boolean).join(' | ') || 'N/A'}
Email: ${student.email || 'N/A'}
Phone: ${student.phone || 'N/A'}
---
`
  )
  .join('\n')}`;
    downloadFile(content, 'students-report.txt', 'text/plain');
  };

  const exportCsvReport = async (type: 'teachers' | 'students') => {
    if (type === 'teachers') {
      const teacherRows = await ensureTeachersLoaded();
      const csv = `Name,Subject,Email,Phone
${teacherRows
  .map(
    (teacher) =>
      `"${teacher.name}","${teacher.subject}","${teacher.email || ''}","${teacher.phone || ''}"`
  )
  .join('\n')}`;
      downloadFile(csv, 'teachers-report.csv', 'text/csv');
      return;
    }

    const studentRows = await ensureStudentsLoaded();
    const csv = `Name,Roll Number,Batch,Class,Email,Phone
${studentRows
  .map(
    (student) =>
      `"${student.name}","${student.roll_number}","${student.batch}","${[student.class_name, student.section].filter(Boolean).join(' | ')}","${student.email || ''}","${student.phone || ''}"`
  )
  .join('\n')}`;
    downloadFile(csv, 'students-report.csv', 'text/csv');
  };

  const handleExportPDF = async (type: string, id?: string | number) => {
    try {
      setExporting(`${type}-pdf`);

      if (type === 'seating-plan' && id) {
        const response = await apiService.exportPDF(id);
        downloadBlob(response.data, 'seating-plan-report.pdf');
        setAlert({ type: 'success', message: 'Report exported successfully' });
        return;
      }

      if (type === 'teachers' || type === 'students') {
        await exportTextReport(type);
        return;
      }

      throw new Error('Unknown export type');
    } catch (error) {
      console.error('Export error:', error);
      setAlert({ type: 'error', message: 'Failed to export report' });
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async (type: string, id?: string | number) => {
    try {
      setExporting(`${type}-excel`);

      if (type === 'seating-plan' && id) {
        const response = await apiService.exportExcel(id);
        downloadBlob(response.data, `seating-plan-${id}.xlsx`);
        setAlert({ type: 'success', message: 'Report exported successfully' });
        return;
      }

      if (type === 'teachers' || type === 'students') {
        await exportCsvReport(type);
        return;
      }

      throw new Error('Unknown export type');
    } catch (error) {
      console.error('Export error:', error);
      setAlert({ type: 'error', message: 'Failed to export report' });
    } finally {
      setExporting(null);
    }
  };

  const handleExportAllRoomsExcel = async (examId: string | number, planType: 'strict' | 'compact' | 'all_in_one') => {
    try {
      setExporting(`all-rooms-${examId}-${planType}`);
      const response = await apiService.exportAllRoomsExcel(examId, planType);
      downloadBlob(response.data, `seating-plan-all-rooms-exam-${examId}-${planType}.xlsx`);
      setAlert({ type: 'success', message: 'All rooms report exported successfully' });
    } catch (error) {
      console.error('Export error:', error);
      setAlert({ type: 'error', message: 'Failed to export all rooms report' });
    } finally {
      setExporting(null);
    }
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Reports & Export</h1>
      </div>

      {alert && <Alert type={alert.type} message={alert.message} onClose={() => setAlert(null)} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {availability.teachers ? (
          <UnavailableStatCard icon={Users} label="Total Teachers" />
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-green-100 rounded-lg">
                <Users className="h-6 w-6 text-green-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Teachers</p>
                <p className="text-2xl font-bold text-gray-900">{teacherCount}</p>
              </div>
            </div>
          </div>
        )}

        {availability.students ? (
          <UnavailableStatCard icon={BarChart3} label="Total Students" />
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-2 bg-purple-100 rounded-lg">
                <BarChart3 className="h-6 w-6 text-purple-600" />
              </div>
              <div className="ml-4">
                <p className="text-sm font-medium text-gray-600">Total Students</p>
                <p className="text-2xl font-bold text-gray-900">{studentCount}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Seating Plans</p>
              <p className="text-2xl font-bold text-gray-900">{seatingPlans.length}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <FileText className="mr-2 h-5 w-5" />
              Seating Plan Exports
            </h3>
            {seatingPlans.length === 0 ? (
              <p className="text-sm text-gray-500">Generate seating plans first to enable PDF and Excel export.</p>
            ) : (
              <div className="space-y-3">
                {examExportGroups.map((group) => (
                  <div key={`all-rooms-${group.examId}-${group.planType}`} className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-medium text-emerald-900">
                          {group.examName} - All Rooms ({getPlanTypeLabel(group.planType)})
                        </p>
                        <p className="text-sm text-emerald-700">
                          {group.examSubject || 'Subject not set'} | {group.roomCount} room plan(s)
                        </p>
                      </div>
                      <button
                        onClick={() => handleExportAllRoomsExcel(group.examId, group.planType)}
                        disabled={exporting === `all-rooms-${group.examId}-${group.planType}`}
                        className="flex items-center gap-2 rounded bg-emerald-600 px-3 py-2 text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        <FileSpreadsheet size={14} />
                        {exporting === `all-rooms-${group.examId}-${group.planType}` ? 'Exporting...' : 'Excel All Rooms'}
                      </button>
                    </div>
                  </div>
                ))}
                {displayedSeatingPlans.map((plan) => (
                  <div key={plan.id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{plan.name}</p>
                      <p className="text-sm text-gray-500">
                        {getPlanTypeLabel(plan.plan_type)} | {plan.students_assigned} students
                      </p>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        onClick={() => handleExportPDF('seating-plan', plan.id)}
                        className="flex items-center gap-2 rounded bg-red-600 px-3 py-2 text-white hover:bg-red-700"
                      >
                        <FileText size={14} />
                        PDF
                      </button>
                      <button
                        onClick={() => handleExportExcel('seating-plan', plan.id)}
                        className="flex items-center gap-2 rounded bg-green-600 px-3 py-2 text-white hover:bg-green-700"
                      >
                        <FileSpreadsheet size={14} />
                        Excel
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <Users className="mr-2 h-5 w-5" />
              Teachers Report
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => handleExportPDF('teachers')}
                disabled={exporting === 'teachers-pdf' || availability.teachers}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                <FileText size={16} />
                {exporting === 'teachers-pdf' ? 'Exporting...' : 'Export as Text'}
              </button>
              <button
                onClick={() => handleExportExcel('teachers')}
                disabled={exporting === 'teachers-excel' || availability.teachers}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <FileSpreadsheet size={16} />
                {exporting === 'teachers-excel' ? 'Exporting...' : 'Export as CSV'}
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
              <BarChart3 className="mr-2 h-5 w-5" />
              Students Report
            </h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => handleExportPDF('students')}
                disabled={exporting === 'students-pdf' || availability.students}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                <FileText size={16} />
                {exporting === 'students-pdf' ? 'Exporting...' : 'Export as Text'}
              </button>
              <button
                onClick={() => handleExportExcel('students')}
                disabled={exporting === 'students-excel' || availability.students}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                <FileSpreadsheet size={16} />
                {exporting === 'students-excel' ? 'Exporting...' : 'Export as CSV'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 bg-blue-50 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">Export Information</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>- Timetable report aur export options ab `Timetable Management` page me shift kar diye gaye hain.</li>
          <li>- Teacher aur student exports ko simple text/CSV form me waise hi rakha gaya hai.</li>
        </ul>
      </div>
    </div>
  );
};

export default Reports;
