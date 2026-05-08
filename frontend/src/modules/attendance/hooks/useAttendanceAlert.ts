import { useEffect } from 'react';

export function useAttendanceAlert(alert: { type: string } | null, clearAlert: () => void) {
  useEffect(() => {
    if (!alert || alert.type !== 'success') return;
    const timer = window.setTimeout(() => clearAlert(), 2800);
    return () => window.clearTimeout(timer);
  }, [alert, clearAlert]);
}
