import { useEffect } from 'react';
import { AlertCircle, CheckCircle, InfoIcon, AlertTriangle } from 'lucide-react';

interface Props {
  message: unknown;
  type?: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
  autoCloseMs?: number;
}

const iconMap = {
  success: <CheckCircle className="w-5 h-5" />,
  error: <AlertCircle className="w-5 h-5" />,
  warning: <AlertTriangle className="w-5 h-5" />,
  info: <InfoIcon className="w-5 h-5" />,
};

const colorMap = {
  success: 'bg-green-100 border-green-400 text-green-800',
  error: 'bg-red-100 border-red-400 text-red-800',
  warning: 'bg-yellow-100 border-yellow-400 text-yellow-800',
  info: 'bg-blue-100 border-blue-400 text-blue-800',
};

function normalizeMessage(message: unknown): string {
  if (typeof message === 'string') return message;
  if (typeof message === 'number' || typeof message === 'boolean') return String(message);
  if (!message) return 'Unexpected error occurred.';

  if (Array.isArray(message)) {
    const parts = message
      .map((item) => normalizeMessage(item))
      .filter((item) => item && item !== 'Unexpected error occurred.');
    return parts.length ? parts.join(' | ') : 'Unexpected error occurred.';
  }

  if (typeof message === 'object') {
    const payload = message as Record<string, unknown>;

    if (typeof payload.detail === 'string') {
      return payload.detail;
    }

    if (Array.isArray(payload.detail)) {
      const detailParts = payload.detail
        .map((item) => {
          if (typeof item === 'string') return item;
          if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).msg === 'string') {
            return (item as Record<string, unknown>).msg as string;
          }
          return normalizeMessage(item);
        })
        .filter(Boolean);
      if (detailParts.length) return detailParts.join(' | ');
    }

    if (typeof payload.msg === 'string') {
      return payload.msg;
    }

    if (typeof payload.message === 'string') {
      return payload.message;
    }

    try {
      return JSON.stringify(payload);
    } catch {
      return 'Unexpected error occurred.';
    }
  }

  return 'Unexpected error occurred.';
}

export function Alert({ message, type = 'info', onClose, autoCloseMs = 2800 }: Props) {
  const normalizedMessage = normalizeMessage(message);

  useEffect(() => {
    if (!onClose || type === 'error' || autoCloseMs <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      onClose();
    }, autoCloseMs);

    return () => window.clearTimeout(timer);
  }, [autoCloseMs, onClose, type, normalizedMessage]);

  return (
    <div className={`border-l-4 p-4 ${colorMap[type]} rounded flex items-center gap-3`}>
      {iconMap[type]}
      <span>{normalizedMessage}</span>
      {onClose && (
        <button onClick={onClose} className="ml-auto text-lg">
          x
        </button>
      )}
    </div>
  );
}
