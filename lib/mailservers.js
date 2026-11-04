// Which mail servers an email address uses, so adding an account takes only the
// address and an app password. In order: well-known providers by domain; the
// domain's mail (MX) records, which reveal Google Workspace, iCloud, Fastmail,
// Zoho or Microsoft 365 behind a custom domain; Thunderbird's free directory of
// mail server settings; and last, the person types the servers in.
import { resolveMx } from 'node:dns/promises';

export const PROVIDERS = {
  gmail: { name: 'Gmail', kind: 'gmail', help: 'https://myaccount.google.com/apppasswords', helpText: 'Make an app password at myaccount.google.com/apppasswords (needs 2-Step Verification).' },
  icloud: {
    name: 'iCloud Mail', kind: 'imap', imap: { host: 'imap.mail.me.com', port: 993 }, smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    help: 'https://account.apple.com', helpText: 'Make an app-specific password at account.apple.com, under Sign-In and Security.', web: 'https://www.icloud.com/mail'
  },
  yahoo: {
    name: 'Yahoo Mail', kind: 'imap', imap: { host: 'imap.mail.yahoo.com', port: 993 }, smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    help: 'https://login.yahoo.com/account/security', helpText: 'Make an app password in Yahoo Account Security (Generate app password).', web: 'https://mail.yahoo.com'
  },
  aol: {
    name: 'AOL Mail', kind: 'imap', imap: { host: 'imap.aol.com', port: 993 }, smtp: { host: 'smtp.aol.com', port: 465, secure: true },
    help: 'https://login.aol.com/account/security', helpText: 'Make an app password in AOL Account Security.', web: 'https://mail.aol.com'
  },
  fastmail: {
    name: 'Fastmail', kind: 'imap', imap: { host: 'imap.fastmail.com', port: 993 }, smtp: { host: 'smtp.fastmail.com', port: 465, secure: true },
    help: 'https://app.fastmail.com/settings/security/apppasswords', helpText: 'Make an app password in Fastmail Settings, Privacy and Security.', web: 'https://app.fastmail.com'
  },
  zoho: {
    name: 'Zoho Mail', kind: 'imap', imap: { host: 'imap.zoho.com', port: 993 }, smtp: { host: 'smtp.zoho.com', port: 465, secure: true },
    help: 'https://accounts.zoho.com/home#security/app_password', helpText: 'Turn on IMAP in Zoho Mail settings, and make an app password in Zoho Accounts, Security.', web: 'https://mail.zoho.com'
  },
  outlook: {
    name: 'Outlook.com', unsupported: 'Microsoft no longer lets apps sign in to Outlook.com, Hotmail or Live mail with a password. Signing in with Microsoft for these is on the way.'
  },
  proton: {
    name: 'Proton Mail', kind: 'imap', custom: true, imap: { host: '127.0.0.1', port: 1143 }, smtp: { host: '127.0.0.1', port: 1025, secure: false },
    help: 'https://proton.me/mail/bridge', helpText: 'Proton Mail connects through Proton Mail Bridge (paid Proton plans). Run Bridge, then use the password it shows (not your Proton password).'
  },
  forward: {
    name: 'Forwarding address', unsupported: 'This address forwards its mail to another inbox. Add that inbox instead, then put this address under "Also you" so replies can come from it.'
  },
  m365: {
    name: 'Microsoft 365', unsupported: 'This address is on Microsoft 365, which needs Microsoft\'s own sign-in: use Teams and Outlook (Microsoft 365) above instead.'
  }
};

