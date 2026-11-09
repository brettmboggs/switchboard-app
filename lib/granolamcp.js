// Granola on any plan, the free one too: signed in to Granola's own MCP server
// (mcp.granola.ai), the way Granola connects Claude and ChatGPT. Granola's
// public API (lib/granola.js) needs a key that only its Business plan gives.
//
// Sign-in is OAuth with PKCE, Switchboard registering itself with Granola the
// first time (dynamic client registration: no secret anywhere). The page opens
// Granola's sign-in in a browser tab; Granola sends the browser back to
// http://127.0.0.1:<port>/oauth/granola with a one-time code, traded here for a
// refresh token, kept locked on disk (the "granola" secret setting). Switchboard
// never sees a Granola password or code. The state value ties the return to the
// click that started it (one use, ten minutes).
//
// Reading: MCP's streamable HTTP, one JSON-RPC request per POST (the answer is
// JSON or an event stream), with the session id Granola hands back.
import { randomBytes, createHash } from 'node:crypto';
import { getSetting, setSetting } from './db.js';

const MCP = process.env.SWITCHBOARD_GRANOLA_MCP || 'https://mcp.granola.ai/mcp';
const AUTH = process.env.SWITCHBOARD_GRANOLA_AUTH || 'https://mcp-auth.granola.ai';
const SCOPE = 'openid email profile offline_access';
const conf = () => getSetting('granola', {});
const save = (patch) => setSetting('granola', { ...conf(), ...patch });
const b64u = (buf) => buf.toString('base64url');
const pending = new Map();   // state -> { verifier, redirect, clientId, at }
let access = { value: null, exp: 0 };

const signinError = (msg) => Object.assign(new Error(msg), { signin: true });

async function post(url, body, { form = false } = {}) {
  const r = await fetch(url, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json', Accept: 'application/json' },
    body: form ? new URLSearchParams(body) : JSON.stringify(body)
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(json.error_description || json.error || `Granola answered ${r.status}.`), { code: json.error, status: r.status });
  return json;
}

// Switchboard's registration with Granola, for this port's return address; made once.
async function client(redirect) {
  const c = conf().client;
  if (c?.id && c.redirect === redirect) return c.id;
  const r = await post(`${AUTH}/oauth2/register`, { client_name: 'Switchboard', redirect_uris: [redirect], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: SCOPE });
  if (!r.client_id) throw new Error('Granola did not register Switchboard. Try Sign in again in a minute.');
  save({ client: { id: r.client_id, redirect } });
  return r.client_id;
}

// The address to open in a browser tab.
export async function startGranolaSignIn(port) {
  for (const [k, v] of pending) if (Date.now() - v.at > 10 * 60e3) pending.delete(k);
  const redirect = `http://127.0.0.1:${port}/oauth/granola`;
  const clientId = await client(redirect);
  const state = b64u(randomBytes(24)), verifier = b64u(randomBytes(48));
  pending.set(state, { verifier, redirect, clientId, at: Date.now() });
  const q = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE, state, resource: MCP,
    code_challenge: b64u(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256'
  });
  return { url: `${AUTH}/oauth2/authorize?${q}` };
}

