import React, { Component } from 'react';
import { AlertTriangle, RotateCcw, Home } from 'lucide-react';

const h = React.createElement;

/**
 * AksErrorBoundary — Top-level resilience wrapper for Aks Reading Sanctuary.
 * Catches unhandled React rendering and lifecycle errors, prevents blank white screen crashes,
 * and provides safe recovery options that preserve user library data and credentials.
 */
export class AksErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      error,
      errorId: Math.random().toString(36).substring(2, 9),
    };
  }

  componentDidCatch(error, errorInfo) {
    const isDev = Boolean(typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');
    if (isDev) {
      console.error('[AksErrorBoundary] Uncaught React Error:', error, errorInfo);
    } else {
      console.error(`[AksErrorBoundary] Application error captured [id=${this.state.errorId}]:`, error?.message || 'Unknown render error');
    }

    if (typeof this.props.onError === 'function') {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorId: null });
    // In standalone testing environments where reconciler is unmounted
    if (!this.updater?.isMounted || !this.updater.isMounted(this)) {
      this.state = { hasError: false, error: null, errorId: null };
    }
  };

  handleReload = () => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  handleSafeRecovery = () => {
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('aks_transient_reader_state');
      } catch (_) {}
      window.location.href = '/';
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback;
      }

      const isDev = Boolean(typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production');

      return h(
        'div',
        { className: 'aks-error-boundary-overlay', role: 'alert', 'aria-live': 'assertive' },
        h(
          'div',
          { className: 'aks-error-boundary-card' },
          h(
            'div',
            { className: 'aks-error-boundary-header' },
            h(
              'div',
              { className: 'aks-error-boundary-icon-wrap' },
              h(AlertTriangle, { size: 32, className: 'aks-error-boundary-icon' })
            ),
            h('h1', { className: 'aks-error-boundary-title' }, 'The Sanctuary Encountered a Disturbance'),
            h(
              'p',
              { className: 'aks-error-boundary-subtitle' },
              'An unexpected condition interrupted the reading experience. Your library books, annotations, and reading progress remain safely preserved.'
            )
          ),
          isDev && this.state.error
            ? h(
                'div',
                { className: 'aks-error-boundary-debug' },
                h('div', { className: 'aks-error-boundary-debug-header' }, 'Diagnostic Information (Development Only):'),
                h('code', { className: 'aks-error-boundary-debug-message' }, `${this.state.error.name}: ${this.state.error.message}`)
              )
            : null,
          h(
            'div',
            { className: 'aks-error-boundary-actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'aks-error-btn-primary',
                onClick: this.handleReset,
              },
              h(RotateCcw, { size: 16 }),
              h('span', null, 'Resume Reading')
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'aks-error-btn-secondary',
                onClick: this.handleSafeRecovery,
              },
              h(Home, { size: 16 }),
              h('span', null, 'Return to Library')
            )
          ),
          h(
            'div',
            { className: 'aks-error-boundary-footer' },
            'Reference ID: ',
            h('span', { className: 'aks-error-ref-id' }, this.state.errorId || 'N/A')
          )
        )
      );
    }

    return this.props.children;
  }
}

export default AksErrorBoundary;
