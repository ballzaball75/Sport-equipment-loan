// In production set VITE_API_URL (e.g. https://app-locker-api-dev.azurewebsites.net) at build time.
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(data?.message || (data?.details && Object.values(data.details).join(', ')) || data?.error || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  sports: () => request('/sports'),
  summary: () => request('/summary'),
  equipment: (params = '') => request(`/equipment${params}`),
  createEquipment: (body) => request('/equipment', { method: 'POST', body }),
  updateEquipment: (id, body) => request(`/equipment/${id}`, { method: 'PUT', body }),
  deleteEquipment: (id) => request(`/equipment/${id}`, { method: 'DELETE' }),
  loans: (status = '') => request(`/loans${status ? `?status=${status}` : ''}`),
  borrow: (body) => request('/loans', { method: 'POST', body }),
  updateLoan: (id, body) => request(`/loans/${id}`, { method: 'PUT', body }),
  returnLoan: (id) => request(`/loans/${id}/return`, { method: 'POST' }),
  deleteLoan: (id) => request(`/loans/${id}`, { method: 'DELETE' }),
};