// Granola's page sent the browser back with ?code=&state=. Returns { ok } or { error }.
export async function finishGranolaSignIn(query) {
  if (query.error) return { error: query.error === 'access_denied' ? 'You did not allow access, so nothing was connected.' : `Granola said: ${query.error_description || query.error}.` };
  const p = pending.get(query.state);
  pending.delete(query.state);
  if (!p || Date.now() - p.at > 10 * 60e3) return { error: 'That sign-in link is too old or was not started here. Press Sign in with Granola again.' };
  if (!query.code) return { error: 'Granola did not send back what Switchboard needs. Press Sign in with Granola again.' };
  try {
    const t = await post(`${AUTH}/oauth2/token`, { grant_type: 'authorization_code', code: query.code, redirect_uri: p.redirect, code_verifier: p.verifier, client_id: p.clientId, resource: MCP }, { form: true });
    if (!t.refresh_token) return { error: 'Granola did not give Switchboard lasting access, so it would sign you out within the hour. Press Sign in with Granola again.' };
    let email = '';
    try { email = JSON.parse(Buffer.from(String(t.id_token).split('.')[1], 'base64url').toString()).email || ''; } catch {}
    save({ refreshToken: t.refresh_token, email, signedInAt: Date.now(), needsSignIn: false });
    access = { value: t.access_token, exp: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
    return { ok: true, email };
  } catch (e) { return { error: `Granola did not accept the sign-in: ${e.message}` }; }
}

export function granolaSignOut() {
  access = { value: null, exp: 0 };
  mcpSession = null;
  const { client: c } = conf();
  setSetting('granola', c ? { client: c } : {});   // the registration stays; it is not a secret
}

async function accessToken() {
  const c = conf();
  if (!c.refreshToken) throw signinError('Granola is not signed in. Press Sign in with Granola in Settings, Connections.');
  if (access.value && Date.now() < access.exp) return access.value;
  try {
    const t = await post(`${AUTH}/oauth2/token`, { grant_type: 'refresh_token', refresh_token: c.refreshToken, client_id: c.client?.id, resource: MCP }, { form: true });
    access = { value: t.access_token, exp: Date.now() + ((t.expires_in || 3600) - 60) * 1000 };
    if (t.refresh_token && t.refresh_token !== c.refreshToken) save({ refreshToken: t.refresh_token });
    return access.value;
  } catch (e) {
    if (e.code === 'invalid_grant' || e.status === 400 || e.status === 401) { save({ needsSignIn: true }); throw signinError('Granola signed Switchboard out. Press Sign in with Granola again.'); }
    throw e;
  }
}

// ---- MCP over streamable HTTP
let mcpSession = null, nextId = 1;
async function rpc(method, params, { retry = true } = {}) {
  const token = await accessToken();
  const r = await fetch(MCP, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', ...(mcpSession ? { 'MCP-Session-Id': mcpSession } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  });
  if (r.status === 401) { access = { value: null, exp: 0 }; if (retry) return rpc(method, params, { retry: false }); save({ needsSignIn: true }); throw signinError('Granola did not accept Switchboard\'s sign-in. Press Sign in with Granola again.'); }
  if (r.status === 404 && mcpSession && retry) { mcpSession = null; await initialize(); return rpc(method, params, { retry: false }); }
  if (r.status === 429) throw new Error('Granola asked Switchboard to slow down; it tries again in a few minutes.');
  if (!r.ok) throw new Error(`Granola answered ${r.status}. Switchboard tries again in a few minutes.`);
  const sid = r.headers.get('mcp-session-id');
  if (sid) mcpSession = sid;
  const text = await r.text();
  let msg = null;
  if (/^\s*\{/.test(text)) msg = JSON.parse(text);
  else for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const m = JSON.parse(line.slice(5)); if (m.id !== undefined) msg = m; } catch {} }
  if (!msg) throw new Error('Granola sent back something Switchboard could not read.');
  if (msg.error) throw new Error(`Granola said: ${msg.error.message || 'an error'}.`);
  return msg.result;
}
async function initialize() {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Switchboard', version: '1.0.0' } });
  // The initialized notification: no answer expected.
  const token = await accessToken();
  await fetch(MCP, { method: 'POST', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(mcpSession ? { 'MCP-Session-Id': mcpSession } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }).catch(() => {});
}
export async function granolaTools() {
  if (!mcpSession) await initialize();
  return (await rpc('tools/list', {})).tools || [];
}
// A tool's answer: its structured content when it has one, else its text.
export async function granolaTool(name, args = {}) {
  if (!mcpSession) await initialize();
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.isError) throw new Error(`Granola said: ${(r.content || []).map((c) => c.text).join(' ').slice(0, 300) || 'that did not work'}.`);
  return { structured: r.structuredContent || null, text: (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n') };
}
export const granolaSignedIn = () => !!conf().refreshToken;

// ---- What Granola's tools answer: tagged text, not JSON. list_meetings and
// get_meetings both give <meeting id="…" title="…" …> elements (seen on a real
// account, Nov 6 2026): attributes for the facts, <known_participants> as
// "Name (note creator) (email)" lines, <folders>, <private_notes status="empty" />
// or its text, <summary> in Markdown. Turned here into the shape the public
// API's notes have, so lib/granola.js makes the same pages from either.
const unent = (s) => String(s || '').replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[e.toLowerCase()]
  ?? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, unent(v)]));
const inner = (body, name) => { const m = body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`)); return m ? m[1] : ''; };

export function parseMeetings(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/<meeting\s([^>]*?)(\/?)>([\s\S]*?)(?:<\/meeting>|(?=<meeting\s)|$)/g)) {
    const a = attrs(m[1]), body = m[2] ? '' : m[3];
    if (!a.id) continue;
    const people = inner(body, 'known_participants').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const email = (l.match(/\(([^()\s]+@[^()\s]+)\)\s*$/) || [])[1] || '';
      return { name: unent(l.replace(/\s*\([^()]*\)/g, '').trim()), email: email.toLowerCase(), creator: /\(note creator\)/.test(l) };
    });
    const fb = inner(body, 'folders');
    const folders = [...fb.matchAll(/<folder\b([^>]*)>/g)].map(([, t]) => { const f = attrs(t); return f.title || f.name || ''; })
      .concat(/<folder\b/.test(fb) ? [] : fb.split('\n').map((l) => unent(l.trim())))
      .filter(Boolean);
    const pn = body.match(/<private_notes\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/private_notes>|$)/);
    const mine = pn && !pn[2] && !/status="(empty|not_included)"/.test(pn[1]) ? unent(pn[3]).trim() : '';
    const creator = people.find((p) => p.creator);
    out.push({
      id: a.id, title: a.title || '', created_at: a.created_at || a.meeting_at || '', updated_at: a.updated_at || a.created_at || '',
      web_url: a.url || '', owner: creator ? { name: creator.name, email: creator.email } : null,
      attendees: people.map(({ name, email }) => ({ name, email })),
      calendar_event: a.meeting_at ? { scheduled_start_time: a.meeting_at } : null,
      folders, summary_markdown: unent(inner(body, 'summary')).trim(), private_notes_markdown: mine,
      full: /<summary\b/.test(body) || /<private_notes\b/.test(body)
    });
  }
  const p = attrs((String(text || '').match(/<pagination\b[^>]*>/) || [''])[0]);
  return { meetings: out, more: p.has_more === 'true', cursor: p.next_cursor || null };
}
