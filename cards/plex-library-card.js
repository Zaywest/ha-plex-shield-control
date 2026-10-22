/* Plex Library card for Home Assistant
 * Your whole Plex library (movies, shows, cartoons...) as one poster grid, read straight from
 * your Plex Media Server. Tap a title -> details -> Play / Resume / Start over on your TV.
 * Playback is started by the Home Assistant script `script.plex_library_play`
 * (see homeassistant/scripts.yaml), which opens the title with Plex's own in-app library link
 * on the Android TV / NVIDIA SHIELD and presses the right button.
 *
 * Each browser/device links to plex.tv once (tap "Link this device", enter the code at
 * plex.tv/link). The server address + token are stored in that browser only (localStorage).
 *
 * Config:
 *   type: custom:plex-library-card
 *   play_script: script.plex_library_play   # optional (this is the default)
 *   server_id: <Plex server machine id>      # optional: pick a server if you have several
 *   home_path: /lovelace/0                   # optional: adds a "back" button to this path
 */
(() => {
const TAG = 'plex-library-card';
if (customElements.get(TAG)) return;
const STORE = 'plexLibraryCard.v1';
const CLIENT = 'plexLibraryCard.v1.client';
const PAGE = 400;          // Plex items fetched per request
const BATCH = 120;         // posters added to the page per scroll step

const css = `
:host{display:block}
.card{background:linear-gradient(145deg,#0b0d17,#141022);border:1px solid rgba(155,99,255,.45);border-radius:4px;
  clip-path:polygon(16px 0,calc(100% - 16px) 0,100% 16px,100% calc(100% - 16px),calc(100% - 16px) 100%,16px 100%,0 calc(100% - 16px),0 16px);
  color:#f4f1ff;padding:16px 18px 22px;font-family:var(--ha-font-family-body,Roboto,sans-serif);min-height:300px}
.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
h1{font-size:20px;letter-spacing:3px;margin:0;font-weight:800}
.count{color:#aaa0bb;font-size:12px;letter-spacing:1px}
.spacer{flex:1}
button{font:inherit;cursor:pointer;color:#f4f1ff;background:#141022;border:1px solid #45345e;border-radius:4px;padding:7px 12px;font-size:12px;font-weight:700;letter-spacing:.6px}
button:hover{border-color:#9b63ff}
button.primary{background:linear-gradient(145deg,#6940ff,#5932b4);border-color:#9b63ff}
button.on{background:#2c1957;border-color:#9b63ff;color:#fff}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:14px 0 12px}
input,select{font:inherit;font-size:13px;color:#f4f1ff;background:#090611;border:1px solid #45345e;border-radius:4px;padding:8px 10px}
input{flex:1;min-width:180px}
.msg{color:#aaa0bb;font-size:13px;margin:10px 0;line-height:1.5}
.err{color:#ff8799}
.code{font-size:34px;letter-spacing:8px;font-weight:800;color:#55ddff;margin:8px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(128px,1fr));gap:14px}
.item{cursor:pointer;position:relative}
.poster{aspect-ratio:2/3;width:100%;border-radius:4px;background:#141022 center/cover no-repeat;border:1px solid #2c1957;overflow:hidden;
  display:flex;align-items:center;justify-content:center;color:#6950a0;font-size:11px;text-align:center}
.poster img{width:100%;height:100%;object-fit:cover;display:block}
.item:hover .poster{border-color:#9b63ff;box-shadow:0 0 14px rgba(155,99,255,.35)}
.t{font-size:12px;font-weight:700;margin-top:6px;line-height:1.25;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.y{font-size:11px;color:#aaa0bb}
.badge{position:absolute;top:6px;left:6px;background:rgba(9,6,17,.85);border:1px solid #45345e;border-radius:3px;font-size:9px;letter-spacing:.8px;padding:2px 5px;text-transform:uppercase}
.sentinel{height:40px}
.sheet{position:fixed;inset:0;background:rgba(5,4,10,.78);display:flex;align-items:center;justify-content:center;z-index:9;padding:16px}
.panel{background:#0b0d17;border:1px solid #9b63ff;border-radius:6px;max-width:720px;width:100%;max-height:88vh;overflow:auto;padding:18px;display:grid;grid-template-columns:150px 1fr;gap:16px}
.panel h2{margin:0 0 4px;font-size:18px}
.panel .sum{color:#cfc8df;font-size:13px;line-height:1.5;margin:8px 0 12px}
.eps{grid-column:1/-1}
.season{margin:10px 0 4px;font-size:12px;color:#55ddff;letter-spacing:1.5px;font-weight:800;text-transform:uppercase}
.ep{display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid #1d1830;font-size:13px}
.ep span{flex:1}
@media (max-width:560px){.panel{grid-template-columns:1fr}.panel .poster{max-width:160px}}
`;

class PlexLibraryCard extends HTMLElement {
  setConfig(config) {
    this.config = Object.assign({ shield_remote: 'remote.shield_android_tv' }, config || {});
    this.items = []; this.sections = []; this.filter = 'all'; this.query = ''; this.sort = 'title';
    this.shown = BATCH; this.status = 'idle'; this.message = '';
    if (!this.shadowRoot) { this.attachShadow({ mode: 'open' }); }
    this.access = this.loadAccess();
  }
  set hass(hass) {
    this._hass = hass;
    if (!this.started) { this.started = true; this.access ? this.loadLibrary() : this.render(); }
  }
  getCardSize() { return 12; }

  // ---------- storage ----------
  loadAccess() { try { const a = JSON.parse(localStorage.getItem(STORE) || 'null'); return a && a.origin && a.token ? a : null; } catch { return null; } }
  saveAccess(a) { try { localStorage.setItem(STORE, JSON.stringify(a)); } catch {} }
  clientId() {
    let id = null; try { id = localStorage.getItem(CLIENT); } catch {}
    if (!id) { id = 'ha-plex-card-' + (crypto.randomUUID?.() || Math.random().toString(36).slice(2)); try { localStorage.setItem(CLIENT, id); } catch {} }
    return id;
  }

  // ---------- plex.tv linking ----------
  async plexTv(path, { method = 'GET', token } = {}) {
    const headers = { Accept: 'application/json', 'X-Plex-Client-Identifier': this.clientId(), 'X-Plex-Product': 'HA Plex Library Card', 'X-Plex-Version': '3.0' };
    if (token) headers['X-Plex-Token'] = token;
    const r = await fetch(new URL(path, 'https://plex.tv'), { method, headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
    if (!r.ok) throw new Error('plex.tv answered ' + r.status);
    return r.json();
  }
  async startLink() {
    this.status = 'linking'; this.message = ''; this.render();
    try {
      this.pin = await this.plexTv('/api/v2/pins', { method: 'POST' });
      this.render();
      clearInterval(this.poll);
      const started = Date.now();
      this.poll = setInterval(async () => {
        if (Date.now() - started > 10 * 60 * 1000) { clearInterval(this.poll); this.status = 'idle'; this.message = 'The code expired. Tap Link this device to get a new one.'; this.render(); return; }
        try {
          const p = await this.plexTv('/api/v2/pins/' + encodeURIComponent(this.pin.id));
          if (p.authToken) { clearInterval(this.poll); await this.finishLink(p.authToken); }
        } catch {}
      }, 2500);
    } catch (e) { this.status = 'idle'; this.message = 'Could not reach plex.tv: ' + e.message; this.render(); }
  }
  async finishLink(userToken) {
    this.status = 'connecting'; this.message = 'Linked. Finding your Plex server…'; this.render();
    try {
      const res = await this.plexTv('/api/v2/resources?includeHttps=1&includeRelay=1', { token: userToken });
      const servers = (res || []).filter(x => String(x.provides || '').includes('server'));
      const server = servers.find(x => x.clientIdentifier === this.config.server_id) || servers.find(x => x.owned) || servers[0];
      if (!server) throw new Error('No Plex Media Server on this account.');
      const conns = (server.connections || []).filter(c => c.uri && c.uri.startsWith('https:'))
        .sort((a, b) => (b.local - a.local) || (a.relay - b.relay));
      const token = server.accessToken || userToken;
      for (const c of conns) {
        const origin = new URL(c.uri).origin;
        try { await this.api('/library/sections', {}, { origin, token }, 6000); this.access = { origin, token, server: server.name, machine: server.clientIdentifier }; this.saveAccess(this.access); this.pin = null; return this.loadLibrary(); } catch {}
      }
      throw new Error('Found "' + server.name + '" but could not reach it from this device.');
    } catch (e) { this.status = 'idle'; this.pin = null; this.message = e.message; this.render(); }
  }
  unlink() { try { localStorage.removeItem(STORE); } catch {} this.access = null; this.items = []; this.status = 'idle'; this.message = 'This device is unlinked from Plex.'; this.render(); }

  // ---------- server ----------
  async api(path, params = {}, access = this.access, timeout = 20000, extraHeaders = {}) {
    const url = new URL(path, access.origin);
    if (url.origin !== access.origin) throw new Error('Bad Plex path');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url, { headers: Object.assign({ Accept: 'application/json', 'X-Plex-Token': access.token }, extraHeaders), credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(timeout) });
    if (r.status === 401) { const e = new Error('Plex refused this device (401).'); e.auth = true; throw e; }
    if (!r.ok) throw new Error('Plex answered ' + r.status);
    return (await r.json()).MediaContainer || {};
  }
  async loadLibrary() {
    this.status = 'loading'; this.message = 'Loading your library…'; this.render();
    try {
      const secs = await this.api('/library/sections');
      this.sections = (secs.Directory || []).filter(d => d.type === 'movie' || d.type === 'show').map(d => ({ key: String(d.key), title: d.title, type: d.type }));
      const byKey = new Map();
      for (const s of this.sections) {
        for (let start = 0; ; start += PAGE) {
          const mc = await this.api('/library/sections/' + s.key + '/all',
            { includeGuids: 1, 'X-Plex-Container-Start': start, 'X-Plex-Container-Size': PAGE }, this.access, 30000);
          for (const m of (mc.Metadata || [])) {
            const id = (m.guid && !m.guid.startsWith('local://') ? m.guid : null) || (m.type + ':' + (m.title || '').toLowerCase() + ':' + (m.year || ''));
            const seen = byKey.get(id);
            if (seen) { if (!seen.libs.includes(s.title)) seen.libs.push(s.title); continue; }
            byKey.set(id, { rk: m.ratingKey, slug: m.slug || '', type: m.type, title: m.title || '', sortTitle: (m.titleSort || m.title || '').toLowerCase(), year: m.year || '',
              thumb: m.thumb || '', added: m.addedAt || 0, summary: m.summary || '', libs: [s.title], leafs: m.leafCount || 0, duration: m.duration || 0, offset: m.viewOffset || 0 });
          }
          this.message = 'Loading your library… ' + byKey.size + ' titles';
          this.renderStatus();
          const total = mc.totalSize ?? mc.size ?? 0;
          if (!(mc.Metadata || []).length || start + PAGE >= total) break;
        }
      }
      this.items = [...byKey.values()];
      this.status = 'ready'; this.message = ''; this.shown = BATCH; this.render();
    } catch (e) {
      if (e.auth) { this.unlink(); this.message = 'Plex no longer accepts this device. Link it again.'; this.render(); return; }
      this.status = 'error'; this.message = 'Could not load the library from ' + (this.access?.server || 'Plex') + ': ' + e.message; this.render();
    }
  }
  img(thumb, w = 240, h = 360) {
    if (!thumb || !this.access) return '';
    const u = new URL('/photo/:/transcode', this.access.origin);
    u.searchParams.set('width', w); u.searchParams.set('height', h); u.searchParams.set('minSize', 1); u.searchParams.set('upscale', 1);
    u.searchParams.set('url', thumb); u.searchParams.set('X-Plex-Token', this.access.token);
    return u.href;
  }

  // ---------- playback ----------
  // The Home Assistant script opens the title with Plex's own in-app library link (found in
  // the Plex app's route table) and presses Watch/Resume, or Restart for "Start over".
  static libraryLink(machine, meta) {
    const slug = s => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item';
    return meta.type === 'episode'
      ? `plex://libraries/${machine}/show/${slug(meta.showSlug || meta.show)}/${meta.showRk}/s/${meta.season}/${meta.seasonRk}/e/${meta.index}/${meta.rk}`
      : `plex://libraries/${machine}/movie/${slug(meta.slug || meta.title)}/${meta.rk}`;
  }
  mmss(ms) { const s = Math.floor((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m + '') + ':' + String(s % 60).padStart(2, '0'); }
  // fromStart=true: the SHIELD presses Plex's own "Restart" button instead of "Resume".
  async play(meta, fromStart = false) {
    const h = this._hass;
    const label = meta.type === 'episode' ? `${meta.show} – ${meta.epTitle}` : meta.title;
    const uri = PlexLibraryCard.libraryLink(this.access?.machine || this.config.server_id, meta);
    try {
      await h.callService('script', 'turn_on', { entity_id: this.config.play_script || 'script.plex_library_play',
        variables: { uri, start_over: !!fromStart } });
      this.toast(fromStart ? 'Starting ' + label + ' from the beginning…' : 'Starting ' + label + ' on the SHIELD…');
    } catch (e) { this.toast('Could not start ' + label + ': ' + (e.message || e)); }
  }
  toast(text) {
    const ev = new Event('hass-notification', { bubbles: true, composed: true }); ev.detail = { message: text }; this.dispatchEvent(ev);
  }

  // ---------- view ----------
  visible() {
    const q = this.query.trim().toLowerCase();
    let list = this.items.filter(i => (this.filter === 'all' || i.libs.includes(this.filter)) && (!q || i.title.toLowerCase().includes(q)));
    const by = { title: (a, b) => a.sortTitle.localeCompare(b.sortTitle), year: (a, b) => (b.year || 0) - (a.year || 0) || a.sortTitle.localeCompare(b.sortTitle), added: (a, b) => b.added - a.added }[this.sort];
    return list.sort(by);
  }
  el(tag, attrs = {}, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (k === 'class') e.className = v; else e.setAttribute(k, v); }
    for (const k of kids) if (k != null) e.append(k);
    return e;
  }
  renderStatus() { const m = this.shadowRoot?.querySelector('.msg'); if (m) m.textContent = this.message; }
  render() {
    const root = this.shadowRoot; if (!root) return;
    root.innerHTML = ''; root.append(this.el('style', {}, css));
    const card = this.el('div', { class: 'card' }); root.append(card);
    const top = this.el('div', { class: 'top' }, this.el('h1', {}, 'PLEX LIBRARY'));
    card.append(top);
    if (this.config.home_path) top.append(this.el('span', { class: 'spacer' }), this.el('button', { onclick: () => { history.pushState(null, '', this.config.home_path); window.dispatchEvent(new CustomEvent('location-changed')); } }, 'Back'));

    if (!this.access) {
      card.append(this.el('div', { class: 'msg' }, 'Link this device to Plex once to see your whole library here, even when the SHIELD is off. The link is saved on this device only.'));
      if (this.pin && this.status === 'linking') {
        card.append(this.el('div', { class: 'msg' }, 'On your phone or computer go to plex.tv/link and enter:'), this.el('div', { class: 'code' }, this.pin.code),
          this.el('div', { class: 'msg' }, 'This page connects by itself as soon as you approve it.'));
      } else {
        card.append(this.el('button', { class: 'primary', onclick: () => this.startLink() }, this.status === 'linking' ? 'Getting a code…' : 'Link this device'));
      }
      if (this.message) card.append(this.el('div', { class: 'msg err' }, this.message));
      return;
    }
    if (this.status !== 'ready') {
      card.append(this.el('div', { class: 'msg' + (this.status === 'error' ? ' err' : '') }, this.message));
      if (this.status === 'error') card.append(this.el('div', { class: 'bar' }, this.el('button', { class: 'primary', onclick: () => this.loadLibrary() }, 'Try again'), this.el('button', { onclick: () => this.unlink() }, 'Unlink this device')));
      return;
    }
    const list = this.visible();
    top.insertBefore(this.el('span', { class: 'count' }, list.length + (list.length === 1 ? ' title' : ' titles')), top.children[1] || null);

    const chips = this.el('div', { class: 'bar' });
    for (const f of ['all', ...this.sections.map(s => s.title)]) chips.append(this.el('button', { class: this.filter === f ? 'on' : '', onclick: () => { this.filter = f; this.shown = BATCH; this.render(); } }, f === 'all' ? 'Everything' : f));
    card.append(chips);
    const search = this.el('input', { type: 'search', placeholder: 'Search ' + this.items.length + ' titles…' }); search.value = this.query;
    search.addEventListener('input', () => { this.query = search.value; this.shown = BATCH; clearTimeout(this.qt); this.qt = setTimeout(() => { this.render(); const s = this.shadowRoot.querySelector('input'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); });
    const sort = this.el('select', {}); for (const [v, t] of [['title', 'A → Z'], ['added', 'Recently added'], ['year', 'Newest year']]) { const o = this.el('option', { value: v }, t); if (v === this.sort) o.selected = true; sort.append(o); }
    sort.addEventListener('change', () => { this.sort = sort.value; this.shown = BATCH; this.render(); });
    card.append(this.el('div', { class: 'bar' }, search, sort, this.el('button', { onclick: () => this.loadLibrary() }, 'Refresh')));

    const grid = this.el('div', { class: 'grid' }); card.append(grid);
    const addBatch = () => {
      const from = grid.children.length, to = Math.min(this.shown, list.length);
      for (const it of list.slice(from, to)) {
        const poster = this.el('div', { class: 'poster' });
        const src = this.img(it.thumb);
        if (src) poster.append(this.el('img', { src, loading: 'lazy', alt: '' })); else poster.append(it.title);
        const kids = [poster, this.el('div', { class: 't' }, it.title), this.el('div', { class: 'y' }, [it.year, it.type === 'show' ? (it.leafs ? it.leafs + ' episodes' : 'Show') : ''].filter(Boolean).join(' · '))];
        if (this.filter === 'all' && this.sections.length > 1) kids.push(this.el('span', { class: 'badge' }, it.libs[0]));
        grid.append(this.el('div', { class: 'item', onclick: () => this.open(it) }, ...kids));
      }
    };
    addBatch();
    if (!list.length) card.append(this.el('div', { class: 'msg' }, 'Nothing matches.'));
    const sentinel = this.el('div', { class: 'sentinel' }); card.append(sentinel);
    this.io?.disconnect();
    this.io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting) && this.shown < list.length) { this.shown += BATCH; addBatch(); } }, { rootMargin: '800px' });
    this.io.observe(sentinel);
    card.append(this.el('div', { class: 'bar' }, this.el('span', { class: 'count' }, 'Connected to ' + (this.access.server || 'Plex') + ' · '), this.el('button', { onclick: () => this.unlink() }, 'Unlink this device')));
  }
  async open(it) {
    const sheet = this.el('div', { class: 'sheet', onclick: e => { if (e.target === sheet) sheet.remove(); } });
    const panel = this.el('div', { class: 'panel' }); sheet.append(panel);
    const poster = this.el('div', { class: 'poster' }); const src = this.img(it.thumb, 300, 450); if (src) poster.append(this.el('img', { src, alt: '' }));
    const info = this.el('div', {}, this.el('h2', {}, it.title), this.el('div', { class: 'y' }, [it.year, it.libs.join(' · '), it.duration ? Math.round(it.duration / 60000) + ' min' : ''].filter(Boolean).join(' · ')),
      this.el('div', { class: 'sum' }, it.summary));
    const btns = this.el('div', { class: 'bar' });
    if (it.type === 'movie') {
      const resumable = it.offset > 60000 && (!it.duration || it.offset < it.duration * 0.95);
      if (resumable) {
        btns.append(this.el('button', { class: 'primary', onclick: () => { sheet.remove(); this.play(it, false); } }, '▶ Resume ' + this.mmss(it.offset)));
        btns.append(this.el('button', { onclick: () => { sheet.remove(); this.play(it, true); } }, '↺ Start over'));
      } else {
        btns.append(this.el('button', { class: 'primary', onclick: () => { sheet.remove(); this.play(it, false); } }, '▶ Play on SHIELD'));
      }
    }
    btns.append(this.el('button', { onclick: () => sheet.remove() }, 'Close'));
    info.append(btns); panel.append(poster, info);
    this.shadowRoot.append(sheet);
    if (it.type === 'show') {
      const eps = this.el('div', { class: 'eps' }, this.el('div', { class: 'msg' }, 'Loading episodes…')); panel.append(eps);
      try {
        const mc = await this.api('/library/metadata/' + it.rk + '/allLeaves');
        eps.innerHTML = ''; let season = null;
        for (const e of (mc.Metadata || [])) {
          if (e.parentIndex !== season) { season = e.parentIndex; eps.append(this.el('div', { class: 'season' }, e.parentTitle || ('Season ' + season))); }
          const meta = { rk: e.ratingKey, type: 'episode', show: it.title, showSlug: it.slug, showRk: it.rk, epTitle: e.title, season: e.parentIndex, seasonRk: e.parentRatingKey, index: e.index };
          const row = this.el('div', { class: 'ep' }, this.el('span', {}, (e.index ? e.index + '. ' : '') + e.title));
          const off = e.viewOffset || 0, resumable = off > 60000 && (!e.duration || off < e.duration * 0.95);
          if (resumable) {
            row.append(this.el('button', { onclick: () => { sheet.remove(); this.play(meta, false); } }, '▶ ' + this.mmss(off)));
            row.append(this.el('button', { onclick: () => { sheet.remove(); this.play(meta, true); } }, '↺'));
          } else {
            row.append(this.el('button', { onclick: () => { sheet.remove(); this.play(meta, false); } }, '▶ Play'));
          }
          eps.append(row);
        }
        if (!(mc.Metadata || []).length) eps.append(this.el('div', { class: 'msg' }, 'No episodes found.'));
      } catch (e) { eps.innerHTML = ''; eps.append(this.el('div', { class: 'msg err' }, 'Could not load episodes: ' + e.message)); }
    }
  }
  disconnectedCallback() { this.io?.disconnect(); clearInterval(this.poll); }
}
customElements.define(TAG, PlexLibraryCard);
window.customCards = window.customCards || [];
window.customCards.push({ type: TAG, name: 'Plex Library', description: 'Whole Plex library on one page, straight from the server.' });
})();
