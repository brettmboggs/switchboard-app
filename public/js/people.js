// The people on a project's About card: each holds any number of email
// addresses and phone numbers (Nov 5 2026). A card saved before that has a
// single email and phone; these read both forms. Used by project.js (the About
// editor, Merge with…) and search.js.
// One of the page's scripts in public/js, loaded in order by index.html; also
// loaded by test/about-people.test.js. Pure functions, no page.
// Blank boxes stay (the editor draws one per entry, so Add email shows a new
// empty box); what shows a person or searches them skips the blanks.
const emailsOf = (x) => (x?.emails?.length ? x.emails : [x?.email || '']);
const phonesOf = (x) => (x?.phones?.length ? x.phones : [x?.phone || '']);

// Fold person j into person i: i keeps its name and role (or takes j's when it
// has none) and gains every address and number j had, each kept once.
function mergePeople(people, i, j) {
  const a = people[i], b = people[j];
  if (!a || !b || i === j) return people;
  const join = (x, y, same) => [...x, ...y].filter((v, k, all) => v && all.findIndex((w) => w && same(w) === same(v)) === k);
  const emails = join(emailsOf(a), emailsOf(b), (v) => v.toLowerCase());
  const phones = join(phonesOf(a), phonesOf(b), (v) => v.replace(/\D/g, '').slice(-10) || v);
  const one = { name: a.name || b.name, role: a.role || b.role, email: emails[0] || '', phone: phones[0] || '', emails, phones };
  return people.map((x, k) => k === i ? one : x).filter((x, k) => k !== j);
}
if (typeof module !== 'undefined') module.exports = { emailsOf, phonesOf, mergePeople };
