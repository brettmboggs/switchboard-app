// Jarvis's reach: every action Switchboard has (lib/jarvisactions.js), found by
// the words someone used and run through the same local API the page uses, with
// the same checks. Two limits, both from AGENTS.md: anything that removes or
// can't easily be undone waits for a yes; anything that reaches another person
// (mail, chat, a review, an invitation) is never sent by Jarvis, since every
// send is the person's own click. Plumbing only the page uses is left out.
import { ACTIONS } from './jarvisactions.js';

const STOP = new Set(['the', 'a', 'an', 'my', 'me', 'to', 'of', 'for', 'and', 'in', 'on', 'is', 'it', 'what', 'how', 'please', 'can', 'you', 'i', 'do', 'with', 'from', 'that', 'this', 'one']);
const stem = (w) => w.replace(/(ing|ed|es|s)$/, '');
const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
const USABLE = ACTIONS.filter((a) => a.kind !== 'internal').map((a) => ({ a, id: words(a.id), hay: words(`${a.id} ${a.does} ${a.words}`) }));

// The actions that best match what was asked, best first.
export function findActions(query, n = 8) {
  const q = words(query);
  if (!q.length) return [];
  const scored = [];
  for (const { a, id, hay } of USABLE) {
    let sc = 0;
    for (const w of q) {
      if (id.includes(w)) sc += 3;
      else if (hay.includes(w)) sc += 1;
      else if (w.length > 3 && hay.some((h) => h.length > 3 && (h.startsWith(w) || w.startsWith(h)))) sc += 0.5;
    }
    if (sc > 0) scored.push([sc + (a.kind === 'read' ? 0.01 : 0), a]);
  }
  return scored.sort((x, y) => y[0] - x[0]).slice(0, n).map(([, a]) => a);
}

// One action as the model reads it.
export const describe = (a) => `${a.id} [${a.kind}] ${a.does}${Object.keys(a.args).length ? ' Inputs: ' + Object.entries(a.args).map(([k, v]) => `${k}: ${v}`).join('; ') : ' No inputs.'}`;

const part = (r, only) => {
  if (!only) return r;
  let v = r; for (const k of String(only).split('.')) v = v?.[k];
  return v === undefined ? { note: `No part called ${only}. Parts: ${Object.keys(r || {}).join(', ')}` } : v;
};
const brief = (r) => { const s = JSON.stringify(r ?? {}); return s.length > 3000 ? s.slice(0, 3000) + ' …(cut; run it again with only set to the part you need)' : s; };

// Runs one action. Returns { say } for the model; needsYes when it waits for a yes.
// only: a part of the answer ("calendars", "items", "terms.0") when the whole is too big to read.
export async function runAction(api, id, args = {}, confirmed = false, only = '') {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) return { say: `There is no action called ${id}. Use find_action to look it up by what it does.` };
  if (a.kind === 'internal') return { say: `${id} is part of how the page works, not something to run directly. ${a.does}` };
  if (a.kind === 'send') return { say: `Not sent: ${a.does} That reaches another person, and in Switchboard every send is the user's own click. Offer to open it on screen, or write a draft for them to send.` };
  if (a.kind === 'delete' && confirmed !== true) return { say: `Waiting for a yes: ${a.does} This is hard to undo. Ask the user to confirm, and run it again with confirmed true only after they say yes.`, needsYes: true };
  const rest = { ...(args && typeof args === 'object' ? args : {}) };
  const missing = [];
  const path = a.path.replace(/:(\w+)/g, (m, k) => { const v = rest[k]; delete rest[k]; if (v == null || v === '') { missing.push(k); return m; } return encodeURIComponent(String(v)); });
  if (missing.length) return { say: `${id} needs ${missing.join(' and ')}. ${describe(a)}` };
  if (a.method === 'GET') {
    const qs = new URLSearchParams(Object.entries(rest).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)])).toString();
    return { say: brief(part(await api(qs ? `${path}?${qs}` : path), only)) };
  }
  return { say: brief(part(await api(path, rest), only)) };
}

