/* Plex Now Playing card for Home Assistant
 * Shows the title, artwork, synopsis and a progress bar for what Plex is playing on an
 * Android TV / NVIDIA SHIELD, and lets you drag (scrub) the bar to jump anywhere in the
 * movie WITHOUT leaving it. The jump is done by the Home Assistant script `script.plex_seek`
 * (see homeassistant/scripts.yaml), which uses Plex's own media-session "seek to" on the device.
 *
 * Config:
 *   type: custom:plex-now-playing-card
 *   plex: media_player.plex_xxx            # Home Assistant's Plex client entity for the TV (required)
 *   shield: media_player.shield_xxx        # optional: Android TV Remote entity (app name/state)
 *   source: sensor.xxx                     # optional: sensor whose state names the active app
 *   playback: sensor.xxx                   # optional: sensor with playing/paused/idle
 *   receiver: media_player.avr_xxx         # optional: AV receiver (shows audio/video format)
 *   seek_script: script.plex_seek          # optional (default script.plex_seek)
 */
class PlexNowPlayingCard extends HTMLElement {
  constructor() { super(); this.attachShadow({mode:'open'}); }
  setConfig(config) { this.config=config; if(this._hass) this.render(); }
  set hass(value) { this._hass=value; this.render(); }
  connectedCallback() { clearInterval(this.timer); this.timer=setInterval(()=>this.updateProgress(),1000); }
  disconnectedCallback() { clearInterval(this.timer); }
  getCardSize() { return 9; }
  getGridOptions() { return {columns:'full',rows:'auto',min_columns:6}; }
  state(id) { return this._hass?.states[id]; }
  clean(value) { return value!=null&&!['unknown','unavailable','none',''].includes(String(value).toLowerCase())?String(value):''; }
  escape(value) { return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  time(value) { const n=Math.max(0,Math.floor(Number(value)||0)); return n>=3600?`${Math.floor(n/3600)}:${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`:`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; }
  media() {
    const plex=this.state(this.config.plex),shield=this.state(this.config.shield);
    const source=this.clean(this.state(this.config.source)?.state);
    const app=String(shield?.attributes?.app_id||'').toLowerCase();
    // Follow the existing unified source; a stale Plex session must not override another app.
    const usePlex=/plex/i.test(source)||(!source&&app.includes('plex'))||(!source&&!app&&['playing','paused'].includes(plex?.state));
    const selected=usePlex?plex:shield;
    const valid=selected&&!['unavailable','unknown'].includes(selected.state);
    const entity=valid?selected:null;
    const status=this.clean(this.state(this.config.playback)?.state)||entity?.state||'idle';
    return {entity,attributes:entity?.attributes||{},status,source:source||(usePlex?'Plex':this.clean(shield?.attributes?.app_name)||'Player')};
  }
  progress(media=this.media(),now=Date.now()) {
    const a=media.attributes,duration=Number(a.media_duration)||0;
    const start=Date.parse(a.media_position_updated_at),base=Number(a.media_position)||0;
    const elapsed=media.status==='playing'&&Number.isFinite(start)?Math.max(0,(now-start)/1000):0;
    const position=Math.max(0,duration?Math.min(duration,base+elapsed):base);
    return {duration,position,percent:duration?Math.min(100,position/duration*100):0};
  }
  render() {
    if(!this.config||!this._hass)return;
    const m=this.media(),a=m.attributes;
    const avr=this.state(this.config.receiver),receiverActive=avr&&!['off','unavailable','unknown'].includes(avr.state);
    const audio=receiverActive?avr.attributes.audio_information||{}:{},video=receiverActive?avr.attributes.video_information||{}:{};
    const title=this.clean(a.media_title)||(m.status==='idle'?'Ready for your next feature':m.source);
    const plot=this.clean(a.media_summary||a.overview||a.description);
    const chips=[m.source,m.status,a.media_content_type,a.media_content_rating,a.media_year,video.input_hdr].map(v=>this.clean(v)).filter(Boolean);
    const metadata=[['Series',a.media_series_title],['Episode',a.media_episode!=null?`${a.media_season!=null?'Season '+a.media_season+' · ':''}Episode ${a.media_episode}`:''],['Library',a.media_library_title],['Video · AVR input',video.input_resolution],['Audio format',audio.input_signal_format],['Input channels',audio.input_channels],['Speaker output',audio.output_channels],['Sample rate',audio.input_frequency],['Listening mode',audio.listening_mode],['Color depth',video.input_color_depth],['Director',a.director],['Rating',a.imdb_rating]].filter(([,v])=>this.clean(v));
    const cast=Array.isArray(a.cast)?a.cast.map(v=>typeof v==='string'?v:v.name).filter(Boolean).join(', '):this.clean(a.cast);
    if(cast)metadata.push(['Cast',cast]);
    const snapshot=JSON.stringify([title,plot,chips,metadata,a.entity_picture,m.status,a.media_duration]);
    if(snapshot!==this.snapshot){
      this.snapshot=snapshot;
      this.shadowRoot.innerHTML=`<style>${PlexNowPlayingCard.css}</style><ha-card><div class="frame"><div class="poster"><div class="placeholder"><ha-icon icon="mdi:movie-open-outline"></ha-icon><span>NOW PLAYING</span></div><img alt="${this.escape(title)} artwork" hidden><div class="poster-tag"><span class="dot"></span>${this.escape(m.status)}</div></div><div class="details"><div class="eyebrow"><ha-icon icon="mdi:movie-filter"></ha-icon>NOW SHOWING<span></span></div><h2>${this.escape(title)}</h2><div class="chips">${chips.map(v=>`<span>${this.escape(v)}</span>`).join('')}</div>${plot?`<p class="plot">${this.escape(plot)}</p>`:'<p class="plot empty">Media details appear here when your active player supplies them.</p>'}<dl>${metadata.map(([k,v])=>`<div><dt>${this.escape(k)}</dt><dd>${this.escape(v)}</dd></div>`).join('')}</dl><div class="progress-area"><div class="progress-label"><span id="elapsed"></span><span id="remaining"></span></div><div class="track-wrap" tabindex="0" role="slider" aria-label="Playback position" aria-valuemin="0" aria-valuemax="100"><div class="track"><div id="fill"></div></div><div id="thumb"></div><div id="tip"></div></div><div class="progress-label bottom"><span id="play-status"></span><span id="duration"></span></div></div></div></div></ha-card>`;
      const img=this.shadowRoot.querySelector('img');
      if(a.entity_picture){try{const u=new URL(a.entity_picture,location.origin);if(['http:','https:'].includes(u.protocol)){img.onload=()=>{img.hidden=false;};img.onerror=()=>{img.hidden=true;};img.src=u.href;}}catch{}}
      this.bindScrub();
    }
    this.updateProgress();
  }
  // ---------- scrubbing (Plex only) ----------
  // Drag or tap the bar (or use arrow keys + Enter) to pick a time; on release the card calls
  // the seek script, which seeks the playing title on the TV without leaving it.
  canScrub(m=this.media(),p=this.progress(m)) { return /plex/i.test(m.source)&&p.duration>0&&!this.seeking; }
  bindScrub() {
    const wrap=this.shadowRoot.querySelector('.track-wrap'); if(!wrap)return;
    const frac=e=>{const r=wrap.getBoundingClientRect();return Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));};
    wrap.addEventListener('pointerdown',e=>{
      const m=this.media(),p=this.progress(m);
      if(!this.canScrub(m,p)){ if(!/plex/i.test(m.source)) this.note('Scrubbing works for Plex playback.'); return; }
      try{wrap.setPointerCapture(e.pointerId);}catch{} this.drag={duration:p.duration,target:frac(e)*p.duration}; wrap.classList.add('dragging'); this.updateProgress(); e.preventDefault();
    });
    wrap.addEventListener('pointermove',e=>{ if(!this.drag)return; this.drag.target=frac(e)*this.drag.duration; this.updateProgress(); });
    const end=(commit)=>{ if(!this.drag)return; const t=this.drag.target; this.drag=null; wrap.classList.remove('dragging'); if(commit)this.seek(t); else this.updateProgress(); };
    wrap.addEventListener('pointerup',()=>end(true));
    wrap.addEventListener('pointercancel',()=>end(false));
    wrap.addEventListener('keydown',e=>{ // keyboard: arrows pick a time (±30 s), Enter jumps there
      const m=this.media(),p=this.progress(m); if(!this.canScrub(m,p))return;
      if(e.key==='ArrowRight'||e.key==='ArrowLeft'){ this.kbd=Math.min(p.duration,Math.max(0,(this.kbd??p.position)+(e.key==='ArrowRight'?30:-30))); this.drag={duration:p.duration,target:this.kbd,kbd:true}; wrap.classList.add('dragging'); this.updateProgress(); e.preventDefault(); }
      else if(e.key==='Enter'&&this.drag){ const t=this.drag.target; this.drag=null; this.kbd=null; wrap.classList.remove('dragging'); this.seek(t); e.preventDefault(); }
      else if(e.key==='Escape'){ this.drag=null; this.kbd=null; wrap.classList.remove('dragging'); this.updateProgress(); }
    });
  }
  note(text){ const ev=new Event('hass-notification',{bubbles:true,composed:true}); ev.detail={message:text}; this.dispatchEvent(ev); }
  // Every jump stays INSIDE the movie: the seek script calls Plex's own media-session
  // "seek to" on the TV (exact, no reload).
  async seek(target) {
    const want=Math.max(0,Math.floor(target));
    this.seeking={target:want,until:Date.now()+15000}; this.updateProgress();
    try{
      await this._hass.callService('script','turn_on',{entity_id:this.config.seek_script||'script.plex_seek',variables:{seconds:want}});
    }catch(e){ this.seeking=null; this.note('Could not jump: '+(e.message||e)); this.updateProgress(); }
  }
  updateProgress() {
    if(!this.config||!this._hass)return;
    const root=this.shadowRoot;if(!root.querySelector('#elapsed'))return;
    const m=this.media(),p=this.progress(m);
    // finished jumping once the player reports a position near the target (or after 25 s)
    if(this.seeking&&(Date.now()>this.seeking.until||(m.status==='playing'&&Math.abs(p.position-this.seeking.target)<20)))this.seeking=null;
    const shown=this.drag?this.drag.target:this.seeking?this.seeking.target:p.position;
    const pct=p.duration?Math.min(100,shown/p.duration*100):0;
    root.querySelector('#elapsed').textContent=!p.duration?'Position unavailable':this.drag?'Jump to '+this.time(shown):this.seeking?'Jumping to '+this.time(shown)+'…':this.time(shown);
    root.querySelector('#remaining').textContent=p.duration?this.time(p.duration-shown)+' remaining':'';
    root.querySelector('#duration').textContent=p.duration?'Runtime '+this.time(p.duration):'';
    root.querySelector('#play-status').textContent=this.seeking?'⟳ JUMPING':m.status==='playing'?'● PLAYING':m.status==='paused'?'Ⅱ PAUSED':m.status.toUpperCase();
    const fill=root.querySelector('#fill'); fill.style.transition=this.drag?'none':''; fill.style.width=pct+'%';
    const wrap=root.querySelector('.track-wrap');
    wrap.classList.toggle('scrubbable',this.canScrub(m,p)||!!this.drag);
    wrap.title=/plex/i.test(m.source)?'Drag to jump to a time':'Scrubbing works for Plex playback';
    wrap.setAttribute('aria-valuenow',String(Math.round(pct)));
    root.querySelector('#thumb').style.left=pct+'%';
    const tip=root.querySelector('#tip'); tip.style.left=pct+'%'; tip.textContent=this.time(shown);
  }
  static css=`
    :host{display:block;container-type:inline-size}*{box-sizing:border-box}
    ha-card{display:block;background:linear-gradient(145deg,#0b0d1b,#140c22 55%,#07121d);border:1px solid #915bff88;border-radius:10px;color:#f4f1ff;box-shadow:0 0 26px #6940ff26,inset 0 0 25px #5632aa12;overflow:hidden;font-family:var(--primary-font-family,Arial,sans-serif)}
    .frame{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;padding:22px}
    .poster{position:relative;aspect-ratio:2/3;width:100%;max-width:300px;margin:0 auto;background:#05060d;border:1px solid #59a8ff66;border-radius:6px;overflow:hidden;box-shadow:0 12px 32px #0008}
    .poster img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#05060d}.poster img[hidden]{display:none}
    .placeholder{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;background:radial-gradient(ellipse at center,#3e216030,transparent);color:#8f7dad;font-size:10px;letter-spacing:2px}.placeholder ha-icon{width:65px;height:65px;color:#b36dff}
    .poster-tag{position:absolute;left:12px;bottom:12px;background:#080914e8;color:#cbf5ff;border:1px solid #55ddff66;padding:7px 10px;border-radius:4px;font-size:9px;letter-spacing:1.5px;text-transform:uppercase;display:flex;align-items:center;gap:7px}.dot{width:5px;height:5px;border-radius:50%;background:#55ddff;box-shadow:0 0 8px #55ddff}
    .details{min-width:0;display:flex;flex-direction:column}.eyebrow{display:flex;align-items:center;gap:8px;color:#d7d2e7;font-size:10px;font-weight:800;letter-spacing:2px}.eyebrow ha-icon{width:17px;height:17px;color:#b36dff;filter:drop-shadow(0 0 6px #b36dff)}.eyebrow span{height:1px;flex:1;background:linear-gradient(90deg,#b36dff,transparent)}
    h2{font-size:clamp(25px,4cqw,36px);line-height:1.15;font-weight:800;letter-spacing:.4px;margin:20px 0 14px;text-wrap:balance;color:#f4f1ff;text-shadow:0 0 18px #9c6eff30;overflow-wrap:anywhere}
    .chips{display:flex;flex-wrap:wrap;gap:7px}.chips span{border:1px solid #55ddff40;background:#08172780;color:#79def7;font-size:9px;letter-spacing:1px;text-transform:uppercase;border-radius:4px;padding:6px 8px}
    .plot{font-size:13px;line-height:1.75;color:#c6c0d5;margin:22px 0}.empty{color:#8f88a2}
    dl{display:grid;grid-template-columns:1fr;gap:0;margin:0 0 20px}dl>div{display:grid;grid-template-columns:110px 1fr;gap:14px;border-top:1px solid #6950a033;padding:11px 0}dt{color:#9286b0;font-size:9px;line-height:1.6;letter-spacing:1px;text-transform:uppercase}dd{margin:0;font-size:12px;line-height:1.4;color:#e6e0f3;overflow-wrap:anywhere}
    .track-wrap{position:relative;padding:9px 0;outline:none;touch-action:none}.track-wrap.scrubbable{cursor:pointer}.track-wrap.scrubbable:hover .track,.track-wrap.dragging .track{height:8px;margin:-1.5px 0}
    #thumb{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#f4f1ff;border:3px solid #55ddff;box-shadow:0 0 12px #55ddff;opacity:0;transition:opacity .15s;pointer-events:none}
    .track-wrap.scrubbable:hover #thumb,.track-wrap.dragging #thumb,.track-wrap:focus-visible #thumb{opacity:1}
    #tip{position:absolute;bottom:26px;transform:translateX(-50%);background:#0a0b17;border:1px solid #55ddffaa;color:#fff;font-size:12px;font-weight:800;padding:5px 8px;border-radius:6px;white-space:nowrap;pointer-events:none;display:none;box-shadow:0 0 14px #55ddff44}.track-wrap.dragging #tip{display:block}
    .progress-area{margin-top:auto;padding-top:10px}.track{height:5px;background:#323043;border-radius:4px;overflow:hidden;transition:height .15s,margin .15s}#fill{height:100%;background:linear-gradient(90deg,#9b63ff,#55ddff);box-shadow:0 0 14px #55ddff88;border-radius:4px;transition:width 1s linear}.progress-label{display:flex;justify-content:space-between;gap:14px;color:#aaa0bb;font-size:10px;margin:0 0 10px}.progress-label.bottom{margin:10px 0 0;color:#8f88a2;font-size:9px;letter-spacing:.6px}#play-status{color:#55ddff}
    @container(min-width:650px){.frame{grid-template-columns:minmax(220px,.7fr) minmax(0,1.3fr);gap:30px;padding:26px}.poster{max-width:none;align-self:start}dl>div{grid-template-columns:118px 1fr}}
    @container(min-width:1000px){.frame{grid-template-columns:310px minmax(0,1fr)}dl{grid-template-columns:1fr 1fr;column-gap:25px}}
    @media(prefers-reduced-motion:reduce){#fill{transition:none}}
  `;
}
if(!customElements.get('plex-now-playing-card')){
  customElements.define('plex-now-playing-card',PlexNowPlayingCard);
  window.customCards=window.customCards||[];
  window.customCards.push({type:'plex-now-playing-card',name:'Plex Now Playing',description:'Full artwork, synopsis, receiver formats and live playback progress.'});
}