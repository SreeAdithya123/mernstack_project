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
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'
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
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-indigo-700">
            SmartSupport
          </Link>
          <nav className="flex items-center gap-2">
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
              <button onClick={signOut} className="rounded-md px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200">
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
