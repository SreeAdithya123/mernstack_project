import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

// Client-side guard for UX only - Row Level Security on the Supabase side is
// the real enforcement (see BUILD_LOG for the cross-account RLS verification).
export default function ProtectedRoute({ allow, children }) {
  const { session, role, loading } = useAuth();

  if (loading) {
    return <p className="text-sm text-ink-400">Loading…</p>;
  }
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  if (allow && !allow.includes(role)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