const BY_DOMAIN = [
  [/^(gmail|googlemail)\.com$/, 'gmail'],
  [/^(icloud|me|mac)\.com$/, 'icloud'],
  [/^(yahoo\.[a-z.]+|ymail\.com|rocketmail\.com)$/, 'yahoo'],
  [/^(aol|aim)\.com$/, 'aol'],
  [/^(fastmail\.(com|fm|net|org|to|us)|fastmail\.co\.uk|messagingengine\.com)$/, 'fastmail'],
  [/^(zoho|zohomail)\.(com|eu|in)$/, 'zoho'],
  [/^(outlook|hotmail|live|msn|passport)\.[a-z.]+$/, 'outlook'],
  [/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/, 'proton']
];
const BY_MX = [
  [/(^|\.)(aspmx\.l\.google\.com|googlemail\.com|google\.com)$/, 'gmail'],
  [/(^|\.)mail\.icloud\.com$/, 'icloud'],
  [/(^|\.)messagingengine\.com$/, 'fastmail'],
  [/(^|\.)zoho\.(com|eu|in)$/, 'zoho'],
  [/(^|\.)yahoodns\.net$/, 'yahoo'],
  [/(^|\.)mail\.protection\.outlook\.com$/, 'm365'],
  [/(^|\.)protonmail\.ch$/, 'proton'],
  // Forwarding services hold no mailbox: the mail lives wherever they send it.
  [/(^|\.)(mx\.cloudflare\.net|registrar-servers\.com|improvmx\.com|forwardemail\.net|mx\.simplelogin\.co|mx\.addy\.io)$/, 'forward']
];

export const domainOf = (email) => String(email || '').trim().toLowerCase().split('@')[1] || '';

export function byDomain(domain) {
  return BY_DOMAIN.find(([re]) => re.test(domain))?.[1] || null;
}
export function byMx(hosts) {
  for (const h of hosts) { const hit = BY_MX.find(([re]) => re.test(h.toLowerCase().replace(/\.$/, ''))); if (hit) return hit[1]; }
  return null;
}

// Thunderbird's directory answers in XML; only the IMAP and SMTP servers matter here.
export function parseAutoconfig(xml) {
  const server = (type, tag) => {
    const re = new RegExp(`<${tag}[^>]*type="${type}"[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const m = xml.match(re);
    if (!m) return null;
    const get = (k) => (m[1].match(new RegExp(`<${k}>([^<]*)</${k}>`, 'i')) || [])[1]?.trim();
    const host = get('hostname'), port = Number(get('port')), sock = (get('socketType') || '').toUpperCase();
    if (!host || !port || host.includes('%')) return null;
    return { host, port, secure: sock === 'SSL' };
  };
  const imap = server('imap', 'incomingServer'), smtp = server('smtp', 'outgoingServer');
  return imap && smtp ? { imap: { host: imap.host, port: imap.port }, smtp } : null;
}

async function directory(domain) {
  try {
    const r = await fetch(`https://autoconfig.thunderbird.net/v1.1/${encodeURIComponent(domain)}`, { signal: AbortSignal.timeout(6000) });
    return r.ok ? parseAutoconfig(await r.text()) : null;
  } catch { return null; }
}

const preset = (id) => ({ provider: id, ...PROVIDERS[id] });

export async function detect(email) {
  const domain = domainOf(email);
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return { error: 'Enter the whole email address.' };
  const known = byDomain(domain);
  if (known) return preset(known);
  let mx = [];
  try { mx = (await resolveMx(domain)).sort((a, b) => a.priority - b.priority).map((r) => r.exchange); } catch {}
  const behind = byMx(mx);
  if (behind) return { ...preset(behind), name: `${PROVIDERS[behind].name} (${domain})` };
  // The directory knows many providers by their own domain or by the MX host's.
  const found = await directory(domain) || (mx[0] ? await directory(mx[0].split('.').slice(-2).join('.')) : null);
  if (found) return { provider: 'imap', kind: 'imap', name: domain, ...found, helpText: 'Use your email password, or an app password if your provider asks for one.' };
  return { provider: 'custom', kind: 'imap', name: domain, custom: true, helpText: 'Switchboard could not find this provider\'s servers. Your provider\'s help pages list them (look for "IMAP settings").' };
}
