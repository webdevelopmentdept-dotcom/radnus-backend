// Talks to the external ticket system's API, keeps a cached admin token
let cachedToken = null;
let tokenExpiry = 0;

async function getTicketToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch(`${process.env.TICKET_API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      login: process.env.TICKET_ADMIN_EMAIL,
      password: process.env.TICKET_ADMIN_PASSWORD,
    }),
  });
  const data = await res.json();
  if (!data.token) throw new Error('Ticket system login failed');

  cachedToken = data.token;
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // refresh a bit before 24h expiry
  return cachedToken;
}

async function ticketFetch(path, options = {}) {
  const token = await getTicketToken();
  const res = await fetch(`${process.env.TICKET_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) throw { status: res.status, ...data };
  return data;
}

module.exports = { ticketFetch };