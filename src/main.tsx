import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Screen white hone ki jagah asli error dikhao (screenshot bhej sako) aur app ko wapas chalane do
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error('App crash:', error);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: 16, fontFamily: 'sans-serif', background: '#fff7ed', minHeight: '100vh' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: '#9a3412' }}>App me ek galti aayi</div>
        <p style={{ fontSize: 13, color: '#7c2d12' }}>
          Is screen ka screenshot bhej do, isse galti turant mil jayegi.
        </p>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: 11,
            background: '#fff',
            border: '1px solid #fdba74',
            borderRadius: 8,
            padding: 10,
            color: '#111',
          }}
        >
          {String(error.message || error).slice(0, 600)}
          {'\n\n'}
          {String(error.stack || '').slice(0, 900)}
        </pre>
        <button
          type="button"
          onClick={() => this.setState({ error: null })}
          style={{
            marginTop: 12,
            padding: '10px 16px',
            borderRadius: 10,
            background: '#0f172a',
            color: '#fff',
            fontWeight: 600,
            border: 'none',
          }}
        >
          Dobara kholo
        </button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
