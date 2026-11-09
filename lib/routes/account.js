// The Switchboard account: provider sign-in coming back, password sign-in, recovery key, pairing, sync.
// Called by server.js for every request after its host and header checks;
// sends a response when the path is one of these, otherwise does nothing.
import { syncStatus, signUp, signIn, resetStart, resetFinish, signOut, syncNow, oauthStart, oauthFinish, makeRecoveryKey, recoverySeen, unlockWithRecovery, unlockWithPassword, requestPair, cancelPair, answerPair, devices, removeDevice } from '../sync.js';
import { restartRelay, publishTerms } from '../relay.js';
import { setSetting } from '../db.js';
import { send, readJson } from '../http.js';
import { friendlyError } from '../friendly.js';

export async function route({ req, res, path, url, changed, PORT }) {
    // Back from Google, GitHub or Microsoft. A plain page: the board updates by itself.
    if (req.method === 'GET' && path === '/auth/done') {
      const q = Object.fromEntries(url.searchParams);
      let msg = '', ok = true;
      try {
        const r = await oauthFinish(q);
        msg = r.linked ? 'Added. You can sign in with it from now on.' : r.isNew ? 'Your account is ready.' : 'Signed in. One more step in Switchboard to unlock your data.';
        restartRelay(); changed();
      } catch (err) { ok = false; msg = friendlyError(err, 'the sign-in service'); }
      const page = `<!DOCTYPE html><meta charset="utf-8"><title>Switchboard</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#E4E7EB;color:#15171C;display:grid;place-items:center;min-height:100vh;margin:0}div{background:#FCFCFA;border-radius:16px;padding:28px 32px;max-width:420px;box-shadow:0 10px 40px rgba(0,0,0,.12)}h1{font-size:20px;margin:0 0 8px}p{margin:0;color:#5C626C}</style><div><h1>${ok ? 'Done' : 'That did not work'}</h1><p>${msg.replace(/[<>&]/g, '')}</p><p style="margin-top:12px">You can close this tab and go back to Switchboard.</p></div><script>setTimeout(()=>window.close(),1500)</script>`;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(page);
    }

    // ---- Switchboard account (sync)
    if (req.method === 'POST' && path.startsWith('/api/account/')) {
      const b = await readJson(req);
      const act = path.split('/').pop();
      try {
        if (act === 'signup') await signUp(String(b.email || ''), String(b.password || ''));
        else if (act === 'signin') await signIn(String(b.email || ''), String(b.password || ''));
        else if (act === 'reset-start') { await resetStart(String(b.email || '')); return send(res, 200, { ok: true }); }
        else if (act === 'reset-finish') await resetFinish(String(b.email || ''), String(b.code || ''), String(b.password || ''));
        else if (act === 'signout') await signOut();
        else if (act === 'sync') await syncNow();
        else if (act === 'oauth') return send(res, 200, { url: await oauthStart(String(b.provider || ''), `http://127.0.0.1:${PORT}/auth/done`, { link: !!b.link, email: b.email }) });
        else if (act === 'recover') await unlockWithRecovery(String(b.key || ''));
        else if (act === 'unlock') await unlockWithPassword(String(b.password || ''));
        else if (act === 'pair') await requestPair(changed);
        else if (act === 'pair-cancel') cancelPair();
        else if (act === 'pair-answer') await answerPair(String(b.id || ''), !!b.approve);
        else if (act === 'recovery-key') await makeRecoveryKey();
        else if (act === 'recovery-seen') recoverySeen();
        else if (act === 'devices') return send(res, 200, { devices: await devices() });
        else if (act === 'device-remove') { await removeDevice(String(b.id || '')); changed(); return send(res, 200, { ok: true }); }
        else if (act === 'remote') { setSetting('allowRemote', !!b.allow); publishTerms(); changed(); return send(res, 200, { ok: true }); }
        else return send(res, 404, { error: 'Switchboard did not recognise that account step. Reload the page and try again.' });
      } catch (err) { return send(res, 400, { error: friendlyError(err, 'the sync service') }); }
      if (['signup', 'signin', 'reset-finish', 'signout', 'recover', 'unlock'].includes(act)) restartRelay();
      changed();
      return send(res, 200, syncStatus());
    }
}
