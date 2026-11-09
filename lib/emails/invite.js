// The invite email (lib/share.js, lib/routes/share.js): "Jordan invited you
// to Acme on Switchboard", sent from the inviter's own connected mail with the
// name "Jordan via Switchboard", only when they click Send. One button, which
// is the link: following it and signing up (or signing in) is joining.
import { layout } from './layout.js';
import { PRODUCT } from '../product.js';

const WHAT = {
  pages: ['Pages and notes', 'pages and their checklists'],
  tasks: ['To-dos', 'to-dos and reminders'],
  repos: ['Repos', 'its code repos: builds and pull requests, with your own GitHub sign-in'],
  activity: ['Activity', 'what the others are working on'],
  about: ['About', 'what the project is, its people and links']
};

// { inviterName, project, link, kinds: {pages: 'edit'|'see'|'none', ...}, days, account }
export function inviteEmail({ inviterName, project, link, kinds = {}, days = 14, account = false }) {
  const who = String(inviterName || 'Someone').trim().slice(0, 60);
  const what = String(project || 'a project').trim().slice(0, 80);
  const list = Object.entries(WHAT).filter(([k]) => kinds[k] && kinds[k] !== 'none').map(([k, [, line]]) => `${line.charAt(0).toUpperCase() + line.slice(1)} (${kinds[k] === 'edit' ? 'see and edit' : 'see'})`);
  const mail = layout({
    preheader: `${who} invited you to ${what}. The link works for ${days} days.`,
    heading: `${who} invited you to ${what} on Switchboard`,
    paragraphs: [
      'Switchboard is one place for your work: notes, to-dos, your code projects and the people on them. Each person keeps their own computer, their own sign-ins and their own private things; a shared project is encrypted end to end, so not even the service that carries it can read it.',
      list.length ? `In ${what} you will be able to see:` : `You will be in ${what}.`
    ],
    list,
    button: { label: `Join ${what} on Switchboard`, url: link },
    after: [
      account ? 'Open the link on a computer where you are signed in to Switchboard with this email: you are in at once.'
        : `New to Switchboard? Install it first (${PRODUCT.downloadUrl}), then open the link: it makes your account with this email, and you are in.`,
      `The link works once, for ${days} days, and only for this email address. If you did not expect it, you can ignore this email.`
    ],
    footer: `Sent by ${who} from their own email, through Switchboard.`
  });
  return { subject: `${who} invited you to ${what} on Switchboard`, ...mail };
}
