// Things hidden from Switchboard (Unsorted's Hide, Nov 5 2026): a folder that is
// not a real repo, a sender, a chat. Hidden things stay on the computer and in
// the mail; they just stop showing in Switchboard's lists and pickers. Keys are
// "<kind>:<id>", e.g. "folder:/home/sam/dev/old-downloads" or "person:sam@example.com".
import { getSetting, setSetting } from './db.js';

export const hiddenKeys = () => new Set(getSetting('hidden', []));
export const isHidden = (key) => hiddenKeys().has(key);

export function setHidden(keys, hidden) {
  const set = hiddenKeys();
  for (const k of [].concat(keys)) {
    if (typeof k !== 'string' || !/^[a-z]+:.+/.test(k) || k.length > 600) continue;
    if (hidden) set.add(k); else set.delete(k);
  }
  setSetting('hidden', [...set]);
  return set.size;
}
