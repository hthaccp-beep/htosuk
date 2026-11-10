import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.hash = '#/';
  };

  public render() {
    if (this.state.hasError) {
      const isChunkError =
        this.state.error?.message?.toLowerCase().includes('failed to fetch dynamically imported module') ||
        this.state.error?.message?.toLowerCase().includes('chunkloaderror');

      return (
        <div className="min-h-[400px] flex items-center justify-center p-6 bg-gray-50/50">
          <div className="max-w-md w-full bg-white rounded-2xl border border-gray-200 shadow-sm p-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
              <AlertTriangle size={24} />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold text-gray-900">
                {this.props.fallbackTitle || (isChunkError ? 'Application Updated' : 'Something went wrong')}
              </h2>
              <p className="text-xs text-gray-500 leading-relaxed">
                {this.props.fallbackMessage ||
                  (isChunkError
                    ? 'A new version of the Order System has been published. Please reload the page to load the latest updates. Your cart and draft items have been preserved.'
                    : 'An unexpected rendering problem occurred on this screen. Your existing cart items and unsaved drafts are safely stored in your browser session.')}
              </p>
            </div>

            {/* Error diagnostics (redacted in non-dev) */}
            {process.env.NODE_ENV !== 'production' && this.state.error && (
              <div className="text-left bg-gray-50 p-3 rounded-lg border border-gray-200 text-[11px] font-mono text-gray-700 overflow-x-auto max-h-32">
                <span className="font-bold text-red-600">{this.state.error.name}: </span>
                {this.state.error.message}
              </div>
            )}

            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReload}
                className="bg-brand-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-brand-700 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
              >
                <RefreshCw size={14} /> Reload Page
              </button>

              <button
                type="button"
                onClick={this.handleGoHome}
                className="bg-gray-100 text-gray-700 px-4 py-2 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all flex items-center gap-1.5 active:scale-95"
              >
                <Home size={14} /> Back to Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
