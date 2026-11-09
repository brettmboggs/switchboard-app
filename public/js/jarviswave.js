// Jarvis's wave: a band of light along the bottom of the window, like Siri's,
// while you talk to Jarvis and while it talks back. Listening, it follows your
// voice (talk to type's microphone level: the wave never opens one of its own);
// speaking, it pulses on each word the browser's voice says. The orb swells
// with the same level. Drawn on a canvas only while it shows.
// One of the page's scripts in public/js, loaded in order by index.html; they
// share one scope, so names defined in an earlier file are usable here.
const jvWave = (() => {
  let cv = null, ctx = null, raf = 0, mode = null, level = 0, target = 0, phase = 0;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function mount() {
    if (cv) return;
    cv = document.createElement('canvas'); cv.className = 'jv-wave'; cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv); ctx = cv.getContext('2d');
  }
  function size() { const r = devicePixelRatio || 1; cv.width = innerWidth * r; cv.height = cv.clientHeight * r; ctx.setTransform(r, 0, 0, r, 0, 0); }
  function frame() {
    // Listening: talk to type's own microphone level (voice.js), so the wave never opens a second microphone.
    if (mode === 'listen') { target = Math.min(1, micLevel * 7); micLevel *= 0.9; }
    else if (mode === 'speak') target = Math.max(0.25, target * 0.94);
    else target = 0;
    level += (target - level) * 0.18;
    phase += 0.06 + level * 0.12;
    draw();
    const orb = $('jv-orb'); if (orb) orb.style.setProperty('--jv-level', level.toFixed(3));
    if (mode || level > 0.01) raf = requestAnimationFrame(frame);
    else { raf = 0; cv.classList.remove('on'); }
  }
  function draw() {
    const w = cv.clientWidth, h = cv.clientHeight, mid = h * 0.62;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const waves = [[css('--hud'), 1, 0, 1.6], [css('--hud-2'), 0.8, 1.7, 2.2], [css('--jv-wave-3'), 0.65, 3.1, 1.2]];
    for (const [color, amp, off, k] of waves) {
      const A = h * 0.42 * amp * (0.08 + level);
      const g = ctx.createLinearGradient(0, mid - A, 0, mid + A);
      g.addColorStop(0, 'transparent'); g.addColorStop(0.5, color); g.addColorStop(1, 'transparent');
      ctx.beginPath(); ctx.moveTo(0, mid);
      for (let x = 0; x <= w; x += 6) {
        const t = x / w, env = Math.pow(1 - Math.pow(2 * t - 1, 2), 2);
        ctx.lineTo(x, mid + Math.sin(t * Math.PI * 2 * k + phase + off) * A * env);
      }
      for (let x = w; x >= 0; x -= 6) {
        const t = x / w, env = Math.pow(1 - Math.pow(2 * t - 1, 2), 2);
        ctx.lineTo(x, mid - Math.sin(t * Math.PI * 2 * k + phase * 0.8 + off) * A * env * 0.5);
      }
      ctx.closePath(); ctx.globalAlpha = 0.55; ctx.fillStyle = g; ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  return {
    start(m) {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      mount(); size();
      mode = m; if (m === 'speak') target = 0.6;
      cv.classList.add('on');
      if (!raf) raf = requestAnimationFrame(frame);
    },
    level() { return level; },
    pulse() { target = Math.min(1, 0.65 + Math.random() * 0.35); },
    stop() { mode = null; }
  };
})();
addEventListener('resize', () => { const c = document.querySelector('.jv-wave.on'); if (c) { const r = devicePixelRatio || 1; c.width = innerWidth * r; c.height = c.clientHeight * r; c.getContext('2d').setTransform(r, 0, 0, r, 0, 0); } });
