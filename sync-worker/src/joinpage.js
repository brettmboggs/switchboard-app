// The page an invite link opens (GET /join), until the web board exists
// (docs/WEB-BOARD.md). The invitation itself rides after the # in the link, so
// it never reaches this service: this page is the same for everyone, and its
// script reads the # in the browser to show who it is for and to hand it to
// Switchboard: "Open in Switchboard" (the app on this computer, port 4747 or
// one you type), or copy the link into Settings, Account, "Have an invite?
// Paste the link". Plain HTML, no outside files, a strict content policy.
// Hex colours are the counter's (docs/DESIGN.md), as in every page this
// service serves itself.
const PAGE = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Join on Switchboard</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#E4E7EB;color:#15171C;font:16px/1.55 'Public Sans',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
main{background:#FCFCFA;border-radius:18px;padding:32px 30px;max-width:520px;margin:16px;box-shadow:0 10px 40px rgba(0,0,0,.12)}
h1{font:600 24px/1.3 Fraunces,Georgia,serif;margin:0 0 12px}p{margin:0 0 14px}.muted{color:#5C626C;font-size:14px}
a.btn,button{display:inline-block;border:0;border-radius:999px;padding:12px 22px;font:600 15px inherit;cursor:pointer;text-decoration:none}
a.btn{background:#FF4F00;color:#15171C}button{background:transparent;color:#15171C;border:1px solid #CDD1D7;margin-left:6px}
code{background:#F4F5F6;border-radius:6px;padding:2px 6px;word-break:break-all;font-size:13px}
label{font-size:14px;color:#5C626C}input{width:5.5em;font:inherit;padding:4px 8px;border:1px solid #CDD1D7;border-radius:6px;margin-left:6px}
</style></head><body><main>
<h1 id="h">You are invited on Switchboard</h1>
<p id="who" class="muted"></p>
<p>Open it in Switchboard on your computer. If you do not have an account yet, Switchboard makes one with this email, and you are in.</p>
<p><a class="btn" id="open" href="#">Open in Switchboard</a><button type="button" id="copy">Copy invite link</button></p>
<p class="muted"><label>Switchboard runs on port <input id="port" inputmode="numeric" value="4747"></label></p>
<p class="muted">Or in Switchboard: Settings, Account, <b>Have an invite? Paste the link</b>, and paste this page's address. No Switchboard yet? <a href="%DOWNLOAD%" rel="noopener">Download it</a>, then come back to this page.</p>
<p class="muted">The link works once, for 14 days, and only for the email it was sent to.</p>
</main><script>
(function(){
  var h=location.hash.replace(/^#/,'');var q=new URLSearchParams(h.slice(h.indexOf('?')+1));
  var email=q.get('email')||'',p=q.get('p')||'';
  if(p)document.getElementById('h').textContent='Join '+p+' on Switchboard';
  if(email)document.getElementById('who').textContent='For '+email;
  var port=document.getElementById('port'),open=document.getElementById('open');
  function set(){var n=parseInt(port.value,10);if(!(n>0&&n<65536))n=4747;open.href='http://127.0.0.1:'+n+'/#'+h;}
  port.addEventListener('input',set);set();
  document.getElementById('copy').addEventListener('click',function(){navigator.clipboard&&navigator.clipboard.writeText(location.href).then(function(){document.getElementById('copy').textContent='Copied';});});
})();
</script></body></html>`;

// DOWNLOAD_URL (a Worker variable) is where your Switchboard downloads are, for a self-hosted service.
export function joinPage(env = {}) {
  const dl = /^https:\/\/[^"<>\s]+$/.test(env.DOWNLOAD_URL || '') ? env.DOWNLOAD_URL : 'https://github.com/brettmboggs/switchboard-app/releases/latest';
  return new Response(PAGE.replace('%DOWNLOAD%', dl), { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'
  } });
}
