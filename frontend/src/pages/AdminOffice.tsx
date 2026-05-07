import { useNavigate } from 'react-router-dom';
import {
  GraduationCap,
  Users,
  Calendar,
  Tag,
  UserCheck,
  Building,
  Target,
  Zap,
  Upload,
  FileText,
  ClipboardCheck,
} from 'lucide-react';

export default function AdminOffice() {
  const navigate = useNavigate();

  const adminFeatures = [
    {
      title: 'Seating Plan Generation',
      description: 'Generate anti-cheat seating arrangements and manage examination layouts',
      icon: Target,
      color: 'indigo',
      actions: [
        { label: 'Generate Plans', path: '/seating/generate', icon: Zap },
        { label: 'Upload Plans', path: '/seating/plans', icon: Upload },
      ],
    },
    {
      title: 'Rooms Management',
      description: 'Configure exam halls, seating capacity, and facilities',
      icon: Building,
      color: 'purple',
      actions: [{ label: 'Manage Rooms', path: '/rooms', icon: Building }],
    },
    {
      title: 'Batch Management',
      description: 'Create, edit, and manage exam batches dynamically',
      icon: Tag,
      color: 'pink',
      actions: [{ label: 'Manage Batches', path: '/batches', icon: Tag }],
    },
    {
      title: 'Timetable',
      description: 'Schedule classes and maintain the academic calendar',
      icon: Calendar,
      color: 'orange',
      actions: [{ label: 'View Timetable', path: '/timetable', icon: Calendar }],
    },
    {
      title: 'Student Management',
      description: 'Import student sheets and manage exam candidates',
      icon: Users,
      color: 'blue',
      actions: [{ label: 'Manage Students', path: '/students', icon: Users }],
    },
    {
      title: 'Staff Add',
      description: 'Add teaching and non-teaching staff from one structured form',
      icon: Users,
      color: 'green',
      actions: [{ label: 'Add Staff', path: '/staff/add', icon: GraduationCap }],
    },
    {
      title: 'Invigilator Management',
      description: 'Coordinate invigilators and room assignments',
      icon: UserCheck,
      color: 'teal',
      actions: [{ label: 'Manage Invigilators', path: '/invigilators', icon: UserCheck }],
    },
    {
      title: 'Attendance Management',
      description: 'Manage student attendance, staff attendance, leave approvals, alerts, and attendance reports',
      icon: ClipboardCheck,
      color: 'indigo',
      actions: [{ label: 'Open Attendance', path: '/attendance-management', icon: ClipboardCheck }],
    },
    {
      title: 'Reports & Export',
      description: 'Generate reports and export exam data',
      icon: FileText,
      color: 'red',
      actions: [{ label: 'View Reports', path: '/reports', icon: FileText }],
    },
  ];

  const getColorClasses = (color: string) => {
    const colors = {
      indigo: {
        bg: 'bg-indigo-100',
        text: 'text-indigo-600',
        button: 'bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700',
      },
      purple: {
        bg: 'bg-purple-100',
        text: 'text-purple-600',
        button: 'bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700',
      },
      pink: {
        bg: 'bg-pink-100',
        text: 'text-pink-600',
        button: 'bg-gradient-to-r from-pink-500 to-pink-600 hover:from-pink-600 hover:to-pink-700',
      },
      orange: {
        bg: 'bg-orange-100',
        text: 'text-orange-600',
        button: 'bg-gradient-to-r from-orange-500 to-orange-600 hover:from-orange-600 hover:to-orange-700',
      },
      blue: {
        bg: 'bg-blue-100',
        text: 'text-blue-600',
        button: 'bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700',
      },
      green: {
        bg: 'bg-green-100',
        text: 'text-green-600',
        button: 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700',
      },
      teal: {
        bg: 'bg-teal-100',
        text: 'text-teal-600',
        button: 'bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700',
      },
      amber: {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        button: 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600',
      },
      red: {
        bg: 'bg-red-100',
        text: 'text-red-600',
        button: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700',
      },
    };
    return colors[color as keyof typeof colors] || colors.blue;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <main className="mx-auto max-w-7xl p-4 md:p-6 lg:p-8">
        <section className="mb-8 rounded-[2rem] bg-white p-5 shadow-xl md:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.2em] text-indigo-600">Admin Office</p>
              <h1 className="mt-3 text-3xl font-bold text-slate-900 md:text-4xl">Exam Management Hub</h1>
              <p className="mt-4 max-w-2xl text-slate-600">Access exam seating, room planning, batches, timetable, and reports from one professional workspace.</p>
            </div>
            <div className="rounded-[2rem] bg-indigo-50 p-6 text-center text-indigo-700 shadow-sm">
              <GraduationCap className="mx-auto h-10 w-10" />
              <p className="mt-4 text-lg font-semibold">Admin Office</p>
            </div>
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
          {adminFeatures.map((feature, index) => {
            const Icon = feature.icon;
            const colors = getColorClasses(feature.color);
            const buttonClass = `w-full ${colors.button} text-white py-3 px-4 rounded-lg font-semibold transition-all duration-300 shadow-md hover:shadow-lg`;

            return (
              <article key={index} className="rounded-[2rem] bg-white p-5 shadow-xl md:p-6">
                <div className="flex items-center gap-4 mb-4">
                  <div className={`${colors.bg} rounded-2xl p-3`}>
                    <Icon className={`${colors.text} h-6 w-6`} />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-900">{feature.title}</h2>
                    <p className="text-sm text-slate-500">{feature.description}</p>
                  </div>
                </div>
                <div className="space-y-3">
                  {feature.actions.map((action, idx) => {
                    const ActionIcon = action.icon;
                    return (
                      <button key={idx} onClick={() => navigate(action.path)} className={buttonClass}>
                        <div className="flex items-center justify-center gap-2">
                          <ActionIcon className="h-4 w-4" />
                          <span>{action.label}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </main>
    </div>
  );
}
