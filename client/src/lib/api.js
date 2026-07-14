async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return body;
}

export const api = {
  createTicket: (data) => request('/tickets', { method: 'POST', body: JSON.stringify(data) }),
  listTickets: () => request('/tickets'),
  getTicket: (id) => request(`/tickets/${id}`),
  addMessage: (id, message) =>
    request(`/tickets/${id}/messages`, { method: 'POST', body: JSON.stringify(message) }),
  updateTicket: (id, patch) =>
    request(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  kbMatches: (id) => request(`/tickets/${id}/kb-matches`),
  similar: (id) => request(`/tickets/${id}/similar`),
  draft: (id) => request(`/tickets/${id}/draft`, { method: 'POST' }),
  summarize: (id) => request(`/tickets/${id}/summarize`, { method: 'POST' }),
};
