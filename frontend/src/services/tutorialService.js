const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api";
const BASE = `${API_URL}/tutorials`;

async function request(path = "", options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || `Request failed with status ${res.status}`);
  }
  // Some backend model methods return DB errors with a 200 status
  // (they call result(null, err)), so treat an error-shaped body as a failure.
  if (data && data.code && data.sqlMessage) {
    throw new Error(data.sqlMessage);
  }
  return data;
}

// GET /api/tutorials?title=
export const getAll = (title) =>
  request(title ? `?title=${encodeURIComponent(title)}` : "");

// GET /api/tutorials/published
export const getPublished = () => request("/published");

// GET /api/tutorials/:id
export const get = (id) => request(`/${id}`);

// POST /api/tutorials
export const create = (tutorial) =>
  request("", { method: "POST", body: JSON.stringify(tutorial) });

// PUT /api/tutorials/:id  (send all fields; the backend sets missing ones to NULL)
export const update = (id, tutorial) =>
  request(`/${id}`, { method: "PUT", body: JSON.stringify(tutorial) });

// DELETE /api/tutorials/:id
export const remove = (id) => request(`/${id}`, { method: "DELETE" });

// DELETE /api/tutorials
export const removeAll = () => request("", { method: "DELETE" });
