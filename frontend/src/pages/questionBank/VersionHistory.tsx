import { Clock, RotateCcw } from 'lucide-react';

type VersionEntry = {
  id: string;
  version: number;
  created_at: string;
  change_summary?: string;
  changed_by?: string;
};

type Props = {
  versions: VersionEntry[];
  onRestore: (versionId: string) => void;
};

export default function VersionHistory({ versions, onRestore }: Props) {
  if (!versions.length) {
    return (
      <div className="py-6 text-center">
        <Clock className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2 text-[11px] text-slate-400">No version history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {versions.map((v, i) => (
        <div key={v.id} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white p-2">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[9px] font-bold text-blue-700">
            v{v.version}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-slate-700">{v.change_summary || `Version ${v.version}`}</p>
            <p className="text-[10px] text-slate-400">{new Date(v.created_at).toLocaleString()}</p>
          </div>
          {i > 0 && (
            <button
              type="button"
              onClick={() => onRestore(v.id)}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-blue-600"
              title="Restore this version"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
