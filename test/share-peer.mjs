// Another person in test/share.test.js: their own Switchboard (own data
// folder, own account) in a child process. Runs the steps given as JSON in
// argv and prints the results. Run by itself it does nothing.
const steps = process.argv[2] ? JSON.parse(process.argv[2]) : null;
if (steps) {
  const { db, setSetting, getSetting } = await import('../lib/db.js');
  const { newPage, savePage } = await import('../lib/pages.js');
  const share = await import('../lib/share.js');
  const { spaces } = await import('../lib/spaces.js');
  // What this person is doing, as server.js would report it (the test also puts
  // a prompt and terminal text in, which must never travel).
  const src = getSetting('peerSources', { repos: [], activity: [] });
  share.setRepoSource(() => src.repos);
  share.setActivitySource(() => src.activity.map((a) => ({ ...a, at: Date.now() - 60e3 })));
  const out = [];
  for (const [what, ...a] of steps) {
    try {
      if (what === 'account') { setSetting('sync', a[0]); out.push(true); }
      else if (what === 'sources') { setSetting('peerSources', a[0]); out.push(true); }
      else if (what === 'sync') out.push(await share.syncShares());
      else if (what === 'state') out.push(share.shareState());
      else if (what === 'link') { share.keepInviteLink(a[0], a[1] || ''); out.push(true); }
      else if (what === 'accept') out.push(await share.acceptShare(a[0]));
      else if (what === 'answer') out.push(await share.answerInvite(a[0], a[1]));
      else if (what === 'leave') out.push(await share.leaveSpace(a[0]) ?? true);
      else if (what === 'invite') out.push(await share.shareProject(a[0], a[1], a[2] || '', a[3] || {}));
      else if (what === 'remove') out.push(await share.removeMember(a[0], a[1]) ?? true);
      else if (what === 'access') out.push(await share.setAccess(a[0], a[1], a[2]));
      else if (what === 'role') out.push(await share.setRole(a[0], a[1]) ?? true);
      else if (what === 'pages') out.push(db.prepare('SELECT uid, title, body, space, private FROM pages ORDER BY title').all());
      else if (what === 'items') out.push(db.prepare('SELECT uid, kind, text, space, done_at FROM items ORDER BY text').all());
      else if (what === 'spaces') out.push(spaces());
      else if (what === 'profile') out.push(getSetting('profiles', {})[a[0]] || null);
      else if (what === 'setProfile') { setSetting('profiles', { ...getSetting('profiles', {}), [a[0]]: a[1] }); out.push(true); }
      else if (what === 'shareMap') out.push(getSetting('shareMap', {}));
      else if (what === 'changedBy') out.push(share.changedBy());
      else if (what === 'kinds') out.push(Object.keys(share._test.keys().get(a[0])?.kinds || {}).sort());
      else if (what === 'newPage') out.push(newPage({ title: a[0], body: a[1], space: a[2] }).uid);
      // An edit from a computer whose clock is a year ahead (review M1).
      else if (what === 'editFuture') out.push(!!savePage(a[0], { body: a[1] }, Date.now() + 365 * 86400e3));
      else if (what === 'edit') out.push(!!savePage(a[0], { body: a[1] }, Date.now() + 5));
      else if (what === 'private') out.push(!!savePage(a[0], { private: a[1] }, Date.now() + 5));
      // An edit to a to-do, later than anything else (as from a computer that was offline).
      else if (what === 'editItem') { db.prepare('UPDATE items SET text = ?, updated_at = ? WHERE uid = ?').run(a[1], Date.now() + 5000, a[0]); out.push(true); }
      // A to-do of one's own made with a uid chosen to match someone else's (review H3).
      else if (what === 'todoUid') { db.prepare('INSERT INTO items (uid, kind, text, space, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(a[0], 'todo', a[1], a[2], Date.now(), Date.now() + 5000); out.push(true); }
      // A to-do deleted on this computer (its deletion goes out as gone, signed).
      else if (what === 'dropItem') { db.prepare('DELETE FROM items WHERE uid = ?').run(a[0]); out.push(true); }
      // × on a page in a project's own list (In this project): lib/sorting.js takeOut.
      else if (what === 'takeOut') { const { takeOut } = await import('../lib/sorting.js'); out.push(takeOut(a[0], { key: 'page:' + a[1], rule: null })); }
      // The notebook's project menu: POST /api/pages/<uid> { space }, through the real route (lib/routes/pages.js).
      else if (what === 'menuMove') {
        const { route } = await import('../lib/routes/pages.js');
        let status = 0, body = '';
        const req = { method: 'POST', async *[Symbol.asyncIterator]() { yield JSON.stringify({ space: a[1] }); } };
        const res = { headersSent: false, writeHead(s) { status = s; this.headersSent = true; }, setHeader() {}, end(d) { body = String(d || ''); } };
        await route({ req, res, path: '/api/pages/' + a[0], url: new URL('http://127.0.0.1/api/pages/' + a[0]), changed: () => {} });
        out.push({ status, ...JSON.parse(body || '{}') });
      }
      else if (what === 'todo') { db.prepare('INSERT INTO items (kind, text, space, created_at) VALUES (?, ?, ?, ?)').run('todo', a[0], a[1], Date.now()); out.push(true); }
      // A Switchboard that cheats: it gives itself Edit in its own copy of the policy (the signature no longer fits).
      else if (what === 'cheat') {
        const r = db.prepare("SELECT v FROM share_kv WHERE share_id = ? AND k = 'policy'").get(a[0]);
        const p = JSON.parse(r.v), me = getSetting('sync', null).email;
        p.grants[me].kinds[a[1]] = 'edit';
        db.prepare("UPDATE share_kv SET v = ? WHERE share_id = ? AND k = 'policy'").run(JSON.stringify(p), a[0]);
        out.push(true);
      }
      // A member who writes a document in the old (before the team) shape, sealed with the project key every member has,
      // asking for every kind on and carrying an unsigned page edit (review H1).
      else if (what === 'forgeLegacy') {
        const { call, seal: sealDoc } = await import('../lib/sync.js');
        const s = getSetting('sync', null), k = share._test.keys().get(a[0]);
        const cur = await call(s.server, `/v1/shares/${a[0]}/doc`, { token: s.token });
        const shares = { pages: true, tasks: true, repos: true, activity: true, about: true };
        const doc = { v: 2, meta: { name: 'Forged', policy: { shares, at: Date.now(), by: s.email } }, pages: [{ uid: a[1], title: 'Forged', body: a[2], pinned: 0, created_at: 1, updated_at: Date.now() + 60e3 }], items: [], dead: [] };
        const put = await call(s.server, `/v1/shares/${a[0]}/doc`, { method: 'PUT', token: s.token, body: { body: sealDoc(doc, k.k), baseVersion: cur.json.version, epoch: cur.json.epoch } });
        out.push(put.status);
      }
      else out.push({ error: 'unknown step ' + what });
    } catch (e) { out.push({ error: e.message }); }
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
