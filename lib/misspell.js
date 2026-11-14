// Misspelled listings for Flips (lib/ebay.js): a seller who types "Milwalkee"
// or "Nintedo" gets fewer buyers, so the thing often sells cheap. For each
// watched search Flips also looks for its likely misspellings, found two ways:
// the usual wrong spellings of big brands (below), and the typing slips anyone
// makes on a long word (a doubled letter dropped, two letters swapped, a vowel
// left out). eBay searches one word OR another with "(a, b, c)", so one look
// covers a whole list.
const KNOWN = {
  milwaukee: ['milwalkee', 'milwaukie', 'milwakee', 'milwuakee', 'millwaukee'], dewalt: ['dewlat', 'dewaltt', 'dewault', 'dwalt'], makita: ['makitta', 'mikita', 'makida'],
  ryobi: ['ryoby', 'royobi', 'ryboi'], bosch: ['bosh', 'bocsh'], festool: ['festol', 'festoll'], ridgid: ['rigid', 'ridged'], hilti: ['hilty'],
  nintendo: ['nintedo', 'nitendo', 'nintento', 'nintindo', 'ninendo'], playstation: ['playstaion', 'playstaton', 'play station'], xbox: ['x box'],
  nvidia: ['nvida', 'nividia', 'nvidea', 'nvdia'], geforce: ['gforce', 'geforece', 'gefore'], radeon: ['raedon', 'radon', 'redeon'], founders: ["founder's", 'founder', 'fouders', 'foundrs'],
  canon: ['cannon'], nikon: ['nikkon', 'nicon'], sony: ['sonny'], fujifilm: ['fuji film', 'fugifilm', 'fujiflim'], panasonic: ['panisonic', 'panosonic'], olympus: ['olympis', 'olimpus'], leica: ['lieca', 'leika'], sigma: ['sigme'], tamron: ['tamaron', 'tamrom'],
  bose: ['boes'], sennheiser: ['senheiser', 'sennhieser', 'sennheisser', 'senhieser'], beats: ['beets'], garmin: ['garmen', 'gramin'], kindle: ['kindel', 'kinlde'], gopro: ['go pro'],
  logitech: ['logitec', 'logitek'], lenovo: ['lenova', 'lenevo'], samsung: ['samsun', 'samung'], steamdeck: ['steam deck'], oculus: ['occulus', 'oculous'], vitamix: ['vitamixx', 'vita mix'], kitchenaid: ['kitchen aid', 'kitchenade'],
  dyson: ['dison'], yeti: ['yetti'], fluke: ['flukes'], klein: ['kline'], snapon: ['snap on'], stanley: ['stanly'], husqvarna: ['husqavarna', 'husquvarna', 'husqvana'], stihl: ['stihll', 'sthil', 'stilh']
};

// Typing slips for one word: a doubled letter dropped, two inside letters
// swapped, a vowel left out. Only for long plain words (a model number typed
// wrong is just another model).
export function slips(word) {
  const w = String(word || '').toLowerCase();
  if (!/^[a-z]{6,}$/.test(w)) return [];
  const out = new Set();
  for (let i = 1; i < w.length; i++) if (w[i] === w[i - 1]) out.add(w.slice(0, i) + w.slice(i + 1));
  for (let i = 1; i < w.length - 2; i++) if (w[i] !== w[i + 1]) out.add(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
  for (let i = 1; i < w.length - 1; i++) if ('aeiou'.includes(w[i])) out.add(w.slice(0, i) + w.slice(i + 1));
  out.delete(w);
  return [...out];
}

const tokens = (q) => String(q || '').toLowerCase().split(/\s+/).filter(Boolean);

// The misspelling searches for one watched search: up to two, each with one
// word swapped for an OR list of its wrong spellings (brands first). Each comes
// back as { q, word, alts } for lib/ebay.js; eBay's search box takes about 100
// characters, so the list stops there.
export function misspellings(query, { max = 2, perWord = 7, limit = 100 } = {}) {
  const ts = tokens(query);
  const scored = ts.map((t, i) => {
    const plain = t.replace(/[^a-z0-9'-]/g, '');
    const known = KNOWN[plain] || [];
    const typed = slips(plain).filter((s) => !known.includes(s));
    return { i, t: plain, alts: [...known, ...typed], brand: plain in KNOWN };
  }).filter((x) => x.alts.length)
    .sort((a, b) => b.brand - a.brand || b.t.length - a.t.length);
  const out = [];
  for (const x of scored.slice(0, max)) {
    const rest = ts.filter((_, j) => j !== x.i).join(' ');
    let alts = x.alts.slice(0, perWord);
    const build = (as) => `(${as.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(', ')})${rest ? ' ' + rest : ''}`;
    while (alts.length > 1 && build(alts).length > limit) alts = alts.slice(0, -1);
    out.push({ q: build(alts), word: x.t, alts });
  }
  return out;
}
