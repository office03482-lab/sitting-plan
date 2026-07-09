import { useLocation } from 'react-router-dom';
import { usePlatformAdminSchoolStore } from '@store/platformAdminSchool';
import PlatformAdminSchoolSelector from './PlatformAdminSchoolSelector';

export default function PlatformAdminSchoolScopeBanner() {
  const location = useLocation();
  const { activeSchoolId, activeSchoolName, clearActiveSchool, setActiveSchool } =
    usePlatformAdminSchoolStore();
  const isPlatformRoute = location.pathname.startsWith('/platform');

  if (isPlatformRoute || !activeSchoolId) {
    return null;
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-emerald-800">
          Managing: <span className="font-semibold">{activeSchoolName || activeSchoolId}</span>
        </span>
      </div>
      <div className="flex items-center gap-2">
        <PlatformAdminSchoolSelector
          trigger={
            <button
              type="button"
              className="rounded-full border border-emerald-300 bg-white px-3 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
            >
              Switch School
            </button>
          }
        />
        <button
          type="button"
          onClick={() => clearActiveSchool()}
          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
        >
          Exit School Scope
        </button>
      </div>
    </div>
  );
}
