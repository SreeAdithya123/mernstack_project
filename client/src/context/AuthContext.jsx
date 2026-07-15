import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = not loaded yet
  const [profile, setProfile] = useState(null);
  // `loading` must stay true until the profile fetch also resolves, not just
  // the session - otherwise `role` is briefly undefined right after sign-in,
  // which makes ProtectedRoute/Home bounce between routes in a render loop.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadProfile(currentSession) {
      if (!currentSession) {
        if (!cancelled) setProfile(null);
        return;
      }
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('id', currentSession.user.id)
        .single();
      if (!cancelled) setProfile(data ?? null);
    }

    // onAuthStateChange alone is the single source of truth: it fires once
    // immediately with the current session on subscribe, then again on every
    // sign-in/out/refresh - no need for a separate getSession() call (that
    // would race this handler and double-fetch the profile).
    let first = true;
    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (cancelled) return;
      if (!first) setLoading(true);
      first = false;
      setSession(next);
      await loadProfile(next);
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = () => supabase.auth.signOut();

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, profile, role: profile?.role, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
