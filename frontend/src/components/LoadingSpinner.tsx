import { Loader } from 'lucide-react';

interface Props {
  message?: string;
}

export function LoadingSpinner({ message = 'Loading...' }: Props) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 p-8">
      <Loader className="w-8 h-8 animate-spin text-primary" />
      <p className="text-gray-600">{message}</p>
    </div>
  );
}
