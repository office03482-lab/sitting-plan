import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
  stack?: string;
}

const toDisplayText = (value: unknown, fallback: string): string => {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    return value.map((item) => toDisplayText(item, '')).filter(Boolean).join(' | ') || fallback;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.message === 'string') return record.message;
    if (typeof record.msg === 'string') return record.msg;
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  if (value != null) return String(value);
  return fallback;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: '',
    stack: undefined,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: toDisplayText(error?.message, 'Unexpected application error'),
      stack: error?.stack,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application crash captured by ErrorBoundary:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-slate-100 px-4 py-10">
        <div className="mx-auto max-w-3xl rounded-3xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-600">Application Error</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">Page crash ho gayi thi, white screen nahi aayegi ab.</h1>
          <p className="mt-3 text-sm text-slate-600">{this.state.errorMessage || 'Unknown runtime error'}</p>
          {this.state.stack ? (
            <pre className="mt-4 max-h-80 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-100 whitespace-pre-wrap">
              {this.state.stack}
            </pre>
          ) : null}
          <div className="mt-5">
            <button
              type="button"
              onClick={this.handleReload}
              className="rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black"
            >
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
