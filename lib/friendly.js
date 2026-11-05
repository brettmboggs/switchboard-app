// Errors in plain words: what happened and what to do about it. Messages
// Switchboard writes itself are already plain and pass through untouched; this
// turns the ones that come from the system or the network ("getaddrinfo
// ENOTFOUND", "certificate has expired", "SQLITE_BUSY") into a sentence a
// person can act on. `who` names the other side: "Gmail", "the calendar server".
export function friendlyError(e, who = 'The other side') {
  const raw = String(e?.code || '') + ' ' + String(e?.cause?.code || '') + ' ' + String(e?.message || e || '');
  const msg = String(e?.message || e || '').trim();
  const name = who.charAt(0).toUpperCase() + who.slice(1);
  const it = who.charAt(0).toLowerCase() + who.slice(1);
  if (/EAI_AGAIN|ENOTFOUND|getaddrinfo/i.test(raw)) return `Could not find ${it} on the internet. Check that this computer is online; if it is, the address may be mistyped.`;
  if (/ENETUNREACH|EHOSTUNREACH|ENETDOWN/i.test(raw)) return `This computer could not reach ${it}: no network route. Check the Wi-Fi or cable, or a VPN that blocks it.`;
  if (/ECONNREFUSED/i.test(raw)) return `${name} turned the connection away. It may be down, or the address or port is wrong.`;
  if (/ECONNRESET|socket hang up|EPIPE|other side closed/i.test(raw)) return `${name} dropped the connection part way. Usually a brief hiccup: it tries again on its own.`;
  if (/ETIMEDOUT|TimeoutError|timed? ?out|aborted due to timeout/i.test(raw)) return `${name} took too long to answer. It may be busy or the connection slow; Switchboard tries again on its own.`;
  if (/CERT_|certificate|self[- ]signed|SSL|TLS/i.test(raw)) return `${name}'s security certificate was not accepted (expired, or not who it says it is), so Switchboard did not send anything. Check the address, or try later.`;
  if (/ENOSPC/i.test(raw)) return 'This computer\'s disk is full, so Switchboard could not save. Free some space and try again.';
  if (/EACCES|EPERM/i.test(raw)) return `Switchboard is not allowed to read or write a file it needs${e?.path ? ` (${e.path})` : ''}. Check the folder's permissions.`;
  if (/SQLITE_BUSY|database is locked/i.test(raw)) return 'Switchboard\'s database was busy with something else. Try again in a moment.';
  if (/SQLITE_(CORRUPT|NOTADB)|malformed/i.test(raw)) return 'Switchboard\'s database file looks damaged. Restart Switchboard; if this keeps happening, ask for help before deleting anything.';
  if (/is not valid JSON|Unexpected end of JSON|JSON\.parse|Unexpected token .* in JSON/i.test(raw)) return `${name} answered with something that was not what Switchboard expected. It may be having trouble; try again later.`;
  if (/\b(502|503|504)\b/.test(raw) && msg.length < 40) return `${name} is having trouble right now (it answered ${raw.match(/\b(502|503|504)\b/)[1]}). Switchboard tries again on its own.`;
  if (/\b(401|403)\b/.test(raw) && msg.length < 40) return `${name} did not accept the sign-in. Connect it again in Settings, Connections.`;
  if (/\b429\b/.test(raw) && msg.length < 40) return `${name} asked Switchboard to slow down. It waits and tries again on its own.`;
  return msg.slice(0, 300) || 'Something went wrong, with no more detail than that.';
}
