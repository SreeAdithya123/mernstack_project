import { Link, NavLink, Route, Routes } from 'react-router-dom';
import SubmitTicket from './pages/SubmitTicket.jsx';
import AgentDashboard from './pages/AgentDashboard.jsx';

const navLinkClass = ({ isActive }) =>
  `rounded-md px-3 py-1.5 text-sm font-medium ${
    isActive ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-200'
  }`;

export default function App() {
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="text-lg font-bold text-indigo-700">
            SmartSupport
          </Link>
          <nav className="flex gap-2">
            <NavLink to="/" end className={navLinkClass}>
              Submit a ticket
            </NavLink>
            <NavLink to="/agent" className={navLinkClass}>
              Agent dashboard
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Routes>
          <Route path="/" element={<SubmitTicket />} />
          <Route path="/agent" element={<AgentDashboard />} />
        </Routes>
      </main>
    </div>
  );
}
