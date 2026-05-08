// @ts-nocheck
import { Bell, CalendarDays, ClipboardCheck, UserCheck } from 'lucide-react';
import { SmallMetricCard, StatCard } from './AttendancePrimitives';
import {
  deleteAllButtonClass,
  inputClass,
  sectionClass,
} from '../utils/attendanceUtils';
import {
  HolidayCreateForm,
  LeaveApplicationForm,
  ReportFiltersForm,
  StaffMarkingFilters,
  StaffRecordFilters,
  StudentMarkingFilters,
  StudentRecordFilters,
} from '../forms/AttendanceForms';
import {
  HolidayList,
  ReportPreviewTable,
  StaffCalendarGrid,
  StaffDepartmentSummaryTable,
  StaffMarkingTable,
  StaffRecordsTable,
  StudentCalendarGrid,
  StudentMarkingTable,
  StudentRecordsTable,
  TodayBatchSummaryTable,
} from '../tables/AttendanceTables';
import { SelectField } from './AttendancePrimitives';
import { formatDate } from '../utils/attendanceUtils';

export function AttendanceOverviewSection({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Notifications" value={`${vm.notifications.length}`} icon={Bell} tone="indigo" />
        <StatCard
          label="Pending Leaves"
          value={`${vm.leaves.filter((item) => item.status === 'pending').length}`}
          icon={ClipboardCheck}
          tone="amber"
        />
        <StatCard label="Departments" value={`${vm.overview?.department_options?.length || 0}`} icon={UserCheck} tone="emerald" />
        <StatCard label="Holidays" value={`${vm.holidays.length}`} icon={CalendarDays} tone="rose" />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <div className={sectionClass}>
          <h2 className="text-2xl font-bold text-slate-900">Student Overview</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <SmallMetricCard label="Total Students" value={`${vm.overview?.student_count || 0}`} tone="indigo" />
            <SmallMetricCard label="Present" value={`${vm.studentBatchSummary.present}`} tone="emerald" />
            <SmallMetricCard label="Absent" value={`${vm.studentBatchSummary.absent}`} tone="rose" />
          </div>
        </div>
        <div className={sectionClass}>
          <h2 className="text-2xl font-bold text-slate-900">Staff Overview</h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <SmallMetricCard label="Total Staff" value={`${vm.overview?.staff_count || 0}`} tone="indigo" />
            <SmallMetricCard label="Present" value={`${vm.staffDashboard?.present_count || 0}`} tone="emerald" />
            <SmallMetricCard label="Absent" value={`${vm.staffDashboard?.absent_count || 0}`} tone="rose" />
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className={sectionClass}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-slate-900">Recent Notifications</h2>
            <button type="button" onClick={vm.handleDeleteAllNotifications} className={deleteAllButtonClass}>
              Delete All
            </button>
          </div>
          <div className="mt-6 space-y-3">
            {vm.notifications.map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.message}</p>
                    <p className="mt-1 text-sm text-slate-500">{item.notification_type}</p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
                    <button type="button" onClick={() => vm.handleDeleteNotification(item.id)} className={vm.deleteButtonClass}>
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={sectionClass}>
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-2xl font-bold text-slate-900">Holiday Calendar</h2>
            <button type="button" onClick={vm.handleDeleteAllHolidays} className={deleteAllButtonClass}>
              Delete All
            </button>
          </div>
          <div className="mt-6 space-y-3">
            {vm.holidays.map((holiday) => (
              <div key={holiday.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{holiday.title}</p>
                    <p className="mt-1 text-sm text-slate-500">{formatDate(holiday.holiday_date)}</p>
                    <p className="mt-2 text-sm text-slate-600">{holiday.description || 'No description'}</p>
                  </div>
                  <button type="button" onClick={() => vm.handleDeleteHoliday(holiday.id)} className={vm.deleteButtonClass}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export function AttendanceStudentSection({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-6">
      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        <div className={`${sectionClass} min-w-0`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold text-slate-900">Mark Student Attendance</h2>
              <p className="mt-2 text-sm text-slate-500">
                {vm.user?.role === 'teacher'
                  ? 'Teacher timetable ke hisaab se class aur subject auto-load honge.'
                  : 'Date aur batch select karke attendance mark karein.'}
              </p>
              {vm.visibleAttendanceContext?.class_name ? (
                <p className="mt-2 text-sm text-indigo-600">
                  {vm.visibleAttendanceContext.teacher_name ? `${vm.visibleAttendanceContext.teacher_name}: ` : ''}
                  {vm.visibleAttendanceContext.class_name} | {vm.visibleAttendanceContext.section}
                  {vm.visibleAttendanceContext.subject ? ` | ${vm.visibleAttendanceContext.subject}` : ''}
                  {vm.visibleAttendanceContext.start_time && vm.visibleAttendanceContext.end_time
                    ? ` | ${vm.visibleAttendanceContext.start_time} - ${vm.visibleAttendanceContext.end_time}`
                    : ''}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {vm.user?.role === 'teacher' ? (
                <button
                  type="button"
                  onClick={() => void vm.loadTeacherAttendanceContext()}
                  className="rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-100"
                >
                  Auto Load My Class
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  vm.setStudentMarking((current) =>
                    current
                      ? {
                          ...current,
                          students: current.students.map((student) => ({
                            ...student,
                            status: 'present',
                            absence_reason: undefined,
                          })),
                        }
                      : current
                  )
                }
                className="rounded-full bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
              >
                Mark All Present
              </button>
            </div>
          </div>

          <StudentMarkingFilters vm={vm} />
          <StudentMarkingTable vm={vm} />

          <button onClick={vm.handleSaveStudentAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
            Save Attendance
          </button>
        </div>

        <div className="grid min-w-0 gap-6">
          <div className={`${sectionClass} min-w-0`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Student Records</h2>
                <p className="mt-2 text-sm text-slate-500">Batch-wise records with total students count.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={vm.loadStudentRecords} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                  Apply Filters
                </button>
                <button type="button" onClick={vm.handleDeleteAllStudentRecords} className={deleteAllButtonClass}>
                  Delete All
                </button>
              </div>
            </div>
            <p className="mt-4 text-sm text-slate-600">
              Selected batch total students: <span className="font-semibold text-slate-900">{vm.selectedBatchStudentCount}</span>
            </p>
            <StudentRecordFilters vm={vm} />
            <StudentRecordsTable vm={vm} />
          </div>

          <div className={`${sectionClass} min-w-0`}>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Student Dashboard</h2>
              <p className="mt-2 text-sm text-slate-500">Selected date ({vm.todayLabel}) ke saare batches ka present/absent summary.</p>
              <p className="mt-2 text-sm text-slate-600">
                Calendar source:
                <span className="font-semibold text-slate-900">
                  {' '}
                  {vm.calendarBatchLabel ? `Attendance Batch - ${vm.calendarBatchLabel}` : 'Mark Student Attendance se batch select karein'}
                </span>
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Marked Dates:
                <span className="font-semibold text-slate-900">
                  {' '}
                  {vm.studentCalendarMarkedDates.length
                    ? vm.studentCalendarMarkedDates.join(', ')
                    : 'No marked dates in selected month'}
                </span>
              </p>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <input
                type="date"
                value={vm.studentFilters.dashboard_date}
                onChange={(e) => vm.setStudentFilters({ ...vm.studentFilters, dashboard_date: e.target.value })}
                className={`${inputClass} max-w-xs`}
              />
              <button
                type="button"
                onClick={() => vm.loadTodayStudentDashboard(vm.studentFilters.dashboard_date)}
                className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Load Date
              </button>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-4">
              <SmallMetricCard label="Present" value={`${vm.todayOverallSummary.present}`} tone="emerald" />
              <SmallMetricCard label="Absent" value={`${vm.todayOverallSummary.absent}`} tone="rose" />
              <SmallMetricCard label="Late" value={`${vm.todayOverallSummary.late}`} tone="amber" />
              <SmallMetricCard label="Total" value={`${vm.todayOverallSummary.total}`} tone="indigo" />
            </div>
            <TodayBatchSummaryTable vm={vm} />
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
                  <p className="mt-1 text-sm font-medium text-slate-600">{vm.studentCalendarMonthLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="month"
                    value={vm.studentCalendarMonthInputValue}
                    onChange={(e) =>
                      vm.setStudentFilters((current) => ({
                        ...current,
                        dashboard_date: vm.applyMonthInputValue(current.dashboard_date, e.target.value),
                      }))
                    }
                    className={`${inputClass} min-w-[10rem]`}
                  />
                  <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
                    <button
                      type="button"
                      onClick={() =>
                        vm.setStudentFilters((current) => ({
                          ...current,
                          dashboard_date: vm.shiftMonthValue(current.dashboard_date, -1),
                        }))
                      }
                      className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        vm.setStudentFilters((current) => ({
                          ...current,
                          dashboard_date: vm.shiftMonthValue(current.dashboard_date, 1),
                        }))
                      }
                      className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
                <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
              </div>
              <StudentCalendarGrid vm={vm} />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export function AttendanceStaffSection({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-6">
      <section className="grid gap-6 xl:grid-cols-[0.92fr_1.08fr]">
        {!vm.isTeacherSelfView ? (
          <div className={`${sectionClass} min-w-0`}>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">Mark Staff Attendance</h2>
              <p className="mt-2 text-sm text-slate-500">HR / Admin controlled daily attendance.</p>
            </div>
            <StaffMarkingFilters vm={vm} />
            <StaffMarkingTable vm={vm} />

            <button onClick={vm.handleSaveStaffAttendance} className="mt-6 rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800">
              Save Attendance
            </button>

            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Calendar View</h3>
                  <p className="mt-1 text-sm font-medium text-slate-600">{vm.staffCalendarMonthLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    type="month"
                    value={vm.staffCalendarMonthInputValue}
                    onChange={(e) =>
                      vm.setStaffFilters((current) => ({
                        ...current,
                        date: vm.applyMonthInputValue(current.date, e.target.value),
                      }))
                    }
                    className={`${inputClass} min-w-[10rem]`}
                  />
                  <div className="inline-flex overflow-hidden rounded-full border border-slate-300 bg-white">
                    <button
                      type="button"
                      onClick={() =>
                        vm.setStaffFilters((current) => ({
                          ...current,
                          date: vm.shiftMonthValue(current.date, -1),
                        }))
                      }
                      className="px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        vm.setStaffFilters((current) => ({
                          ...current,
                          date: vm.shiftMonthValue(current.date, 1),
                        }))
                      }
                      className="border-l border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                {vm.staffFilters.department
                  ? `Selected department: ${vm.staffFilters.department}`
                  : 'Showing approved leaves and attendance for all departments'}
              </p>
              <p className="mt-2 text-sm text-slate-600">
                Marked Dates:
                <span className="font-semibold text-slate-900">
                  {' '}
                  {vm.staffCalendarMarkedDates.length
                    ? vm.staffCalendarMarkedDates.join(', ')
                    : 'No marked dates in selected month'}
                </span>
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-emerald-800">Present shade</span>
                <span className="rounded-full border border-rose-200 bg-rose-100 px-3 py-1 text-rose-800">Absent shade</span>
                <span className="rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-amber-800">Late shade</span>
                <span className="rounded-full border border-orange-200 bg-orange-100 px-3 py-1 text-orange-800">Half day shade</span>
                <span className="rounded-full border border-sky-200 bg-sky-100 px-3 py-1 text-sky-800">Approved leave</span>
              </div>
              <StaffCalendarGrid vm={vm} />
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Approved Leaves In Selected Month ({vm.staffMonthlyApprovedLeaves.length})
                </p>
                <div className="mt-3 space-y-2 text-sm text-slate-600">
                  {vm.staffMonthlyApprovedLeaveSummary.length ? (
                    vm.staffMonthlyApprovedLeaveSummary.map((leave) => (
                      <p key={leave.id}>
                        {leave.staff_name || `Staff #${leave.staff_member_id}`}: {formatDate(leave.from_date)} to{' '}
                        {formatDate(leave.to_date)} ({leave.leaveDaysInMonth} day{leave.leaveDaysInMonth === 1 ? '' : 's'})
                      </p>
                    ))
                  ) : (
                    <p>No approved leave matches the current month and department filter.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid min-w-0 gap-6">
          <div className={`${sectionClass} min-w-0`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">{vm.isTeacherSelfView ? 'My Attendance Summary' : 'Staff Dashboard'}</h2>
                <p className="mt-2 text-sm text-slate-500">
                  {vm.isTeacherSelfView ? 'Sirf aapki attendance summary aur records dikh rahe hain.' : 'Department-wise attendance summary.'}
                </p>
              </div>
              <button onClick={vm.loadStaffRecords} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                Refresh Records
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <input
                type="date"
                value={vm.staffFilters.dashboardDate}
                onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, dashboardDate: e.target.value })}
                className={inputClass}
              />
              {!vm.isTeacherSelfView ? (
                <SelectField
                  value={vm.staffFilters.dashboardDepartment}
                  onChange={(e) => vm.setStaffFilters({ ...vm.staffFilters, dashboardDepartment: e.target.value })}
                >
                  <option value="">All Departments</option>
                  {vm.departmentOptions.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <div />
              )}
            </div>
            {vm.staffFilters.dashboardDate ? (
              <>
                <div className="mt-6 grid gap-4 md:grid-cols-5">
                  <SmallMetricCard label="Present" value={`${vm.staffDashboard?.present_count || 0}`} tone="emerald" />
                  <SmallMetricCard label="Absent" value={`${vm.staffDashboard?.absent_count || 0}`} tone="rose" />
                  <SmallMetricCard label="Late" value={`${vm.staffDashboard?.late_count || 0}`} tone="amber" />
                  <SmallMetricCard label="Half Day" value={`${vm.staffDashboard?.half_day_count || 0}`} tone="orange" />
                  <SmallMetricCard label="Monthly %" value={`${vm.staffDashboard?.monthly_attendance_percentage || 0}%`} tone="indigo" />
                </div>
                <StaffDepartmentSummaryTable vm={vm} />
              </>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                Staff Dashboard data dekhne ke liye pehle date select karein.
              </div>
            )}
          </div>

          <div className={`${sectionClass} min-w-0`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-2xl font-bold text-slate-900">{vm.isTeacherSelfView ? 'My Attendance Records' : 'Staff Records'}</h2>
              {!vm.isTeacherSelfView ? (
                <button type="button" onClick={vm.handleDeleteAllStaffRecords} className={deleteAllButtonClass}>
                  Delete All
                </button>
              ) : null}
            </div>
            <StaffRecordFilters vm={vm} />
            <StaffRecordsTable vm={vm} />
            {!vm.isTeacherSelfView ? (
              <div className="mt-6 grid gap-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h3 className="text-lg font-semibold text-slate-900">Holiday Calendar</h3>
                  <button type="button" onClick={vm.handleDeleteAllHolidays} className={deleteAllButtonClass}>
                    Delete All
                  </button>
                </div>
                <HolidayCreateForm vm={vm} />
                <HolidayList vm={vm} />
              </div>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

export function AttendanceLeavesSection({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className={sectionClass}>
        <h2 className="text-2xl font-bold text-slate-900">Leave Application</h2>
        <LeaveApplicationForm vm={vm} />
      </section>

      <section className={sectionClass}>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Leave History Log</h2>
            <p className="mt-2 text-sm text-slate-500">
              {vm.isTeacherSelfView ? 'Sirf aapki leave requests yahan dikhengi.' : 'Approve or reject leave requests.'}
            </p>
          </div>
          {!vm.isTeacherSelfView ? (
            <button type="button" onClick={vm.handleDeleteAllLeaves} className={deleteAllButtonClass}>
              Delete All
            </button>
          ) : null}
        </div>
        <div className="mt-6 max-h-[34rem] space-y-3 overflow-auto pr-1">
          {vm.leaves.map((leave) => (
            <div key={leave.id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{leave.staff_name}</p>
                  <p className="mt-1 text-sm text-slate-500">{leave.leave_type.replace('_', ' ')}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {formatDate(leave.from_date)} to {formatDate(leave.to_date)}
                  </p>
                  <p className="mt-2 text-sm text-slate-600">{leave.reason || 'No reason provided'}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      leave.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700'
                        : leave.status === 'rejected'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                    }`}
                  >
                    {leave.status}
                  </span>
                  {!vm.isTeacherSelfView && leave.status === 'pending' ? (
                    <>
                      <button onClick={() => vm.handleLeaveDecision(leave.id, 'approved')} className="rounded-full bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700">
                        Approve
                      </button>
                      <button onClick={() => vm.handleLeaveDecision(leave.id, 'rejected')} className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700">
                        Reject
                      </button>
                    </>
                  ) : null}
                  <button type="button" onClick={() => vm.handleDeleteLeave(leave.id)} className={vm.deleteButtonClass}>
                    {vm.isTeacherSelfView ? 'Withdraw' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function AttendanceReportsSection({ vm }: { vm: any }) {
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
      <section className={sectionClass}>
        <h2 className="text-2xl font-bold text-slate-900">Attendance Reports</h2>
        <ReportFiltersForm vm={vm} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-2xl font-bold text-slate-900">Report Preview</h2>
        <p className="mt-2 text-sm text-slate-500">
          {vm.reportData ? `${vm.reportData.total_records} records loaded.` : 'Run a report to preview data.'}
        </p>
        <ReportPreviewTable vm={vm} />
      </section>
    </div>
  );
}
