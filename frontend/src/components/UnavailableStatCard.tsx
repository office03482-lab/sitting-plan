import type { LucideIcon } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  label: string;
  unavailableLabel?: string;
};

export function UnavailableStatCard({
  icon: Icon,
  label,
  unavailableLabel = 'Data temporarily unavailable',
}: Props) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
      <div className="flex items-center">
        <div className="rounded-lg bg-amber-100 p-2">
          <Icon className="h-6 w-6 text-amber-700" />
        </div>
        <div className="ml-4">
          <p className="text-sm font-medium text-amber-900">{label}</p>
          <p className="text-sm font-semibold text-amber-700">{unavailableLabel}</p>
        </div>
      </div>
    </div>
  );
}
