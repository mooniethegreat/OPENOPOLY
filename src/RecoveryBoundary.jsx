import React from 'react';

export const RECOVERY_DIAGNOSTIC_KEY = 'monopoly-view-error-v1';

function safeText(value, maxLength = 1600) {
  let text;
  try { text = String(value ?? ''); } catch { text = 'Unavailable'; }
  return text
    .replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/((?:sessionToken|authorization|session[_-]?token)\s*["']?\s*[:=]\s*["']?)[^\s,"'<>}]+/gi, '$1[redacted]')
    .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/g, '$1')
    .slice(0, maxLength);
}

// Diagnostics never read saved seats or pending command packets. Storage failures
// must not turn the recovery screen itself into another render failure.
export function recordViewError(error, { kind = 'render', componentStack = '', source = '' } = {}) {
  const report = {
    id: `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    at: new Date().toISOString(),
    kind,
    name: safeText(error?.name || 'Error', 100),
    message: safeText(error?.message ?? error ?? 'Unknown browser error', 800),
    stack: safeText(error?.stack, 3200),
    componentStack: safeText(componentStack, 1600),
    source: safeText(source, 300),
    build: '',
  };
  try {
    const script = [...document.scripts].find(item => /\/assets\/index-[^/]+\.js(?:$|\?)/.test(item.src));
    report.build = script ? new URL(script.src).pathname : 'development';
  } catch { /* The error remains useful without a build identifier. */ }
  try { localStorage.setItem(RECOVERY_DIAGNOSTIC_KEY, JSON.stringify(report)); } catch { /* Browser storage may be unavailable. */ }
  return report;
}

export function installViewDiagnostics(target = window) {
  const onError = event => {
    // Resource errors do not imply that React crashed; record script exceptions.
    if (event.error || event.message) recordViewError(event.error || event.message, { kind: 'browser', source: event.filename });
  };
  const onRejection = event => recordViewError(event.reason, { kind: 'promise' });
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}

export default class RecoveryBoundary extends React.Component {
  state = { failed: false, report: null, attempt: 0, copied: false };

  static getDerivedStateFromError() {
    return { failed: true, report: null, copied: false };
  }

  componentDidCatch(error, info) {
    const report = recordViewError(error, { componentStack: info.componentStack });
    this.setState({ report });
  }

  reconnect = () => {
    // An explicit fresh mount restores the saved seat and checks the existing
    // command receipt. It does not submit a new command or clear browser storage.
    this.setState(state => ({ failed: false, report: null, copied: false, attempt: state.attempt + 1 }));
  };

  copyReport = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(this.state.report, null, 2));
      this.setState({ copied: true });
    } catch { this.setState({ copied: false }); }
  };

  render() {
    if (!this.state.failed) return <React.Fragment key={this.state.attempt}>{this.props.children}</React.Fragment>;
    const { report, copied } = this.state;
    return <main className="view-recovery" aria-labelledby="view-recovery-title">
      <section className="view-recovery-card" role="alert">
        <span className="view-recovery-brand">MONOPOLY ONLINE</span>
        <h1 id="view-recovery-title">The table view stopped.</h1>
        <p>Your saved seat and pending action records are kept in this browser. Reconnect to restore the table and check any pending result.</p>
        <div className="view-recovery-actions">
          <button type="button" onClick={this.reconnect}>Reconnect to table</button>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        </div>
        {report && <details className="view-recovery-details">
          <summary>Error details</summary>
          <p>These details stay in this browser and can help diagnose the view failure.</p>
          <pre tabIndex={0}>{JSON.stringify(report, null, 2)}</pre>
          <button type="button" onClick={this.copyReport}>{copied ? 'Copied details' : 'Copy details'}</button>
        </details>}
      </section>
    </main>;
  }
}
