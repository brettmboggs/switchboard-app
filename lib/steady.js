// A connection's status that does not flap.
//
// Nov 12 2026: Microsoft, Gmail and GitHub kept showing "not connecting"
// although nothing was wrong for more than a moment. Every poller marked itself
// broken on the first failed check, and on this machine a check fails now and
// then for reasons that pass on their own: a name lookup that stalls and fails
// (docs/DECISIONS.md, "Connections ride out blips"), a 502 from Microsoft, a
// reset connection. So:
//
//   * retry(fn) runs a check again, after a short wait, when it failed for one
//     of those passing reasons (transient(e));
//   * hold(key, e) says whether a failure should be shown yet: a passing one
//     stays hidden, with the last good status kept on the page, until it has
//     lasted GRACE; one that needs the person (a refused password, a sign-in
//     that ran out) shows at once;
//   * ok(key) clears the count when a check works again.

export const GRACE = 10 * 60e3;

const PASSING = /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENETDOWN|EPIPE|UND_ERR_(CONNECT_TIMEOUT|SOCKET|HEADERS_TIMEOUT|BODY_TIMEOUT)|fetch failed|socket hang up|socket (closed|timeout)|network (error|timeout)|timed? ?out|TimeoutError|aborted due to timeout|connection (closed|reset|lost)|could not resolve host|temporary failure in name resolution|error connecting to|\b(429|500|502|503|504)\b/i;

// True when an error is the kind that passes on its own and is worth a retry.
// Errors may say so themselves with { transient: true } or an HTTP status.
export function transient(e) {
  if (!e) return false;
  if (e.signin || e.transient === false) return false;
  if (e.transient === true) return true;
  if ([429, 500, 502, 503, 504].includes(Number(e.status))) return true;
  if (e.killed && e.signal) return true;   // a program run with a time limit that ran out
  const text = [e.code, e.name, e.message, e.cause?.code, e.cause?.message, e.responseText, e.stderr].filter(Boolean).join(' ');
  return PASSING.test(text);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Run fn; when it fails for a passing reason, wait and run it again.
// waits: the pause before each further try (two more tries by default).
export async function retry(fn, { waits = [2000, 6000], sleeper = sleep } = {}) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (i >= waits.length || !transient(e)) throw e;
      await sleeper(waits[i]);
    }
  }
}

const failingSince = new Map();

// Whether this failure should be shown now. A passing failure stays hidden
// until the connection has been failing for GRACE; any other shows at once.
export function hold(key, e, now = Date.now()) {
  if (!transient(e)) { failingSince.delete(key); return false; }
  if (!failingSince.has(key)) failingSince.set(key, now);
  return now - failingSince.get(key) < GRACE;
}

// A check worked: the next failure starts a fresh count.
export function ok(key) { failingSince.delete(key); }
