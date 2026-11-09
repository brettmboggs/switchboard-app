// Another person in test/chat.test.js: their own Switchboard (own data folder,
// own account) in a child process. Runs the steps given as JSON in argv and
// prints the results. Run by itself it does nothing.
const steps = process.argv[2] ? JSON.parse(process.argv[2]) : null;
if (steps) {
  const { setSetting, getSetting } = await import('../lib/db.js');
  const share = await import('../lib/share.js');
  const chat = await import('../lib/chat.js');
  share.setRepoSource(() => []);
  share.setActivitySource(() => []);
  // Alerts are kept for the test, never shown on the desktop.
  const alerts = getSetting('peerAlerts', []);
  chat.onChatAlert((kind, title, body) => { alerts.push([kind, title, body]); setSetting('peerAlerts', alerts); });
  const out = [];
  for (const [what, ...a] of steps) {
    try {
      if (what === 'account') { setSetting('sync', a[0]); out.push(true); }
      else if (what === 'link') { share.keepInviteLink(a[0], a[1] || ''); out.push(true); }
      else if (what === 'sync') { await share.syncShares(); out.push(await chat.syncChat()); }
      else if (what === 'remove') out.push(await share.removeMember(a[0], a[1]) ?? true);
      else if (what === 'board') out.push(chat.chatBoard());
      else if (what === 'threads') out.push(chat.chatThreads());
      else if (what === 'convo') out.push(await chat.chatConversation(a[0], a[1] || 100));
      else if (what === 'send') out.push(await chat.sendChat(a[0], a[1]));
      else if (what === 'act') out.push(await chat.chatAct(a[0], a[1]));
      else if (what === 'seen') out.push(await chat.markSeen(a[0]));
      else if (what === 'typing') out.push(await chat.sendTyping(a[0]) ?? true);
      else if (what === 'alerts') out.push(getSetting('peerAlerts', []));
      // A Switchboard that cheats: it signs an edit (or delete) of someone else's message with its own key and sends it.
      else if (what === 'forge') out.push(await chat._test.post(a[0].replace(/^team:/, ''), a[1]));
      else out.push({ error: 'unknown step ' + what });
    } catch (e) { out.push({ error: e.message }); }
  }
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}
