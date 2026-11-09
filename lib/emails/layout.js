// The look of every email Switchboard itself writes (an invite now; more
// later): the counter from docs/DESIGN.md (grey around, paper card, ink text,
// one orange button), the Switchboard mark sent inside the email (never a
// remote image, so nothing is fetched when it is opened), and a plain-text
// part for mail apps that show only text.
//
// Hex colours live here and nowhere else outside public/css/tokens.css: email
// apps cannot read CSS variables, so the tokens are copied as values
// (docs/DECISIONS.md, Nov 5 2026). Keep them in step with tokens.css.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const COLORS = { counter: '#E4E7EB', paper: '#FCFCFA', ink: '#15171C', signal: '#FF4F00', muted: '#5C626C', line: '#DCDFE4' };
const here = dirname(fileURLToPath(import.meta.url));
const LOGO_CID = 'switchboard-mark';
let logo = null;
const logoFile = () => (logo ||= readFileSync(join(here, '..', '..', 'public', 'icon-192.png')));

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// { preheader, heading, paragraphs: [text], list: [text], button: { label, url }, after: [text], footer }
// -> { html, text, attachments } for nodemailer.
export function layout({ preheader = '', heading, paragraphs = [], list = [], button = null, after = [], footer = '' }) {
  const c = COLORS;
  const font = "font-family:'Public Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const p = (t) => `<p style="margin:0 0 16px;${font};font-size:15px;line-height:1.55;color:${c.ink}">${esc(t)}</p>`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(heading)}</title></head>
<body style="margin:0;padding:0;background:${c.counter}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.counter}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
<tr><td style="padding:0 4px 16px"><table role="presentation" cellpadding="0" cellspacing="0"><tr>
<td style="vertical-align:middle"><img src="cid:${LOGO_CID}" width="28" height="28" alt="" style="display:block;border:0;border-radius:6px"></td>
<td style="vertical-align:middle;padding-left:8px;font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:20px;font-weight:600;color:${c.ink}">switchboard</td>
</tr></table></td></tr>
<tr><td style="background:${c.paper};border-radius:18px;padding:32px 28px">
<h1 style="margin:0 0 16px;font-family:Fraunces,Georgia,'Times New Roman',serif;font-size:24px;line-height:1.3;font-weight:600;color:${c.ink}">${esc(heading)}</h1>
${paragraphs.map(p).join('')}
${list.length ? `<ul style="margin:0 0 18px;padding-left:20px;${font};font-size:15px;line-height:1.55;color:${c.ink}">${list.map((t) => `<li style="margin:0 0 4px">${esc(t)}</li>`).join('')}</ul>` : ''}
${button ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 22px"><tr><td style="background:${c.signal};border-radius:999px"><a href="${esc(button.url)}" style="display:inline-block;padding:13px 24px;${font};font-size:15px;font-weight:600;color:${c.ink};text-decoration:none">${esc(button.label)}</a></td></tr></table>` : ''}
${after.map((t) => `<p style="margin:0 0 12px;${font};font-size:13px;line-height:1.5;color:${c.muted}">${esc(t)}</p>`).join('')}
</td></tr>
${footer ? `<tr><td style="padding:16px 4px 0;${font};font-size:12px;line-height:1.5;color:${c.muted}">${esc(footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`;
  const text = [heading, '', ...paragraphs.flatMap((t) => [t, '']), ...list.map((t) => '- ' + t), ...(list.length ? [''] : []),
    ...(button ? [`${button.label}: ${button.url}`, ''] : []), ...after.flatMap((t) => [t, '']), ...(footer ? ['--', footer] : [])].join('\n').trim() + '\n';
  return { html, text, attachments: [{ filename: 'switchboard.png', content: logoFile(), cid: LOGO_CID, contentType: 'image/png', contentDisposition: 'inline' }] };
}
