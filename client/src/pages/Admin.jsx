import { useEffect, useState } from 'react';
import { admin } from '../lib/admin.js';
import { RoleBadge } from '../components/Chips.jsx';

const ROLES = ['user', 'salesperson', 'admin'];

export default function Admin() {
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <h1 className="font-serif text-lg font-semibold text-ink-900">Admin</h1>
      <Analytics />
      <RoleManagement />
      <KBManagement />
    </div>
  );
}

function Analytics() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    admin.ticketStats().then(setStats, (err) => setError(err.message));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!stats) return <p className="text-sm text-ink-400">Loading…</p>;

  const breakdown = (obj) =>
    Object.entries(obj)
      .map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)
      .join(' · ');

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-700">Ticket analytics</h2>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-cream-400 bg-cream-50 p-3 text-sm shadow-sm">
          <p className="font-medium text-ink-800">Total tickets: {stats.total}</p>
        </div>
        <div className="rounded-xl border border-cream-400 bg-cream-50 p-3 text-sm shadow-sm">
          <p className="font-medium text-ink-800">By status</p>
          <p className="text-xs text-ink-500">{breakdown(stats.byStatus)}</p>
        </div>
        <div className="rounded-xl border border-cream-400 bg-cream-50 p-3 text-sm shadow-sm">
          <p className="font-medium text-ink-800">By sentiment</p>
          <p className="text-xs text-ink-500">{breakdown(stats.bySentiment)}</p>
        </div>
        <div className="rounded-xl border border-cream-400 bg-cream-50 p-3 text-sm shadow-sm">
          <p className="font-medium text-ink-800">By category</p>
          <p className="text-xs text-ink-500">{breakdown(stats.byCategory)}</p>
        </div>
      </div>
    </section>
  );
}

function RoleManagement() {
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => admin.listProfiles().then(setProfiles, (err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  const changeRole = async (id, role) => {
    setBusyId(id);
    setError(null);
    try {
      await admin.setRole(id, role);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-700">Users &amp; roles</h2>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      <div className="mt-2 overflow-hidden rounded-xl border border-cream-400 bg-cream-50 shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-cream-200 text-left text-xs text-ink-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => (
              <tr key={p.id} className="border-t border-cream-300">
                <td className="px-3 py-2 text-ink-800">{p.full_name}</td>
                <td className="px-3 py-2 text-ink-500">{p.email}</td>
                <td className="px-3 py-2">
                  <RoleBadge value={p.role} />
                </td>
                <td className="px-3 py-2">
                  <select
                    value={p.role}
                    disabled={busyId === p.id}
                    onChange={(e) => changeRole(p.id, e.target.value)}
                    className="rounded-lg border border-cream-400 bg-cream-50 px-2 py-1 text-xs text-ink-700"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {profiles.length === 0 && <p className="p-3 text-xs text-ink-400">No users yet.</p>}
      </div>
    </section>
  );
}

const emptyArticle = { title: '', content: '', category: '' };

function KBManagement() {
  const [articles, setArticles] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(emptyArticle);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => admin.listArticles().then(setArticles, (err) => setError(err.message));
  useEffect(() => {
    load();
  }, []);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const startEdit = (a) => {
    setEditingId(a.id);
    setForm({ title: a.title, content: a.content, category: a.category ?? '' });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyArticle);
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await admin.updateArticle(editingId, form);
      } else {
        await admin.createArticle(form);
      }
      cancelEdit();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      await admin.deleteArticle(id);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink-700">Knowledge base articles</h2>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}

      <form onSubmit={submit} className="mt-2 space-y-2 rounded-xl border border-cream-400 bg-cream-50 p-3 shadow-sm">
        <div className="grid grid-cols-2 gap-2">
          <input
            required
            placeholder="Title"
            value={form.title}
            onChange={set('title')}
            className="rounded-lg border border-cream-400 bg-cream-50 px-2 py-1.5 text-sm text-ink-800 focus:border-clay-500 focus:outline-none"
          />
          <input
            placeholder="Category"
            value={form.category}
            onChange={set('category')}
            className="rounded-lg border border-cream-400 bg-cream-50 px-2 py-1.5 text-sm text-ink-800 focus:border-clay-500 focus:outline-none"
          />
        </div>
        <textarea
          required
          rows={4}
          placeholder="Content"
          value={form.content}
          onChange={set('content')}
          className="w-full rounded-lg border border-cream-400 bg-cream-50 px-2 py-1.5 text-sm text-ink-800 focus:border-clay-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-clay-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-clay-600 disabled:opacity-50"
          >
            {editingId ? 'Save changes' : 'Add article'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-full border border-cream-400 px-3 py-1.5 text-xs text-ink-600"
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <ul className="mt-3 space-y-2">
        {articles.map((a) => (
          <li key={a.id} className="rounded-xl border border-cream-400 bg-cream-50 p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium text-ink-800">{a.title}</p>
                <p className="text-xs text-ink-400">{a.category}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => startEdit(a)} className="text-xs text-clay-600 hover:underline">
                  Edit
                </button>
                <button onClick={() => remove(a.id)} className="text-xs text-red-600 hover:underline">
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
        {articles.length === 0 && <p className="text-xs text-ink-400">No articles yet.</p>}
      </ul>
    </section>
  );
}
