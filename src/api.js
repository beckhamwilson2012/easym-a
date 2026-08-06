// Single source of truth for the API base.
// Production: server serves the client, so same-origin relative paths.
// Dev: CRA "proxy" in package.json forwards to :3001.
export const API_BASE = process.env.REACT_APP_API_BASE || '';
export const apiUrl = (path) =>
  `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
