import { AlertTriangle } from 'lucide-react';

type Props = {
  title?: string;
  message?: string;
  compact?: boolean;
};

const defaultMessage =
  'This module is temporarily unavailable during the ongoing Supabase migration.';

export function MigrationUnavailableNotice({
  title = 'Temporarily Unavailable',
  message = defaultMessage,
  compact = false,
}: Props) {
  return (
    <div
      className={`rounded-xl border border-amber-200 bg-amber-50 text-amber-900 ${
        compact ? 'p-3' : 'p-5'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-amber-100 p-2 text-amber-700">
          <AlertTriangle className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </div>
        <div>
          <p className={`font-semibold ${compact ? 'text-sm' : 'text-base'}`}>{title}</p>
          <p className={`mt-1 ${compact ? 'text-xs' : 'text-sm'}`}>{message}</p>
        </div>
      </div>
    </div>
  );
}
