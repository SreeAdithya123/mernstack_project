import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import SubmitTicket from './pages/SubmitTicket.jsx';
import MyTickets from './pages/MyTickets.jsx';
import TicketThread from './pages/TicketThread.jsx';
import AgentDashboard from './pages/AgentDashboard.jsx';
import Admin from './pages/Admin.jsx';

const navLinkClass = ({ isActive }) =>
  `rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
    isActive ? 'bg-clay-500 text-white' : 'text-ink-600 hover:bg-cream-300'
  }`;

function Home() {
  const { session, role, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (role === 'admin') return <Navigate to="/admin" replace />;
  if (role === 'salesperson') return <Navigate to="/agent" replace />;
  return <Navigate to="/submit" replace />;
}

export default function App() {
  const { session, role, signOut } = useAuth();
  const isStaff = role === 'salesperson' || role === 'admin';

  return (
    <div className="min-h-screen bg-cream-100 text-ink-800">
      <header className="border-b border-cream-400 bg-cream-50">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="font-serif text-lg font-semibold text-clay-600">
            SmartSupport
          </Link>
          <nav className="flex items-center gap-1.5">
            {session && !isStaff && (
              <>
                <NavLink to="/submit" className={navLinkClass}>
                  Submit a ticket
                </NavLink>
                <NavLink to="/tickets" className={navLinkClass}>
                  My tickets
                </NavLink>
              </>
            )}
            {isStaff && (
              <NavLink to="/agent" className={navLinkClass}>
                Agent dashboard
              </NavLink>
            )}
            {role === 'admin' && (
              <NavLink to="/admin" className={navLinkClass}>
                Admin
              </NavLink>
            )}
            {session && (
              <button
                onClick={signOut}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-ink-600 transition-colors hover:bg-cream-300"
              >
                Sign out
              </button>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route
            path="/submit"
            element={
              <ProtectedRoute allow={['user']}>
                <SubmitTicket />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets"
            element={
              <ProtectedRoute allow={['user']}>
                <MyTickets />
              </ProtectedRoute>
            }
          />
          <Route
            path="/tickets/:id"
            element={
              <ProtectedRoute allow={['user']}>
                <TicketThread />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agent"
            element={
              <ProtectedRoute allow={['salesperson', 'admin']}>
                <AgentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/agent/tickets/:id"
            element={
              <ProtectedRoute allow={['salesperson', 'admin']}>
                <AgentDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allow={['admin']}>
                <Admin />
              </ProtectedRoute>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
