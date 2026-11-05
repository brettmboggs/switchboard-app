// What belongs to each project, beyond its main one (Nov 5 2026).
//
// Every thing on the board still has one main project, decided by the rules in
// lib/spaces.js (a word in a repo's name, an address, a chat's name). This adds
// the rest: a repo, person, address, chat, page or one section of a page can
// also belong to other projects, and a page or section can be tied to one repo
// so it shows beside that repo's sessions. The page (public/js/core.js,
// inProject) counts a thing in a project when its main project is that one or
// it has a row here.
//
// Keys say what the thing is: "repo:<name>", "folder:<path>",
// "person:<email>", "domain:@<domain>", "chat:<conversation key>",
// "page:<uid>", "section:<uid>#<heading>".
import { db } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS belongs (
  space TEXT NOT NULL,
  key TEXT NOT NULL,
  label TEXT,
  repo TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (space, key)
);
`);

const KEY = /^(repo|folder|person|domain|chat|page|section|calendar|feed):.{1,500}$/;

export const belongsAll = () => db.prepare('SELECT space, key, label, repo FROM belongs ORDER BY created_at').all();

export function addBelongs({ space, key, label = null, repo = null }) {
  if (!space || typeof space !== 'string' || !KEY.test(String(key || ''))) throw new Error('That cannot be added to a project.');
  db.prepare('INSERT INTO belongs (space, key, label, repo, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(space, key) DO UPDATE SET label = excluded.label, repo = excluded.repo')
    .run(space, key, label ? String(label).slice(0, 200) : null, repo ? String(repo).slice(0, 200) : null, Date.now());
}

export const removeBelongs = ({ space, key }) => db.prepare('DELETE FROM belongs WHERE space = ? AND key = ?').run(String(space), String(key));

// A project that is deleted takes its rows with it.
export const dropSpace = (space) => db.prepare('DELETE FROM belongs WHERE space = ?').run(String(space));
