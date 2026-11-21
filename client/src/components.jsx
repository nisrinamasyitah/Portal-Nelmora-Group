import { useCallback, useEffect, useState } from 'react';
import { api } from './api.js';

// Loads data from the API and lets a page refresh it after saving something.
export function useApi(path) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    api(path)
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState((s) => ({ ...s, error: e.message, loading: false })));
  }, [path]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    load();
  }, [load]);
  return { ...state, reload: load };
}

export function Loading({ state }) {
  if (state.error) return <div className="error">Could not load: {state.error}</div>;
  if (state.loading && !state.data) return <p className="muted">Loading…</p>;
  return null;
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className={'value ' + (tone || '')}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function Modal({ title, onClose, wide, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// A form inside a modal: handles saving state + error message.
export function FormModal({ title, onClose, onSave, saveLabel = 'Save', wide, children }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave();
      onClose(true);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Modal title={title} onClose={() => onClose(false)} wide={wide}>
      <form onSubmit={submit}>
        {error && <div className="error">{error}</div>}
        {children}
        <div className="modal-foot">
          <button type="button" onClick={() => onClose(false)}>Cancel</button>
          <button className="primary" disabled={busy}>{busy ? 'Saving…' : saveLabel}</button>
        </div>
      </form>
    </Modal>
  );
}

export async function confirmDelete(message, fn) {
  if (!window.confirm(message)) return false;
  try {
    await fn();
    return true;
  } catch (e) {
    window.alert(e.message);
    return false;
  }
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}
