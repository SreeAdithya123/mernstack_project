import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const field = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

export default function Login() {
  const { session, loading } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signedUp, setSignedUp] = useState(false);

  if (!loading && session) return <Navigate to="/" replace />;

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        const { error: signUpError } = await supabase.auth.signUp({
          email: form.email,
          password: form.password,
          options: { data: { full_name: form.name } },
        });
        if (signUpError) throw signUpError;
        setSignedUp(true);
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: form.email,
          password: form.password,
        });
        if (signInError) throw signInError;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (signedUp) {
    return (
      <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6 text-center">
        <h1 className="text-lg font-semibold text-green-700">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">
          We sent a confirmation link to {form.email}. Confirm it, then sign in below.
        </p>
        <button
          onClick={() => {
            setSignedUp(false);
            setMode('login');
          }}
          className="mt-4 rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm rounded-lg border border-slate-200 bg-white p-6">
      <h1 className="text-xl font-semibold">{mode === 'login' ? 'Sign in' : 'Create an account'}</h1>
      <p className="mt-1 text-sm text-slate-500">
        {mode === 'login' ? 'Access your tickets.' : 'New accounts start as a customer.'}
      </p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        {mode === 'signup' && (
          <label className="block text-sm">
            <span className="text-slate-600">Your name</span>
            <input required value={form.name} onChange={set('name')} className={`mt-1 ${field}`} />
          </label>
        )}
        <label className="block text-sm">
          <span className="text-slate-600">Email</span>
          <input required type="email" value={form.email} onChange={set('email')} className={`mt-1 ${field}`} />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">Password</span>
          <input
            required
            type="password"
            minLength={6}
            value={form.password}
            onChange={set('password')}
            className={`mt-1 ${field}`}
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
      </form>
      <button
        onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        className="mt-4 text-xs text-indigo-700 hover:underline"
      >
        {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
      </button>
    </div>
  );
}
