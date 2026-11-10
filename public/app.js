import { RoomCore, freshState, normaliseLesson, DEFAULT_DECKS, PROMPTS, AVATARS, OBJECTIVE, CODE_CHARS, cardIn } from './room-core.js';

let DK = DEFAULT_DECKS; // decks for the current lesson
const cardById = (id) => cardIn(DK, id) || { id, t: '?', e: '❔' };
const BLOBS = new Map();
let CLOCK = 0; // server time minus local time

/* ============================== helpers ============================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mk = (store) => ({
  get(k) { try { return JSON.parse(store().getItem(k)); } catch { return null; } },
  set(k, v) { try { store().setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { store().removeItem(k); } catch {} },
});
const ss = mk(() => sessionStorage);
const lstore = mk(() => localStorage);
const rnd = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
const app = document.getElementById('app');
let MODE = 'live';

const SOFT = ['#FFE3C2', '#D4F5D9', '#D3F1FA', '#E3DBFF', '#FFDDF3', '#FFF4BF', '#D6E6FF', '#FFD9D6'];
const avBg = (av) => SOFT[[...(av || '?')].reduce((a, c) => a + c.codePointAt(0), 0) % SOFT.length];
const hashRot = (id) => ((([...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0)) % 7) - 3) * 0.45;

const VERDICT = {
  yes: { e: '✅', label: 'Works together', cls: 'v-yes' },
  depends: { e: '🤔', label: 'It depends', cls: 'v-dep' },
  no: { e: '⛔', label: 'Doesn’t work together', cls: 'v-no' },
};
const FLASHES = [
  { text: 'Time to listen', e: '👂' },
  { text: 'Eyes on me', e: '👀' },
  { text: 'Hands off the keyboard', e: '🙌' },
  { text: 'Talk to your partner', e: '🗣️' },
  { text: 'Tidy up time', e: '🧺' },
  { text: 'Brilliant work, everyone!', e: '🌟' },
  { text: 'Time’s up!', e: '⏰', hidden: true },
];
const flashEmoji = (t) => (FLASHES.find((f) => f.text === t) || { e: '📣' }).e;
const TYPE_ICON = { cases: '📁', cloud: '☁️', scale: '🎚️', rank: '🔢', sort: '🗂️', draw: '🎨', tap: '👆', quiz: '❓', image: '🖼️', title: '🏁', respond: '💬', poll: '📊', cards: '🃏', deal: '🎴', split: '↔️', task: '⚖️' };
const TYPE_LABEL = { cases: 'Case files', cloud: 'Word cloud', scale: 'Scale', rank: 'Rank it', sort: 'Sort it', draw: 'Draw it', tap: 'Tap the picture', quiz: 'Quiz', image: 'Teaching slide', title: 'Welcome', respond: 'Everyone answers', poll: 'Vote', cards: 'The cards', deal: 'Pair activity', split: 'Sort your answers', task: 'Your task' };

const kindOf = (c) => c.k || (String(c.id)[0] === 'T' ? 'tech' : 'life');
const cardHTML = (c, cls = '') => {
  const k = kindOf(c);
  return `<div class="gcard ${k} ${c.blank ? 'blank' : ''} ${cls}"><span class="gtag">${esc(k === 'life' ? DK.life.name : DK.tech.name)}</span><span class="ge">${c.e}</span><span class="gt">${esc(c.t)}</span></div>`;
};
const chipHTML = (c) => `<span class="chip ${kindOf(c)}">${c.e} ${esc(c.t)}</span>`;
const avHTML = (av, cls = '') => `<span class="av ${cls}" style="--avbg:${avBg(av)}">${av || '🙂'}</span>`;

function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.className = 'show ' + kind;
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(() => (t.className = ''), 2600);
}

let audioCtx = null;
function unlockAudio() {
  try { audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); audioCtx.resume(); } catch {}
}
function chime() {
  if (!audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    [[659.25, 0], [880, 0.16], [1046.5, 0.32]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + d);
      g.gain.exponentialRampToValueAtTime(0.22, now + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + d + 0.7);
      o.connect(g).connect(audioCtx.destination); o.start(now + d); o.stop(now + d + 0.75);
    });
  } catch {}
}

const IS_TOUCH = matchMedia('(hover: none)').matches;
let NOFOCUS = false; // true while drawing the editor's pupil preview
function setTheme(i) { document.body.dataset.theme = String(((i | 0) % 4 + 4) % 4); }
function fullJoinUrl(code) {
  if (MODE === 'live') return location.origin + '/?join=' + code;
  return location.href.split('#')[0].split('?')[0] + '?join=' + code + '#join-' + code;
}
function qrSVG(text) {
  try {
    const q = window.qrcode(0, 'M');
    q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true, alt: 'QR code to join the lesson' });
  } catch { return ''; }
}
const _pre = new Set();
function preloadSlides(slides) {
  for (const x of slides || []) if (x.src && !_pre.has(x.src)) { _pre.add(x.src); const im = new Image(); im.decoding = 'async'; im.src = x.src; }
}

/* keyed region: only re-render when key changes */
function region(el, key, html) {
  if (!el) return false;
  if (el._k === key) return false;
  el._k = key;
  el.innerHTML = html;
  return true;
}

/* ============================== transports ============================== */
function liveLink(code, on) {
  let ws, hello = null, closed = false, retry = 0, pingT;
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?code=' + encodeURIComponent(code);
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  function open() {
    on.status('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 0; on.status('online'); if (hello) send(hello); clearInterval(pingT); pingT = setInterval(() => send({ t: 'ping' }), 20000); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } on.msg(m); };
    ws.onclose = () => { clearInterval(pingT); if (closed) return; on.status('offline'); clearTimeout(open._t); open._t = setTimeout(() => { if (!closed && (!ws || ws.readyState === 3)) open(); }, Math.min(8000, 600 * 2 ** retry++)); };
  }
  open();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (!ws || ws.readyState === 3) { retry = 0; open(); }
    else if (ws.readyState === 1) send({ t: 'ping' });
  });
  return { send, hello(o, now = true) { hello = o; if (now) send(o); }, close() { closed = true; try { ws.close(); } catch {} } };
}

function localHostLink(code, key, on, saved, lesson) {
  const bc = new BroadcastChannel('lvt-' + code);
  const seen = new Map();
  const sinks = new Map();
  const core = new RoomCore({
    send: (cid, msg) => {
      if (cid === 'host') on.msg(msg);
      else if (sinks.has(cid)) sinks.get(cid)(msg);
      else bc.postMessage({ to: cid, msg });
    },
    persist: (st) => { if (st.ended) lstore.del('lvt-demo-' + code); else lstore.set('lvt-demo-' + code, st); },
  });
  core.load(saved || freshState(code, key, lesson));
  bc.onmessage = (ev) => {
    const d = ev.data;
    if (!d || !d.from) return;
    if (d.type === 'close') { seen.delete(d.from); core.disconnect(d.from); return; }
    if (!core.clients.has(d.from)) { core.connect(d.from); bc.postMessage({ to: d.from, msg: { t: 'rehello' } }); }
    seen.set(d.from, Date.now());
    if (d.type === 'msg') core.message(d.from, d.msg);
  };
  const hb = setInterval(() => {
    const now = Date.now();
    for (const [cid, t] of seen) if (now - t > 9000) { seen.delete(cid); core.disconnect(cid); }
  }, 3000);
  core.connect('host');
  setTimeout(() => on.status('online'));
  return { core, sinks, send(o) { core.message('host', o); }, hello(o) { core.message('host', o); }, close() { clearInterval(hb); bc.close(); } };
}

function localPupilLink(code, on) {
  const bc = new BroadcastChannel('lvt-' + code);
  const cid = 'p' + rnd(10);
  let hello = null, got = false;
  const post = (type, msg) => { try { bc.postMessage({ from: cid, type, msg }); } catch {} };
  bc.onmessage = (ev) => {
    const d = ev.data;
    if (!d || d.to !== cid) return;
    if (!got) { got = true; on.status('online'); }
    if (d.msg && d.msg.t === 'rehello') { if (hello) post('msg', hello); return; }
    on.msg(d.msg);
  };
  on.status('connecting');
  post('open');
  const t = setInterval(() => { post('msg', { t: 'ping' }); if (!got && hello) post('msg', hello); }, 2500);
  setTimeout(() => { if (!got) on.msg({ t: 'error', e: 'nohost' }); }, 3000);
  addEventListener('pagehide', () => post('close'));
  return { send(o) { post('msg', o); }, hello(o, now = true) { hello = o; if (now) post('msg', o); }, close() { clearInterval(t); post('close'); bc.close(); } };
}

/* ============================== home ============================== */
function showHome(msg = '') {
  document.body.className = 'home-mode';
  setTheme(0);
  const resume = ss.get('lvt-teacher');
  app.innerHTML = `
  <div class="home">
    <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
    <div class="home-inner">
      <div class="hero-cards" aria-hidden="true">
        ${cardHTML(DEFAULT_DECKS.life.cards[8], 'tilt-l')}
        <div class="vs">vs</div>
        ${cardHTML(DEFAULT_DECKS.tech.cards[2], 'tilt-r')}
      </div>
      <h1 class="home-title">Interactive <span>✦</span> Lessons</h1>
      <p class="home-sub">Join your class to answer, vote, sort, draw and play together.</p>
      ${msg ? `<p class="home-msg">${esc(msg)}</p>` : ''}
      <div class="home-btns">
        <button class="hbtn pupil" id="goPupil"><span class="hb-e">🧑‍🤝‍🧑</span><span><b>We’re pupils</b><small>Join with a room code</small></span></button>
        <button class="hbtn teacher" id="goTeacher"><span class="hb-e">🧑‍🏫</span><span><b>I’m the teacher</b><small>Plan and run lessons</small></span></button>
      </div>
      ${resume && resume.mode === MODE ? `<button class="linkbtn" id="resume">↩ Go back to lesson <b>${esc(resume.code)}</b></button>` : ''}
      ${MODE === 'local' ? `<div class="demo-note"><b>Demo mode.</b> Everything runs inside this browser. Start a lesson as the teacher, then use <i>Open a pupil tab</i> or <i>Add 16 demo pairs</i> to try it out. Put it on Cloudflare for real laptops.</div>` : ''}
    </div>
  </div>`;
  $('#goPupil').onclick = () => showJoin();
  $('#goTeacher').onclick = () => teacherEnter();
  const r = $('#resume');
  if (r) r.onclick = () => {
    if (MODE === 'local') {
      const saved = lstore.get('lvt-demo-' + resume.code);
      if (!saved) { ss.del('lvt-teacher'); return showHome('That demo lesson has finished.'); }
      startTeacher({ code: resume.code, key: resume.key, saved });
    } else startTeacher(resume);
  };
}

async function loadLessonIndex() {
  if (window.LVT_LESSONS) return window.LVT_LESSONS.index;
  try { const r = await fetch('lessons/index.json', { cache: 'no-store' }); return await r.json(); } catch { return []; }
}
async function loadLesson(id) {
  let raw;
  if (window.LVT_LESSONS) raw = window.LVT_LESSONS.lessons[id];
  else { const r = await fetch('lessons/' + id + '/lesson.json', { cache: 'no-store' }); raw = await r.json(); }
  return normaliseLesson(raw, 'lessons/' + id + '/');
}

async function showTeacherGate() {
  const live = MODE === 'live';
  const m = modal(`
    <h2>Start a lesson</h2>
    <p class="muted">Choose a lesson${live ? ' and enter the teacher code. The code isn’t saved on this device.' : '.'}</p>
    <div class="lpick" id="lpick"><div class="spinner"></div></div>
    ${live ? '<input id="tcodeIn" type="password" class="tin" placeholder="Teacher code" autocomplete="off">' : ''}
    <p class="err" id="gerr"></p>
    <div class="mrow"><button class="ghost" data-close>Cancel</button><button class="primary" id="gstart" disabled>Start lesson ➜</button></div>`, 'wide');
  const list = await loadLessonIndex();
  let chosen = list[0] && list[0].id;
  const lp = $('#lpick', m);
  if (!lp) return;
  lp.innerHTML = list.length ? list.map((l) => `<button class="lcard ${l.id === chosen ? 'on' : ''}" data-id="${esc(l.id)}">${l.cover ? `<img src="lessons/${esc(l.cover)}" alt="">` : '<span class="lc-e">📘</span>'}<span class="lc-t"><b>${esc(l.title)}</b><small>${esc(l.subject || '')}</small></span></button>`).join('') : '<p class="err">No lessons found.</p>';
  $$('.lcard', lp).forEach((b) => (b.onclick = () => { chosen = b.dataset.id; $$('.lcard', lp).forEach((x) => x.classList.toggle('on', x === b)); }));
  $('#gstart', m).disabled = !chosen;
  const go = async () => {
    if (!chosen) return;
    $('#gstart', m).disabled = true;
    if (!live) {
      try { const lesson = await loadLesson(chosen); closeModal(); startDemoTeacher(lesson); }
      catch { $('#gerr', m).textContent = 'That lesson could not be loaded.'; $('#gstart', m).disabled = false; }
      return;
    }
    const teacherCode = $('#tcodeIn', m).value;
    try {
      const r = await fetch('/api/create', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teacherCode, lessonId: chosen }) });
      const j = await r.json();
      if (!r.ok) { $('#gerr', m).textContent = j.error === 'badcode' ? 'That teacher code isn’t right.' : j.error === 'nolesson' ? 'That lesson could not be found.' : 'Could not start a room. Try again.'; $('#gstart', m).disabled = false; return; }
      closeModal();
      startTeacher({ code: j.code, key: j.key });
    } catch { $('#gerr', m).textContent = 'No connection to the server.'; $('#gstart', m).disabled = false; }
  };
  $('#gstart', m).onclick = go;
  const ti = $('#tcodeIn', m);
  if (ti) { ti.onkeydown = (e) => { if (e.key === 'Enter') go(); }; if (!IS_TOUCH) setTimeout(() => ti.focus(), 50); }
}

function startDemoTeacher(lesson) {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  startTeacher({ code, key: rnd(16), lesson });
}

let modalEl = null;
function modal(html, cls = '') {
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'modal-back';
  modalEl.innerHTML = `<div class="modal ${cls}">${html}</div>`;
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl || e.target.closest('[data-close]')) closeModal(); });
  document.body.appendChild(modalEl);
  return modalEl;
}
function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

/* ============================== pupil ============================== */
const P = { link: null, view: null, me: null, code: null, mountKey: null, upd: null, lastFlash: null, dealSel: null, taskSel: null };

function showJoin(prefill = '', err = '') {
  document.body.className = 'join-mode';
  setTheme(2);
  const saved = ss.get('lvt-pupil');
  let av = (saved && saved.av) || AVATARS[Math.floor(Math.random() * AVATARS.length)];
  app.innerHTML = `
  <div class="home">
    <div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>
    <div class="join-card">
      <button class="back" id="jback">← Back</button>
      <h1>Join the lesson</h1>
      <label for="jcode">Room code</label>
      <input id="jcode" class="codein" maxlength="4" autocomplete="off" spellcheck="false" placeholder="ABCD" value="${esc(prefill)}">
      <label for="jname">Your first names</label>
      <input id="jname" class="tin" maxlength="32" autocomplete="off" placeholder="e.g. Amy & Leo" value="${esc(saved && saved.code === prefill ? saved.name : '')}">
      <label>Pick your team animal</label>
      <div class="avpick">${AVATARS.map((a) => `<button type="button" data-av="${a}" class="${a === av ? 'on' : ''}" style="--avbg:${avBg(a)}">${a}</button>`).join('')}</div>
      <p class="err" id="jerr">${esc(err)}</p>
      <button class="primary big" id="jgo">Join ➜</button>
    </div>
  </div>`;
  $('#jback').onclick = () => showHome();
  $$('.avpick button').forEach((b) => (b.onclick = () => { av = b.dataset.av; $$('.avpick button').forEach((x) => x.classList.toggle('on', x === b)); }));
  const ci = $('#jcode');
  ci.oninput = () => { ci.value = ci.value.toUpperCase().replace(/[^A-Z]/g, ''); };
  const go = () => {
    const code = ci.value.trim().toUpperCase();
    const name = $('#jname').value.trim();
    if (!/^[A-Z]{4}$/.test(code)) return ($('#jerr').textContent = 'The room code is 4 letters.');
    if (!name) return ($('#jerr').textContent = 'Type your first names.');
    unlockAudio();
    startPupil({ code, name, av, pairId: null });
  };
  $('#jgo').onclick = go;
  $('#jname').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  if (!IS_TOUCH) (prefill ? $('#jname') : ci).focus();
}

function startPupil(me) {
  P.me = me; P.code = me.code; P.mountKey = null; P.view = null; P.lastFlash = null;
  document.body.className = 'pupil-mode';
  app.innerHTML = `
  <div class="p-app">
    <header class="p-top">
      <div class="me">${avHTML(me.av)}<b>${esc(me.name)}</b></div>
      <div class="p-prog" id="pprog"></div>
      <div class="p-help" id="phelp"><button class="lt green" data-v="green" title="I’m fine">●</button><button class="lt amber" data-v="amber" title="I’m not sure">●</button><button class="lt red" data-v="red" title="I’m stuck">●</button><button class="hand" id="phand" title="Ask for help">✋</button></div>
      <div class="p-status"><span class="dot" id="pdot"></span><span class="rm">Room <b>${esc(me.code)}</b></span><span class="score" id="pscore" hidden></span></div>
    </header>
    <div class="tmr p" id="ptimer" hidden></div>
    <main class="p-main" id="pmain"><div class="waiting"><div class="spinner"></div><p>Joining…</p></div></main>
    <div id="pover"></div>
  </div>`;
  const on = {
    status: (st) => { const d = $('#pdot'); if (d) d.className = 'dot ' + st; },
    msg: (m) => onPupilMsg(m),
  };
  P.link = MODE === 'live' ? liveLink(me.code, on) : localPupilLink(me.code, on);
  $$('#phelp .lt').forEach((b) => (b.onclick = () => { const cur = P.view && P.view.me && P.view.me.light; P.link.send({ t: 'act', a: 'light', v: cur === b.dataset.v ? null : b.dataset.v }); }));
  $('#phand').onclick = () => { const on = !(P.view && P.view.me && P.view.me.help); P.link.send({ t: 'act', a: 'help', on }); if (on) toast('Your teacher can see your hand is up ✋', 'good'); };
  P.link.hello({ t: 'hello', role: 'pupil', pairId: me.pairId, name: me.name, av: me.av });
}

function onPupilMsg(m) {
  if (m.t === 'welcome') {
    P.me.pairId = m.pairId; P.me.name = m.name; P.me.av = m.av;
    ss.set('lvt-pupil', P.me);
    P.link.hello({ t: 'hello', role: 'pupil', pairId: m.pairId, name: m.name, av: m.av }, false);
    const nm = $('.p-top .me');
    if (nm) nm.innerHTML = `${avHTML(m.av)}<b>${esc(m.name)}</b>`;
    return;
  }
  if (m.t === 'blob') { BLOBS.set(m.id, m.data); if (P.view) renderPupil(true); return; }
  if (m.t === 'state') { if (m.now) CLOCK = m.now - Date.now(); P.view = m.s; if (m.s.decks) DK = m.s.decks; renderPupil(); return; }
  if (m.t === 'error') {
    if (m.e === 'nohost') {
      if (!P.view) $('#pmain').innerHTML = `<div class="waiting"><div class="spinner"></div><p>Looking for room <b>${esc(P.code)}</b>…</p><small>${MODE === 'local' ? 'Demo mode: the teacher tab must be open in this same browser.' : ''}</small></div>`;
      return;
    }
    const msgs = { noroom: `We couldn’t find room ${P.code}. Check the code with your teacher.`, ended: 'That lesson has finished.', full: 'This room is full.', removed: 'Your teacher took you out of the room. You can join again.', noname: 'Type your first names.' };
    const code = P.code;
    P.link && P.link.close();
    P.link = null;
    if (m.e === 'ended') { ss.del('lvt-pupil'); return showEnded(); }
    if (m.e !== 'noname') ss.del('lvt-pupil');
    showJoin(m.e === 'noroom' ? '' : code, msgs[m.e] || 'Something went wrong. Try again.');
  }
}

function showEnded() {
  document.body.className = 'join-mode';
  app.innerHTML = `<div class="home"><div class="blob b1"></div><div class="blob b2"></div><div class="join-card center"><div class="big-e">🎉</div><h1>Lesson finished</h1><p class="muted">Thank you for joining in. You can close this page.</p><button class="ghost" id="ehome">Back to start</button></div></div>`;
  $('#ehome').onclick = () => showHome();
}

function renderPupil() {
  const v = P.view;
  if (!v) return;
  if (v.ended) { P.link && P.link.close(); ss.del('lvt-pupil'); return showEnded(); }
  const sl = v.cur;
  setTheme(v.slide);
  const meNow = v.me || {};
  $$('#phelp .lt').forEach((b) => b.classList.toggle('on', meNow.light === b.dataset.v));
  const ph = $('#phand'); if (ph) ph.classList.toggle('on', !!meNow.help);
  const sc = $('#pscore'); if (sc) { sc.hidden = !v.hasQuiz; sc.textContent = '⭐ ' + (v.score || 0); }
  paintTimer($('#ptimer'), v.timer);
  preloadSlides(v.slides);
  $('#pprog').innerHTML = `<span class="kind">${TYPE_ICON[sl.type] || '•'} ${TYPE_LABEL[sl.type] || ''}</span><span class="pbar"><i style="width:${Math.round(((v.slide + 1) / v.slides.length) * 100)}%"></i></span><span class="pn">${v.slide + 1} / ${v.slides.length}</span>`;
  const key = sl.id + '|' + sl.type + '|' + sl.title;
  if (key !== P.mountKey) {
    P.mountKey = key;
    const main = $('#pmain');
    main.innerHTML = '';
    main.scrollTop = 0;
    P.upd = PUPIL_MOUNT[sl.type] ? PUPIL_MOUNT[sl.type](main, sl) : PUPIL_MOUNT.title(main, sl);
  }
  P.upd && P.upd(v);
  renderPupilOverlay(v);
}

function renderPupilOverlay(v) {
  const ov = $('#pover');
  let key = 'none', html = '';
  if (v.flash) {
    key = 'flash' + v.flash.id;
    html = `<div class="ov flash"><div class="rings"><i></i><i></i><i></i></div><div class="fl-in"><div class="fe">${flashEmoji(v.flash.text)}</div><h1>${esc(v.flash.text)}</h1><p>Your teacher has paused the screens</p></div></div>`;
  } else if (v.spot) {
    key = 'spot' + JSON.stringify(v.spot) + BLOBS.size;
    html = `<div class="ov spot"><div class="spot-card"><div class="spot-head"><span class="star">🌟</span> Look at this work from ${avHTML(v.spot.pair.av)} <b>${esc(v.spot.pair.name)}</b></div><div class="spot-body">${renderWork(v.spot, v.cur)}</div></div></div>`;
  } else if (v.frozen) {
    key = 'frozen';
    html = `<div class="ov freeze"><div class="orb"><span>⏸</span></div><h1>Screens paused</h1><p>Eyes on your teacher</p></div>`;
  }
  if (v.flash && v.flash.id !== P.lastFlash) {
    P.lastFlash = v.flash.id;
    if (v.chime) chime();
  }
  if (!v.flash) P.lastFlash = null;
  if (ov._k !== key) {
    ov._k = key; ov.innerHTML = html;
    document.body.classList.toggle('locked', key !== 'none');
    if (key !== 'none' && document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}

const questionHead = (sl, extra = '') => `
  <section class="qhead">
    <div class="qkind">${TYPE_ICON[sl.type] || ''} ${TYPE_LABEL[sl.type] || ''}</div>
    <h1>${esc(sl.title)}</h1>
    ${sl.hint ? `<p class="hint">${esc(sl.hint)}</p>` : ''}
    ${sl.sub ? `<p class="hint">${esc(sl.sub)}</p>` : ''}
    ${extra}
  </section>`;

const PUPIL_MOUNT = {
  title(main, sl) {
    main.innerHTML = `
      <div class="p-hero">
        ${sl.src ? `<div class="imgframe"><img src="${esc(sl.src)}" alt="${esc(sl.title)}"></div>` : `<h1>${esc(sl.title)}</h1>`}
        ${sl.sub ? `<p class="obj">${esc(sl.sub)}</p>` : ''}
        <p class="wait-note">✅ You’re in! Your teacher will start soon.</p>
      </div>`;
    return null;
  },
  image(main, sl) {
    main.innerHTML = `<div class="p-image"><div class="imgframe"><img src="${esc(sl.src)}" alt="${esc(sl.title)}"></div><p class="look-note">👀 Look and listen</p></div>`;
    return null;
  },
  cards(main, sl) {
    main.innerHTML = `${questionHead(sl)}
      <h3 class="sec life-h">🟢 ${esc(DK.life.name)} cards</h3><div class="deck">${DK.life.cards.map((c) => cardHTML(c)).join('')}</div>
      <h3 class="sec tech-h">⚫ ${esc(DK.tech.name)} cards</h3><div class="deck">${DK.tech.cards.map((c) => cardHTML(c)).join('')}</div>`;
    return null;
  },
  respond(main, sl) { return mountRespond(main, sl, false); },
  split(main, sl) { return mountRespond(main, sl, true); },
  poll(main, sl) {
    main.innerHTML = `${questionHead(sl)}<div class="opts">${sl.options.map((o, i) => `<button class="opt" data-i="${i}"><span class="fill"></span><span class="ol">${String.fromCharCode(65 + i)}</span><span class="ot">${esc(o)}</span><span class="oc"></span></button>`).join('')}</div><p class="muted center small-note">You can change your vote.</p>`;
    $$('.opt', main).forEach((b) => (b.onclick = () => P.link.send({ t: 'act', a: 'vote', slideId: sl.id, opt: +b.dataset.i })));
    return (v) => {
      const mine = v.mine ? v.mine.vote : undefined;
      const total = v.counts ? v.counts.reduce((a, b) => a + b, 0) : 0;
      $$('.opt', main).forEach((b, i) => {
        b.classList.toggle('on', mine === i);
        const fill = $('.fill', b); const oc = $('.oc', b);
        if (v.counts) { const pct = total ? Math.round((v.counts[i] / total) * 100) : 0; fill.style.width = pct + '%'; oc.textContent = v.counts[i]; }
        else { fill.style.width = '0'; oc.textContent = mine === i ? '✓' : ''; }
      });
    };
  },
  deal(main, sl) { return mountDeal(main, sl); },
  task(main, sl) { return mountTask(main, sl); },
};

function mountRespond(main, sl, split) {
  let side = 'left';
  main.innerHTML = `${questionHead(sl)}
    ${split ? `<div class="sidepick"><button data-side="left" class="on">✅ ${esc(sl.left)}</button><button data-side="right">⛔ ${esc(sl.right)}</button></div>` : ''}
    <form class="answer" autocomplete="off">
      <textarea maxlength="160" rows="2" placeholder="Talk with your partner, then type your answer…"></textarea>
      <div class="arow"><span class="count">0 / 160</span><button class="primary" type="submit">Send ➤</button></div>
    </form>
    <h3 class="sec">Your answers <small class="mycount"></small></h3>
    <div class="mylist"></div>
    <div class="wallwrap" hidden><h3 class="sec">Everyone’s answers</h3><div class="pwall ${split ? 'two' : ''}"></div></div>`;
  const ta = $('textarea', main);
  const form = $('form', main);
  ta.oninput = () => ($('.count', main).textContent = ta.value.length + ' / 160');
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } };
  form.onsubmit = (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text) return;
    P.link.send({ t: 'act', a: 'respond', slideId: sl.id, text, side });
    ta.value = ''; ta.oninput();
    form.classList.remove('sent'); void form.offsetWidth; form.classList.add('sent');
  };
  $$('.sidepick button', main).forEach((b) => (b.onclick = () => { side = b.dataset.side; $$('.sidepick button', main).forEach((x) => x.classList.toggle('on', x === b)); if (!IS_TOUCH) ta.focus(); }));
  if (!IS_TOUCH && !NOFOCUS) setTimeout(() => ta.focus(), 50);
  return (v) => {
    const mine = (v.mine && v.mine.responses) || [];
    region($('.mylist', main), JSON.stringify(mine), mine.length
      ? mine.map((r) => `<div class="mycard ${r.side || ''}">${split ? `<span class="side">${r.side === 'right' ? '⛔' : '✅'}</span>` : ''}<p>${esc(r.text)}</p><button class="x" data-id="${r.id}" title="Delete">✕</button></div>`).join('')
      : `<p class="muted empty-note">Nothing sent yet.</p>`);
    $$('.mylist .x', main).forEach((b) => (b.onclick = () => P.link.send({ t: 'act', a: 'unrespond', slideId: sl.id, id: b.dataset.id })));
    $('.mycount', main).textContent = mine.length ? `${mine.length} of 6` : '';
    const full = mine.length >= 6;
    ta.disabled = full; ta.placeholder = full ? 'That’s the most you can send. Delete one to add another.' : 'Talk with your partner, then type your answer…';
    const ww = $('.wallwrap', main);
    ww.hidden = !v.wall;
    if (v.wall) {
      const pw = $('.pwall', main);
      if (split) {
        region(pw, JSON.stringify(v.wall), ['left', 'right'].map((s) => `<div class="col"><h4>${s === 'left' ? '✅ ' + esc(sl.left) : '⛔ ' + esc(sl.right)}</h4>${v.wall.filter((r) => r.side === s).map(wallItemP).join('')}</div>`).join(''));
      } else region(pw, JSON.stringify(v.wall), v.wall.map(wallItemP).join(''));
      $$('.pwall .heart[data-id]', main).forEach((b) => (b.onclick = () => P.link.send({ t: 'act', a: 'like', slideId: sl.id, id: b.dataset.id })));
    }
  };
}
const wallItemP = (r) => `<div class="wcard ${r.mine ? 'mine' : ''}" style="--bg:${avBg(r.av || r.id)};--rot:${hashRot(r.id)}deg">${r.mine ? (r.likes ? `<span class="heart own">❤️ ${r.likes}</span>` : '') : `<button class="heart ${r.liked ? 'on' : ''}" data-id="${r.id}">${r.liked ? '❤️' : '🤍'} ${r.likes || ''}</button>`}<p>${esc(r.text)}</p>${r.name ? `<footer>${r.av} ${esc(r.name)}</footer>` : ''}</div>`;

function mountDeal(main, sl) {
  main.innerHTML = `
    <div class="focus"><span class="lbl">Talk about</span><span class="fq"></span></div>
    <div class="dtable"></div>
    <div class="decide" hidden>
      <div class="step"><span class="n">1</span>Can you do these at the same time? Is it okay?</div>
      <div class="verdicts">${Object.entries(VERDICT).map(([k, x]) => `<button class="vbtn ${x.cls}" data-v="${k}"><span>${x.e}</span>${x.label}</button>`).join('')}</div>
      <div class="step"><span class="n">2</span>Which one is more important?</div>
      <div class="imps"><button data-i="life" class="imp life">🟢 The ${esc(DK.life.name.toLowerCase())} card</button><button data-i="tech" class="imp tech">⚫ The ${esc(DK.tech.name.toLowerCase())} card</button><button data-i="same" class="imp same">⚖️ Both the same</button></div>
      <div class="step"><span class="n">3</span>Why? Explain your thinking.</div>
      <textarea class="why" maxlength="200" rows="2" placeholder="Because…"></textarea>
      <div class="arow"><button class="ghost blankbtn" type="button">✏️ Use a blank card</button><button class="primary add" disabled>Add to our board ➜</button></div>
      <div class="blankform" hidden>
        <select class="bk"><option value="life">Life card</option><option value="tech">Tech card</option></select>
        <input class="bt tin" maxlength="40" placeholder="Write your own activity">
        <button class="primary bgo" type="button">Use it</button>
      </div>
    </div>
    <h3 class="sec">Our board <small class="bcount"></small></h3>
    <div class="board"></div>`;
  let sel = { v: null, i: null, curId: null };
  const dec = $('.decide', main);
  const why = $('.why', dec);
  const addBtn = $('.add', dec);
  const refresh = () => {
    $$('.vbtn', dec).forEach((b) => b.classList.toggle('on', b.dataset.v === sel.v));
    $$('.imp', dec).forEach((b) => b.classList.toggle('on', b.dataset.i === sel.i));
    const ok = sel.v && why.value.trim().length >= 4;
    addBtn.disabled = !ok;
    addBtn.title = ok ? '' : 'Choose an answer and explain why';
  };
  $$('.vbtn', dec).forEach((b) => (b.onclick = () => { sel.v = b.dataset.v; refresh(); }));
  $$('.imp', dec).forEach((b) => (b.onclick = () => { sel.i = b.dataset.i; refresh(); }));
  why.oninput = refresh;
  addBtn.onclick = () => {
    P.link.send({ t: 'act', a: 'decide', verdict: sel.v, important: sel.i, why: why.value.trim() });
    toast('Added to your board ✨', 'good');
  };
  $('.blankbtn', dec).onclick = () => { const f = $('.blankform', dec); f.hidden = !f.hidden; if (!f.hidden) $('.bt', f).focus(); };
  $('.bgo', dec).onclick = () => {
    const t = $('.bt', dec).value.trim();
    if (!t) return;
    P.link.send({ t: 'act', a: 'blank', k: $('.bk', dec).value, text: t });
    $('.bt', dec).value = ''; $('.blankform', dec).hidden = true;
  };
  return (v) => {
    $('.fq', main).textContent = PROMPTS[v.focusQ] || PROMPTS[0];
    const d = v.mine && v.mine.deal;
    const cur = d && d.cur;
    const table = $('.dtable', main);
    if (!cur) {
      region(table, 'deck' + v.dealMode, `
        <div class="piles">
          <div class="pile life"><i></i><i></i><i></i><span>Life</span></div>
          <div class="pile tech"><i></i><i></i><i></i><span>Tech</span></div>
        </div>
        <button class="primary huge dealbtn">🎴 Deal ${v.dealMode === 3 ? 'three' : 'two'} cards</button>
        ${v.dealMode === 3 ? '<p class="muted center">Challenge mode: you get three cards this time.</p>' : ''}`);
      const db = $('.dealbtn', table);
      if (db) db.onclick = () => P.link.send({ t: 'act', a: 'deal' });
      dec.hidden = true;
      sel = { v: null, i: null, curId: null };
    } else {
      if (region(table, 'cur' + cur.id, `<div class="dealt">${cur.cards.map((c, i) => (i ? '<span class="plus">+</span>' : '') + cardHTML(c, 'flip')).join('')}</div>`)) {
        $$('.flip', table).forEach((el, i) => (el.style.animationDelay = i * 0.18 + 's'));
      }
      dec.hidden = false;
      if (sel.curId !== cur.id) { sel = { v: null, i: null, curId: cur.id }; why.value = ''; refresh(); }
    }
    const board = (d && d.board) || [];
    $('.bcount', main).textContent = board.length ? `${board.length} decided` : '';
    region($('.board', main), JSON.stringify(board), boardHTML(board, true));
    $$('.board .x', main).forEach((b) => (b.onclick = () => P.link.send({ t: 'act', a: 'unboard', id: b.dataset.id })));
  };
}

function boardHTML(board, editable) {
  return `<div class="lanes">${Object.entries(VERDICT).map(([k, x]) => `
    <div class="lane ${x.cls}"><h4>${x.e} ${x.label}</h4>
      ${board.filter((b) => b.verdict === k).map((b) => `
        <div class="bitem">
          <div class="bcards">${b.cards.map((c) => `<span class="mini ${kindOf(c)} ${b.important && (b.important === kindOf(c) || b.important === 'same') ? 'star' : ''}">${c.e} ${esc(c.t)}</span>`).join('')}</div>
          ${b.why ? `<p>${esc(b.why)}</p>` : ''}
          ${editable ? `<button class="x" data-id="${b.id}" title="Remove">✕</button>` : ''}
        </div>`).join('') || '<div class="lane-empty">—</div>'}
    </div>`).join('')}</div>`;
}

function mountTask(main, sl) {
  const panel = (side) => `
    <div class="tpanel ${side}" data-side="${side}">
      <h2>${side === 'pos' ? '👍 Fit together well' : '👎 Work against each other'}</h2>
      <p class="muted">${side === 'pos' ? `A ${esc(DK.life.name.toLowerCase())} card and a ${esc(DK.tech.name.toLowerCase())} card that can go together in a good way.` : `A ${esc(DK.life.name.toLowerCase())} card and a ${esc(DK.tech.name.toLowerCase())} card that are a bad mix.`}</p>
      <div class="pick-lbl">Life card</div>
      <div class="picker" data-k="life">${DK.life.cards.map((c) => `<button data-id="${c.id}" class="pchip life">${c.e} ${esc(c.t)}</button>`).join('')}</div>
      <div class="pick-lbl">Tech card</div>
      <div class="picker" data-k="tech">${DK.tech.cards.map((c) => `<button data-id="${c.id}" class="pchip tech">${c.e} ${esc(c.t)}</button>`).join('')}</div>
      <div class="pick-lbl">Why?</div>
      <textarea maxlength="240" rows="3" placeholder="${side === 'pos' ? 'They work well together because…' : 'They work against each other because…'}"></textarea>
      <div class="arow"><span class="saved"></span><button class="primary save">Save</button></div>
    </div>`;
  main.innerHTML = `${questionHead(sl)}<div class="task">${panel('pos')}${panel('neg')}</div>`;
  const sel = { pos: { life: null, tech: null, dirty: false }, neg: { life: null, tech: null, dirty: false } };
  $$('.tpanel', main).forEach((pn) => {
    const side = pn.dataset.side;
    const ta = $('textarea', pn);
    const paint = () => {
      $$('.picker', pn).forEach((pk) => $$('button', pk).forEach((b) => b.classList.toggle('on', b.dataset.id === sel[side][pk.dataset.k])));
      $('.save', pn).disabled = !(sel[side].life && sel[side].tech && ta.value.trim().length >= 4);
    };
    pn._paint = paint;
    $$('.picker', pn).forEach((pk) => $$('button', pk).forEach((b) => (b.onclick = () => { sel[side][pk.dataset.k] = b.dataset.id; sel[side].dirty = true; paint(); })));
    ta.oninput = () => { sel[side].dirty = true; paint(); };
    $('.save', pn).onclick = () => {
      P.link.send({ t: 'act', a: 'task', side, life: sel[side].life, tech: sel[side].tech, why: ta.value.trim() });
      sel[side].dirty = false;
      toast('Saved ✓', 'good');
    };
    paint();
  });
  return (v) => {
    const t = (v.mine && v.mine.task) || {};
    $$('.tpanel', main).forEach((pn) => {
      const side = pn.dataset.side;
      const saved = t[side];
      if (saved && !sel[side].dirty) {
        sel[side].life = saved.life; sel[side].tech = saved.tech;
        $('textarea', pn).value = saved.why;
      }
      $('.saved', pn).textContent = saved ? (sel[side].dirty ? 'Not saved yet' : '✓ Saved') : '';
      $('.saved', pn).className = 'saved ' + (saved && !sel[side].dirty ? 'ok' : '');
      pn._paint();
    });
  };
}

/* shared: render one pair's work for spotlight */
function renderWorkBase(w, sl) {
  if (!w) return '<p class="muted center">Nothing yet.</p>';
  const empty = (t) => `<div class="empty-work">${t}</div>`;
  switch (sl.type) {
    case 'respond':
    case 'split':
      return w.responses.length
        ? `<div class="sgrid">${w.responses.map((r) => `<div class="scard" style="--bg:${avBg(w.pair.av)}">${sl.type === 'split' ? `<span class="side">${r.side === 'right' ? '⛔ ' + esc(sl.right) : '✅ ' + esc(sl.left)}</span>` : ''}<p>${esc(r.text)}</p></div>`).join('')}</div>`
        : empty('No answers yet.');
    case 'poll':
      return `<div class="opts static">${sl.options.map((o, i) => `<div class="opt ${w.vote === i ? 'on' : ''}"><span class="ol">${String.fromCharCode(65 + i)}</span><span class="ot">${esc(o)}</span><span class="oc">${w.vote === i ? '✓' : ''}</span></div>`).join('')}</div>`;
    case 'deal': {
      const d = w.deal || { cur: null, board: [] };
      return `${d.cur ? `<div class="sp-sub">Cards on the table now</div><div class="dealt small">${d.cur.cards.map((c, i) => (i ? '<span class="plus">+</span>' : '') + cardHTML(c)).join('')}</div>` : ''}
        <div class="sp-sub">Their board</div>${d.board.length ? boardHTML(d.board, false) : empty('No decisions yet.')}`;
    }
    case 'task': {
      const t = w.task || {};
      const one = (side) => {
        const x = t[side];
        return `<div class="tshow ${side}"><h3>${side === 'pos' ? '👍 Fit together well' : '👎 Work against each other'}</h3>${x ? `<div class="tcards">${cardHTML(cardById(x.life))}<span class="plus">+</span>${cardHTML(cardById(x.tech))}</div><p class="twhy">${esc(x.why)}</p>` : empty('Not done yet.')}</div>`;
      };
      return `<div class="tshow-wrap">${one('pos')}${one('neg')}</div>`;
    }
    default:
      return w.deal && w.deal.board.length ? `<div class="sp-sub">Their card board</div>${boardHTML(w.deal.board, false)}` : empty('Nothing to show on this slide.');
  }
}

/* ============================== teacher ============================== */
const T = { link: null, s: null, code: null, key: null, mountKey: null, upd: null, present: false, matrixSel: null, endArm: false, bots: null };

function startTeacher({ code, key, saved, lesson }) {
  T.code = code; T.key = key; T.mountKey = null; T.s = null;
  ss.set('lvt-teacher', { code, key, mode: MODE });
  document.body.className = 'teacher-mode';
  app.innerHTML = `
  <div class="t-app" id="tapp">
    <header class="t-top">
      <button class="tbtn icon railbtn" id="railbtn" title="Slides">☰</button>
      <div class="brand"><span class="dot" id="tdot"></span><span class="brand-t">Live Lessons</span></div>
      <button class="codepill" id="codepill" title="Show joining instructions">Room <b>${esc(code)}</b></button>
      <div class="tnav"><button class="nbtn" id="prev" title="Previous (←)">◀</button><span id="slideno"></span><button class="nbtn" id="next" title="Next (→)">▶</button></div>
      <div class="spacer"></div>
      <button class="tbtn" id="reveal" title="Let pupils see everyone’s answers on their laptops">👁<span class="lb"> Answers on laptops</span></button>
      <button class="tbtn freeze" id="freeze" title="Freeze laptops (F)">❄️<span class="lb"> Freeze</span></button>
      <div class="splitbtn"><button class="tbtn flash" id="flash" title="Flash a message and freeze (L)">📣<span class="lb"> Time to listen</span></button><button class="tbtn flash caret" id="flashmenu" title="More messages">▾</button></div>
      <button class="tbtn timerbtn" id="timerbtn" title="Timer">⏱<span class="lb"> Timer</span></button>
      <button class="tbtn icon" id="more" title="More">⋯</button>
    </header>
    <aside class="t-rail" id="rail"></aside>
    <div class="rail-scrim" id="rscrim"></div>
    <main class="t-stage" id="stage"></main>
    <footer class="t-roster" id="roster"></footer>
    <div class="frozen-badge" id="fbadge" hidden></div>
    <button class="tmr t" id="ttimer" hidden title="Timer controls"></button>
    <button class="tsuggest" id="tsuggest" hidden></button>
  </div>`;
  const on = { status: (st) => { const d = $('#tdot'); if (d) d.className = 'dot ' + st; }, msg: onTeacherMsg };
  T.link = MODE === 'live' ? liveLink(code, on) : localHostLink(code, key, on, saved, lesson);
  T.link.hello({ t: 'hello', role: 'teacher', key });
  bindTeacher();
}

const act = (a, extra = {}) => T.link && T.link.send({ t: 'act', a, ...extra });

function onTeacherMsg(m) {
  if (m.t === 'blob') { BLOBS.set(m.id, m.data); if (T.s) { T.blobTick = (T.blobTick || 0) + 1; renderTeacher(); } return; }
  if (m.t === 'state') { if (m.now) CLOCK = m.now - Date.now(); T.s = m.s; if (m.s.decks) DK = m.s.decks; renderTeacher(); return; }
  if (m.t === 'error' && (m.e === 'badkey' || m.e === 'noroom' || m.e === 'ended')) {
    T.link && T.link.close(); T.link = null; ss.del('lvt-teacher');
    showHome(m.e === 'ended' ? 'That lesson has ended.' : 'That lesson is no longer available. Start a new one.');
  }
}

function bindTeacher() {
  $('#prev').onclick = () => act('goto', { i: T.s.slide - 1 });
  $('#next').onclick = () => act('goto', { i: T.s.slide + 1 });
  $('#freeze').onclick = () => act('freeze', { on: !(T.s.frozen || T.s.flash) });
  $('#flash').onclick = () => act('flash', { text: 'Time to listen' });
  $('#reveal').onclick = () => act('reveal', { on: !T.s.reveal });
  $('#codepill').onclick = () => showJoinInfo();
  $('#timerbtn').onclick = (e) => timerMenu(e.currentTarget);
  $('#ttimer').onclick = (e) => timerMenu(e.currentTarget);
  const toggleRail = (on) => $('#tapp').classList.toggle('rail-open', on);
  $('#railbtn').onclick = () => toggleRail(!$('#tapp').classList.contains('rail-open'));
  $('#rscrim').onclick = () => toggleRail(false);
  $('#flashmenu').onclick = (e) => popMenu(e.currentTarget, `
    ${FLASHES.filter((f) => !f.hidden).map((f) => `<button data-f="${esc(f.text)}"><span>${f.e}</span>${esc(f.text)}</button>`).join('')}
    <div class="mcustom"><input class="tin" id="fcustom" maxlength="60" placeholder="Your own message…"><button class="primary" id="fgo">Flash</button></div>`, (menu) => {
    $$('[data-f]', menu).forEach((b) => (b.onclick = () => { act('flash', { text: b.dataset.f }); closeMenu(); }));
    const go = () => { const t = $('#fcustom', menu).value.trim(); if (t) { act('flash', { text: t }); closeMenu(); } };
    $('#fgo', menu).onclick = go;
    $('#fcustom', menu).onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
  $('#more').onclick = (e) => popMenu(e.currentTarget, `
    <button data-m="quick"><span>➕</span>Quick question</button>
    <button data-m="names"><span>🙈</span>${T.s && T.s.hideNames ? 'Show pair names' : 'Hide pair names'}</button>
    <button data-m="chime"><span>🔔</span>Chime with flash: ${T.s && T.s.chime ? 'on' : 'off'}</button>
    <button data-m="clear"><span>🧹</span>Clear answers on this slide</button>
    <button data-m="lights"><span>🚦</span>Reset traffic lights and hands</button>
    <button data-m="present"><span>🖥️</span>${T.present ? 'Show controls' : 'Present mode'}</button>
    ${document.fullscreenEnabled ? '<button data-m="full"><span>⛶</span>Full screen</button>' : ''}
    <hr><button data-m="end" class="danger"><span>⏹</span>End lesson and delete answers</button>`, (menu) => {
    $$('[data-m]', menu).forEach((b) => (b.onclick = () => {
      const k = b.dataset.m; closeMenu();
      if (k === 'quick') quickQuestion();
      if (k === 'names') act('hideNames', { on: !T.s.hideNames });
      if (k === 'chime') act('chime', { on: !T.s.chime });
      if (k === 'lights') act('clearLights');
      if (k === 'clear') confirmBox('Clear all answers on this slide?', 'Clear answers', () => act('clearSlide'));
      if (k === 'present') togglePresent();
      if (k === 'full') { try { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen(); } catch {} }
      if (k === 'end') confirmBox('End the lesson? Pupils will be signed out and all answers deleted.', 'End lesson', () => act('end'), true);
    }));
  });
  document.onkeydown = (e) => {
    if (!T.s || document.body.className.indexOf('teacher-mode') < 0) return;
    if (e.target.closest('input,textarea,select') || modalEl) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); act('goto', { i: T.s.slide + 1 }); }
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); act('goto', { i: T.s.slide - 1 }); }
    if (e.key === 'f' || e.key === 'F') act('freeze', { on: !(T.s.frozen || T.s.flash) });
    if (e.key === 'l' || e.key === 'L') act('flash', { text: 'Time to listen' });
    if (e.key === 'Escape' && T.present) togglePresent();
  };
}

function togglePresent() { T.present = !T.present; $('#tapp').classList.toggle('present', T.present); }

let menuEl = null;
function popMenu(anchor, html, bind) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'popmenu';
  menuEl.innerHTML = html;
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = r.bottom + 8 + 'px';
  menuEl.style.right = Math.max(8, innerWidth - r.right) + 'px';
  bind && bind(menuEl);
  setTimeout(() => document.addEventListener('pointerdown', outside), 0);
}
function outside(e) { if (menuEl && !menuEl.contains(e.target)) closeMenu(); }
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } document.removeEventListener('pointerdown', outside); }

function confirmBox(text, btn, fn, danger) {
  const m = modal(`<h2>${esc(text)}</h2><div class="mrow"><button class="ghost" data-close>Cancel</button><button class="${danger ? 'dangerbtn' : 'primary'}" id="cok">${esc(btn)}</button></div>`);
  $('#cok', m).onclick = () => { closeModal(); fn(); };
}

function joinUrl() { return MODE === 'live' ? location.host : 'this page (demo)'; }

function showJoinInfo() {
  modal(`<div class="joininfo"><div class="ji-grid"><div class="ji-qr">${qrSVG(fullJoinUrl(T.code))}<small>Scan to join</small></div><div><p>Or go to</p><div class="jurl">${esc(joinUrl())}</div><p>choose <b>We’re pupils</b> and type</p><div class="jcode">${T.code.split('').map((c) => `<span>${c}</span>`).join('')}</div></div></div><button class="primary" data-close>Done</button></div>`, 'wide');
}

function quickQuestion() {
  const m = modal(`
    <h2>Quick question</h2>
    <p class="muted">Adds a new slide after this one and sends it to every laptop.</p>
    <input class="tin" id="qq" maxlength="160" placeholder="Type your question…">
    <div class="seg" id="qtype"><button data-t="respond" class="on">💬 Typed answers</button><button data-t="poll">📊 Vote</button><button data-t="cloud">☁️ Word cloud</button><button data-t="scale">🎚️ Scale 1–10</button></div>
    <div id="qopts" hidden><textarea class="tin" id="qo" rows="4" placeholder="One option per line&#10;Yes&#10;No&#10;Not sure"></textarea></div>
    <div class="mrow"><button class="ghost" data-close>Cancel</button><button class="primary" id="qgo">Ask now ➜</button></div>`);
  let type = 'respond';
  $$('#qtype button', m).forEach((b) => (b.onclick = () => { type = b.dataset.t; $$('#qtype button', m).forEach((x) => x.classList.toggle('on', x === b)); $('#qopts', m).hidden = type !== 'poll'; }));
  $('#qgo', m).onclick = () => {
    const title = $('#qq', m).value.trim();
    if (!title) return $('#qq', m).focus();
    act('quickQ', { title, type, options: $('#qo', m).value.split('\n') });
    closeModal();
  };
  setTimeout(() => $('#qq', m).focus(), 50);
}

const pairWork = (s, pid, sl) => ({
  pair: s.pairs[pid],
  drawing: s.drawings && s.drawings[sl.id] && s.drawings[sl.id][pid] ? s.drawings[sl.id][pid].id : null,
  casework: s.cases && s.cases[pid] && s.cases[pid].slide === sl.id ? s.cases[pid] : null,
  responses: (s.responses[sl.id] || []).filter((r) => r.pairId === pid),
  vote: s.polls[sl.id] ? s.polls[sl.id][pid] : undefined,
  deal: s.deals[pid] || null,
  task: s.tasks[pid] || null,
});

function didSlide(s, pid, sl) {
  switch (sl.type) {
    case 'respond': case 'split': case 'cloud': return (s.responses[sl.id] || []).some((r) => r.pairId === pid);
    case 'poll': case 'scale': case 'rank': case 'sort': case 'tap': case 'quiz': return !!(s.polls[sl.id] && s.polls[sl.id][pid] !== undefined);
    case 'draw': return !!(s.drawings[sl.id] && s.drawings[sl.id][pid]);
    case 'cases': { const w = s.cases && s.cases[pid]; return !!(w && w.slide === sl.id && (w.dos.length || w.donts.length)); }
    case 'deal': return !!(s.deals[pid] && s.deals[pid].board.length);
    case 'task': return !!(s.tasks[pid] && (s.tasks[pid].pos || s.tasks[pid].neg));
    default: return false;
  }
}

function renderTeacher() {
  const s = T.s;
  if (!s) return;
  if (s.ended) { T.link && T.link.close(); T.link = null; ss.del('lvt-teacher'); const em = 'Lesson ended. All pupil answers have been deleted.'; return TCODE || MODE === 'local' ? showHub(em) : showHome(em); }
  const sl = s.slides[s.slide];
  setTheme(s.slide);
  preloadSlides(s.slides);
  const bt = $('.brand .brand-t'); if (bt && s.lessonTitle && bt.textContent !== s.lessonTitle) { bt.textContent = s.lessonTitle; bt.title = s.lessonTitle; }
  $('#slideno').textContent = `${s.slide + 1} / ${s.slides.length}`;
  $('#prev').disabled = s.slide === 0;
  $('#next').disabled = s.slide === s.slides.length - 1;
  const locked = s.frozen || s.flash;
  $('#freeze').classList.toggle('on', !!locked);
  $('#freeze').innerHTML = locked ? '▶️<span class="lb"> Unfreeze</span>' : '❄️<span class="lb"> Freeze</span>';
  $('#reveal').classList.toggle('on', s.reveal);
  $('#reveal').hidden = !['respond', 'split', 'poll', 'cloud', 'scale', 'rank', 'sort', 'tap', 'cases'].includes(sl.type);
  const sug = $('#tsuggest');
  const running = s.timer && !s.timer.done;
  sug.hidden = true;
  const tb = $('#timerbtn');
  const suggest = sl.timer && !running;
  const tl = suggest ? `⏱<span class="lb"> ${fmtTime(sl.timer * 1000)} timer</span>` : '⏱<span class="lb"> Timer</span>';
  if (tb.innerHTML !== tl) tb.innerHTML = tl;
  tb.classList.toggle('suggest', !!suggest);
  paintTimer($('#ttimer'), s.timer);
  const fb = $('#fbadge');
  fb.hidden = !locked;
  if (locked) fb.innerHTML = `${s.flash ? `${flashEmoji(s.flash.text)} Laptops showing “${esc(s.flash.text)}”` : '❄️ Laptops frozen'} ${s.timer && s.timer.done ? '<button id="tplus">+30 sec</button>' : ''}<button id="unfz">Unfreeze</button>`;
  const tp = $('#tplus'); if (tp) tp.onclick = () => act('timerAdd', { sec: 30 });
  if (locked) $('#unfz').onclick = () => act('freeze', { on: false });

  // rail
  const online = new Set(s.online);
  region($('#rail'), JSON.stringify([s.slide, s.slides.map((x) => x.id + x.title), MODE, Object.keys(s.pairs).length]), `
    <div class="rail-h">Lesson</div>
    <ol class="slist">${s.slides.map((x, i) => `<li class="${i === s.slide ? 'on' : ''}" data-i="${i}"><span class="si">${TYPE_ICON[x.type]}</span><span class="st">${esc(x.type === 'title' ? x.title : x.title)}</span>${x.quick ? `<button class="x" data-rm="${x.id}" title="Remove">✕</button>` : ''}</li>`).join('')}</ol>
    <button class="ghost wide" id="addq">➕ Quick question</button>
    ${MODE === 'local' ? `<div class="demo-tools"><div class="rail-h">Demo tools</div><a class="ghost wide" href="?join=${esc(T.code)}#join-${esc(T.code)}" target="_blank" rel="noopener">🧑‍💻 Open a pupil tab</a><button class="ghost wide" id="bots">🤖 ${T.bots ? 'Stop demo pairs' : 'Add 16 demo pairs'}</button></div>` : ''}`);
  $$('#rail .slist li').forEach((li) => (li.onclick = (e) => { if (e.target.dataset.rm) return act('removeSlide', { id: e.target.dataset.rm }); act('goto', { i: +li.dataset.i }); $('#tapp').classList.remove('rail-open'); }));
  const onli = $('#rail .slist li.on'); if (onli && $('#rail')._scrolledTo !== s.slide) { $('#rail')._scrolledTo = s.slide; onli.scrollIntoView({ block: 'nearest' }); }
  const aq = $('#addq'); if (aq) aq.onclick = quickQuestion;
  const bb = $('#bots'); if (bb) bb.onclick = () => { T.bots ? stopBots() : startBots(16); $('#rail')._k = null; renderTeacher(); };

  // roster
  const pairs = Object.values(s.pairs).sort((a, b) => a.joined - b.joined);
  const doneN = pairs.filter((p) => didSlide(s, p.id, sl)).length;
  const showDone = ['respond', 'split', 'poll', 'deal', 'task', 'cloud', 'scale', 'rank', 'sort', 'tap', 'quiz', 'draw', 'cases'].includes(sl.type);
  const lights = { green: 0, amber: 0, red: 0 };
  let hands = 0;
  for (const p of pairs) { if (p.light) lights[p.light]++; if (p.help) hands++; }
  region($('#roster'), JSON.stringify([pairs, s.online, showDone && pairs.map((p) => didSlide(s, p.id, sl)), s.spotlight, s.hideNames]), `
    <div class="r-sum"><b>${online.size}</b> of ${pairs.length} pairs online${showDone ? ` · <b>${doneN}</b> taken part` : ''}
      ${lights.green + lights.amber + lights.red || hands ? `<div class="r-lights"><span class="lg-dot green"></span>${lights.green}<span class="lg-dot amber"></span>${lights.amber}<span class="lg-dot red"></span>${lights.red}${hands ? `<span class="r-hands">✋ ${hands}</span>` : ''}</div>` : ''}</div>
    <div class="r-chips">${pairs.length ? pairs.map((p) => `<button class="rchip ${online.has(p.id) ? '' : 'off'} ${showDone && didSlide(s, p.id, sl) ? 'done' : ''} ${s.spotlight === p.id ? 'spot' : ''} ${p.light ? 'lt-' + p.light : ''} ${p.help ? 'hand' : ''}" data-pid="${p.id}" title="Show this pair’s screen">${avHTML(p.av)}<span>${esc(p.name)}</span>${p.help ? '<b class="hb">✋</b>' : ''}<i class="tick">✓</i></button>`).join('') : `<span class="muted">Pairs appear here as they join. Click a pair to show their screen.</span>`}</div>`);
  $$('#roster .rchip').forEach((b) => (b.onclick = () => openSpotlight(b.dataset.pid)));

  // stage
  const key = sl.id + '|' + sl.type + '|' + sl.title;
  if (key !== T.mountKey) {
    T.mountKey = key; T.matrixSel = null;
    const st = $('#stage');
    st.innerHTML = '';
    st.scrollTop = 0;
    T.upd = (TEACHER_MOUNT[sl.type] || TEACHER_MOUNT.title)(st, sl);
  }
  T.upd && T.upd(s, sl);

  if (T.spotOpen) renderSpotlight();
}

const stageHead = (sl, metaId = true) => `
  <div class="st-head">
    <div class="st-kind">${TYPE_ICON[sl.type]} ${TYPE_LABEL[sl.type]}${sl.anon ? ' <span class="anon-b">🕶 Anonymous</span>' : ''}</div>
    <h1>${esc(sl.title)}</h1>
    ${sl.hint ? `<p class="st-hint">${esc(sl.hint)}</p>` : ''}
    ${sl.sub && sl.type !== 'title' ? `<p class="st-hint">${esc(sl.sub)}</p>` : ''}
    ${metaId ? '<div class="st-meta"></div>' : ''}
  </div>`;

function syncWall(box, items, s, opt = {}) {
  box._map ||= new Map();
  const map = box._map;
  const ids = new Set(items.map((r) => r.id));
  for (const [id, el] of map) if (!ids.has(id)) { el.remove(); map.delete(id); }
  if (!items.length && !$('.wall-empty', box)) box.insertAdjacentHTML('beforeend', `<div class="wall-empty">Answers will pop up here as pairs send them…</div>`);
  if (items.length) { const e = $('.wall-empty', box); if (e) e.remove(); }
  for (const r of items) {
    const p = s.pairs[r.pairId] || {};
    let el = map.get(r.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'wcard pop';
      el.style.setProperty('--bg', avBg(p.av || r.id));
      el.style.setProperty('--rot', hashRot(r.id) + 'deg');
      el.innerHTML = `<p>${esc(r.text)}</p><footer></footer><button class="hidebtn" title="Hide or show this answer">🙈</button>`;
      $('.hidebtn', el).onclick = () => act('hideResp', { slideId: s.slides[s.slide].id, id: r.id });
      box.appendChild(el);
      map.set(r.id, el);
      setTimeout(() => el.classList.remove('pop'), 700);
    }
    el.classList.toggle('hidden-card', !!r.hidden);
    const nl = (r.likes || []).length;
    const foot = (s.hideNames || opt.anon ? '' : `${p.av || ''} ${esc(p.name || '')}`) + (nl ? ` <span class="likes">❤️ ${nl}</span>` : '');
    const f = $('footer', el);
    if (f.innerHTML !== foot) f.innerHTML = foot;
  }
  if (opt.byLikes) {
    const sorted = items.slice().sort((a, b) => (b.likes || []).length - (a.likes || []).length || a.at - b.at);
    const order = sorted.map((r) => r.id).join();
    if (box._order !== order) { box._order = order; for (const r of sorted) box.appendChild(map.get(r.id)); }
  }
}

const TEACHER_MOUNT = {
  title(st, sl) {
    st.innerHTML = `
      <div class="t-hero">
        <div class="hero-img">${sl.src ? `<div class="imgframe"><img src="${esc(sl.src)}" alt="${esc(sl.title)}"></div>` : `<h1 class="mega">${esc(sl.title)}</h1>`}
          <p class="obj">${esc(sl.sub || T.s.objective || '')}</p></div>
        <div class="join-card-t">
          <div class="jc-h">Join the lesson</div>
          <div class="jc-qr">${qrSVG(fullJoinUrl(T.code))}</div>
          <div class="jc-or">Scan, or go to <b>${esc(joinUrl())}</b></div>
          <div class="jcode sm">${T.code.split('').map((c) => `<span>${c}</span>`).join('')}</div>
          <div class="jc-count"></div>
        </div>
      </div>
      <div class="joined-cloud"></div>`;
    return (s) => {
      const pairs = Object.values(s.pairs).sort((a, b) => a.joined - b.joined);
      $('.jc-count', st).textContent = pairs.length ? `${pairs.length} pair${pairs.length === 1 ? '' : 's'} joined` : 'Waiting for pairs…';
      region($('.joined-cloud', st), JSON.stringify(pairs.map((p) => p.id + p.name) + s.hideNames), pairs.map((p) => `<span class="jpair">${avHTML(p.av)}${s.hideNames ? '' : esc(p.name)}</span>`).join(''));
    };
  },
  image(st, sl) {
    st.innerHTML = `<div class="t-image"><div class="imgframe"><img src="${esc(sl.src)}" alt="${esc(sl.title)}"></div></div>`;
    return null;
  },
  cards(st, sl) {
    st.innerHTML = `${stageHead(sl, false)}
      <div class="deck-wrap"><h3 class="sec life-h">🟢 ${esc(DK.life.name)} cards</h3><div class="deck big">${DK.life.cards.map((c) => cardHTML(c)).join('')}</div>
      <h3 class="sec tech-h">⚫ ${esc(DK.tech.name)} cards</h3><div class="deck big">${DK.tech.cards.map((c) => cardHTML(c)).join('')}</div></div>`;
    return null;
  },
  respond(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="wall"></div>`;
    const wall = $('.wall', st);
    return (s) => {
      const items = s.responses[sl.id] || [];
      const pairsN = new Set(items.map((r) => r.pairId)).size;
      $('.st-meta', st).innerHTML = `<span class="pillc">💬 ${items.filter((r) => !r.hidden).length} answers</span><span class="pillc">🧑‍🤝‍🧑 ${pairsN} pairs</span>`;
      const vis = items.filter((r) => !r.hidden).length;
      wall.classList.toggle('dense', vis > 12);
      wall.classList.toggle('denser', vis > 28);
      syncWall(wall, items, s, { anon: sl.anon, byLikes: s.reveal });
    };
  },
  split(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="splitwall"><div class="col left"><h2>✅ ${esc(sl.left)}</h2><div class="wall" data-s="left"></div></div><div class="col right"><h2>⛔ ${esc(sl.right)}</h2><div class="wall" data-s="right"></div></div></div>`;
    return (s) => {
      const items = s.responses[sl.id] || [];
      $('.st-meta', st).innerHTML = `<span class="pillc">💬 ${items.filter((r) => !r.hidden).length} answers</span>`;
      syncWall($('[data-s=left]', st), items.filter((r) => r.side !== 'right'), s);
      syncWall($('[data-s=right]', st), items.filter((r) => r.side === 'right'), s);
    };
  },
  poll(st, sl) {
    const many = sl.options.length > 6;
    st.innerHTML = `${stageHead(sl)}<div class="bars ${many ? 'many' : ''}">${sl.options.map((o, i) => `<div class="bar" style="--c:var(--c${i % 8})"><div class="bl">${esc(o)}</div><div class="bt"><div class="bf"></div><span class="bn">0</span></div></div>`).join('')}</div>`;
    return (s) => {
      const votes = Object.values(s.polls[sl.id] || {});
      const counts = sl.options.map((_, i) => votes.filter((v) => v === i).length);
      const max = Math.max(1, ...counts);
      $$('.bar', st).forEach((b, i) => {
        $('.bf', b).style.width = (counts[i] / max) * 100 + '%';
        $('.bn', b).textContent = counts[i];
        b.classList.toggle('top', counts[i] === max && counts[i] > 0);
      });
      $('.st-meta', st).innerHTML = `<span class="pillc">🗳️ ${votes.length} of ${Object.keys(s.pairs).length} pairs voted</span>`;
    };
  },
  deal(st, sl) {
    st.innerHTML = `
      <div class="deal-top">
        <div class="focus big"><span class="lbl">Talk about</span><span class="fq"></span></div>
        <div class="deal-ctrls">
          <div class="ctrl-l">Question for pairs</div>
          <div class="fqchips">${PROMPTS.map((p, i) => `<button data-i="${i}" title="${esc(p)}">${i + 1}</button>`).join('')}</div>
          <div class="ctrl-l">Cards dealt</div>
          <div class="seg" id="dmode"><button data-n="2">2 cards</button><button data-n="3">3 cards · challenge</button></div>
        </div>
      </div>
      <div class="deal-grid">
        <div class="panel"><div class="panel-h"><h3>Class decisions</h3><div class="legend"><span class="lg v-yes">✅ Works</span><span class="lg v-dep">🤔 Depends</span><span class="lg v-no">⛔ Doesn’t</span></div></div><div class="matrix-wrap"></div></div>
        <div class="panel"><div class="panel-h"><h3 class="feed-h">Latest decisions</h3></div><div class="feed"></div></div>
      </div>`;
    $$('.fqchips button', st).forEach((b) => (b.onclick = () => act('focusQ', { i: +b.dataset.i })));
    $$('#dmode button', st).forEach((b) => (b.onclick = () => act('dealMode', { n: +b.dataset.n })));
    return (s) => {
      $('.fq', st).textContent = PROMPTS[s.focusQ];
      $$('.fqchips button', st).forEach((b) => b.classList.toggle('on', +b.dataset.i === s.focusQ));
      $$('#dmode button', st).forEach((b) => b.classList.toggle('on', +b.dataset.n === s.dealMode));
      const all = [];
      for (const [pid, d] of Object.entries(s.deals)) for (const b of d.board) all.push({ ...b, pid });
      all.sort((a, b) => b.at - a.at);
      // matrix
      const cell = {};
      for (const b of all) {
        if (b.hidden) continue;
        const ls = b.cards.filter((c) => kindOf(c) === 'life' && !c.blank);
        const ts = b.cards.filter((c) => kindOf(c) === 'tech' && !c.blank);
        for (const l of ls) for (const t of ts) { const k = l.id + '|' + t.id; (cell[k] ||= { yes: 0, depends: 0, no: 0 })[b.verdict]++; }
      }
      region($('.matrix-wrap', st), JSON.stringify([cell, T.matrixSel]), `
        <table class="matrix"><thead><tr><th></th>${DK.tech.cards.map((t) => `<th title="${esc(t.t)}"><span>${t.e}</span><small>${esc(t.t)}</small></th>`).join('')}</tr></thead>
        <tbody>${DK.life.cards.map((l) => `<tr><th title="${esc(l.t)}"><span>${l.e}</span>${esc(l.t)}</th>${DK.tech.cards.map((t) => {
          const c = cell[l.id + '|' + t.id];
          if (!c) return `<td class="mt-empty"></td>`;
          const n = c.yes + c.depends + c.no;
          const top = c.yes >= c.depends && c.yes >= c.no ? 'v-yes' : c.no >= c.depends ? 'v-no' : 'v-dep';
          const mixed = [c.yes, c.depends, c.no].filter(Boolean).length > 1;
          const sel = T.matrixSel === l.id + '|' + t.id;
          return `<td class="mt ${top} ${mixed ? 'mixed' : ''} ${sel ? 'sel' : ''}" data-k="${l.id}|${t.id}" title="${esc(l.t)} + ${esc(t.t)}: ✅${c.yes} 🤔${c.depends} ⛔${c.no}"><b>${n}</b></td>`;
        }).join('')}</tr>`).join('')}</tbody></table>`);
      $$('.matrix td.mt', st).forEach((td) => (td.onclick = () => { T.matrixSel = T.matrixSel === td.dataset.k ? null : td.dataset.k; renderTeacher(); }));
      // feed
      let list = all;
      if (T.matrixSel) {
        const [L, Tt] = T.matrixSel.split('|');
        list = all.filter((b) => b.cards.some((c) => c.id === L) && b.cards.some((c) => c.id === Tt));
      }
      $('.feed-h', st).innerHTML = T.matrixSel ? `${cardById(T.matrixSel.split('|')[0]).e} + ${cardById(T.matrixSel.split('|')[1]).e} decisions <button class="linkbtn" id="fall">show all</button>` : `Latest decisions <small>${all.length}</small>`;
      const fa = $('#fall', st); if (fa) fa.onclick = () => { T.matrixSel = null; renderTeacher(); };
      region($('.feed', st), JSON.stringify([list.slice(0, 30), s.hideNames]), list.length ? list.slice(0, 30).map((b) => {
        const p = s.pairs[b.pid] || {};
        return `<div class="fitem ${b.hidden ? 'hidden-card' : ''}">
          ${avHTML(p.av)}
          <div class="fbody"><div class="fcards">${b.cards.map(chipHTML).join('<span class="fplus">+</span>')}</div>${b.why ? `<p>“${esc(b.why)}”</p>` : ''}${s.hideNames ? '' : `<small>${esc(p.name || '')}</small>`}</div>
          <span class="vpill ${VERDICT[b.verdict].cls}">${VERDICT[b.verdict].e} ${VERDICT[b.verdict].label}</span>
          <button class="hidebtn" data-pid="${b.pid}" data-id="${b.id}" title="Hide or show">🙈</button>
        </div>`;
      }).join('') : `<div class="wall-empty">Decisions appear here as pairs add cards to their boards…</div>`);
      $$('.feed .hidebtn', st).forEach((b) => (b.onclick = () => act('hideBoard', { pairId: b.dataset.pid, id: b.dataset.id })));
    };
  },
  task(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="taskwall"><div class="col pos"><h2>👍 Fit together well</h2><div class="tlist" data-s="pos"></div></div><div class="col neg"><h2>👎 Work against each other</h2><div class="tlist" data-s="neg"></div></div></div>`;
    return (s) => {
      let n = 0;
      for (const side of ['pos', 'neg']) {
        const items = Object.entries(s.tasks).filter(([, t]) => t[side]).map(([pid, t]) => ({ pid, ...t[side] })).sort((a, b) => a.at - b.at);
        n += items.length;
        region($(`[data-s=${side}]`, st), JSON.stringify([items, s.hideNames]), items.length ? items.map((x) => {
          const p = s.pairs[x.pid] || {};
          return `<div class="titem pop"><div class="tchips">${chipHTML(cardById(x.life))}<span class="fplus">+</span>${chipHTML(cardById(x.tech))}</div><p>${esc(x.why)}</p>${s.hideNames ? '' : `<small>${p.av || ''} ${esc(p.name || '')}</small>`}</div>`;
        }).join('') : `<div class="wall-empty">Waiting for pairs…</div>`);
      }
      $('.st-meta', st).innerHTML = `<span class="pillc">📝 ${n} examples</span>`;
    };
  },
};

/* spotlight */
function openSpotlight(pid) { T.spotOpen = pid; act('spotlight', { pairId: pid }); renderSpotlight(); }
function closeSpotlight() { T.spotOpen = null; act('spotlight', { pairId: null }); closeModal(); }

function renderSpotlight() {
  const s = T.s;
  const pid = T.spotOpen;
  if (!s || !pid || !s.pairs[pid]) { if (T.spotOpen) { T.spotOpen = null; closeModal(); } return; }
  const sl = s.slides[s.slide];
  const p = s.pairs[pid];
  const pairs = Object.values(s.pairs).sort((a, b) => a.joined - b.joined);
  const idx = pairs.findIndex((x) => x.id === pid);
  const online = s.online.includes(pid);
  const key = JSON.stringify([pid, p, pairWork(s, pid, sl), sl.id, s.share, s.spotlight, online, T.kickArm, s.hideNames, T.blobTick, s.quizReveal && s.quizReveal[sl.id]]);
  if (modalEl && modalEl._spot === key) return;
  const html = `
    <div class="spot-top">
      <button class="nbtn" id="sprev" ${idx <= 0 ? 'disabled' : ''}>◀</button>
      <div class="spot-who">${avHTML(p.av, 'lg')}<div><h2>${s.hideNames ? 'A pair' : esc(p.name)}</h2><small><span class="dot ${online ? 'online' : 'offline'}"></span>${online ? 'Online' : 'Offline'} · ${esc(sl.title)}</small></div></div>
      <button class="nbtn" id="snext" ${idx >= pairs.length - 1 ? 'disabled' : ''}>▶</button>
      <div class="spacer"></div>
      <button class="tbtn ${s.share ? 'on' : ''}" id="sshare">${s.share ? '📡 Showing on all laptops' : '📡 Show on all laptops'}</button>
      <button class="tbtn icon" data-close title="Close">✕</button>
    </div>
    <div class="spot-body big">${renderWork(pairWork(s, pid, sl), sl)}</div>
    <div class="spot-foot">${p.help ? '<button class="tbtn helpclr" id="shelp">✋ Asked for help · mark as helped</button>' : ''}${p.light ? `<span class="spot-light lt-${p.light}">${{ green: 'Feeling fine', amber: 'Not sure', red: 'Stuck' }[p.light]}</span>` : ''}<span class="spacer"></span><button class="linkbtn danger" id="skick">${T.kickArm === pid ? 'Click again to remove this pair' : 'Remove this pair from the room'}</button></div>`;
  if (!modalEl || !modalEl._isSpot) {
    modal(html, 'spotmodal');
    modalEl._isSpot = true;
    modalEl.addEventListener('click', (e) => { const me = e.currentTarget; if (e.target === me || e.target.closest('[data-close]')) { T.spotOpen = null; T.kickArm = null; act('spotlight', { pairId: null }); } }, true);
  } else $('.modal', modalEl).innerHTML = html;
  modalEl._spot = key;
  $('#sprev').onclick = () => { T.kickArm = null; openSpotlight(pairs[idx - 1].id); };
  $('#snext').onclick = () => { T.kickArm = null; openSpotlight(pairs[idx + 1].id); };
  $('#sshare').onclick = () => act('share', { on: !s.share });
  const sh = $('#shelp'); if (sh) sh.onclick = () => act('clearHelp', { pairId: pid });
  $('#skick').onclick = () => {
    if (T.kickArm === pid) { T.kickArm = null; act('kick', { pairId: pid }); T.spotOpen = null; closeModal(); return; }
    T.kickArm = pid; modalEl._spot = null; renderSpotlight();
  };
}

/* ============================== timer ============================== */
const srvNow = () => Date.now() + CLOCK;
function fmtTime(ms) {
  const t = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}
function timerLeft(t) {
  if (!t) return 0;
  if (t.done) return 0;
  if (t.paused) return t.left || 0;
  return Math.max(0, t.end - srvNow());
}
function paintTimer(el, t) {
  if (!el) return;
  if (el.id === 'ptimer') document.body.classList.toggle('has-timer', !!t);
  if (!t) { el.hidden = true; el._id = null; return; }
  el.hidden = false;
  if (el._id !== t.id) {
    el._id = t.id;
    el.innerHTML = `<span class="tm-ic">⏱</span><span class="tm-t"></span><span class="tm-bar"><i></i></span>`;
  }
  const left = timerLeft(t);
  const frac = t.dur ? Math.min(1, left / t.dur) : 0;
  $('.tm-t', el).textContent = t.done ? 'Time’s up!' : fmtTime(left) + (t.paused ? ' paused' : '');
  $('.tm-bar i', el).style.width = (frac * 100).toFixed(1) + '%';
  el.classList.toggle('warn', !t.done && (frac < 0.25 || left < 30000));
  el.classList.toggle('last', !t.done && !t.paused && left <= 10000);
  el.classList.toggle('done', !!t.done);
  el.classList.toggle('paused', !!t.paused);
}
setInterval(() => {
  if (P.view && $('#ptimer')) paintTimer($('#ptimer'), P.view.timer);
  if (T.s && $('#ttimer')) paintTimer($('#ttimer'), T.s.timer);
}, 200);

function timerMenu(anchor) {
  const t = T.s && T.s.timer;
  const running = t && !t.done;
  popMenu(anchor, `
    ${running ? `
      <div class="tm-head">⏱ ${fmtTime(timerLeft(t))} left${t.paused ? ' (paused)' : ''}</div>
      <button data-t="pause"><span>${t.paused ? '▶️' : '⏸'}</span>${t.paused ? 'Carry on' : 'Pause'}</button>
      <button data-t="add30"><span>➕</span>Add 30 seconds</button>
      <button data-t="add60"><span>➕</span>Add 1 minute</button>
      <button data-t="cancel" class="danger"><span>✕</span>Stop the timer</button><hr>` : ''}
    ${!running && T.s.slides[T.s.slide].timer ? `<button data-sec="${T.s.slides[T.s.slide].timer}" class="tm-sugg"><span>▶️</span>Start ${fmtTime(T.s.slides[T.s.slide].timer * 1000)} (suggested for this slide)</button><hr>` : ''}
    <div class="tm-head">${running ? 'Start a new timer' : 'Start a timer'}</div>
    <div class="tm-presets">${[30, 60, 120, 180, 300, 600].map((sec) => `<button data-sec="${sec}">${sec < 60 ? sec + ' s' : sec / 60 + ' min'}</button>`).join('')}</div>
    <div class="mcustom"><input class="tin" id="tmin" type="number" min="0" max="60" inputmode="numeric" placeholder="min"><input class="tin" id="tsec" type="number" min="0" max="59" inputmode="numeric" placeholder="sec"><button class="primary" id="tgo">Start</button></div>
    <label class="tm-check"><input type="checkbox" id="tfreeze" checked> Freeze screens when time is up</label>`, (menu) => {
    const fr = () => $('#tfreeze', menu).checked;
    $$('[data-sec]', menu).forEach((b) => (b.onclick = () => { act('timer', { sec: +b.dataset.sec, freeze: fr() }); closeMenu(); }));
    $('#tgo', menu).onclick = () => {
      const sec = (+$('#tmin', menu).value || 0) * 60 + (+$('#tsec', menu).value || 0);
      if (sec >= 5) { act('timer', { sec, freeze: fr() }); closeMenu(); }
    };
    $$('[data-t]', menu).forEach((b) => (b.onclick = () => {
      const k = b.dataset.t;
      if (k === 'pause') act('timerPause');
      if (k === 'add30') act('timerAdd', { sec: 30 });
      if (k === 'add60') act('timerAdd', { sec: 60 });
      if (k === 'cancel') act('timerCancel');
      closeMenu();
    }));
  });
}

/* ============================== result renderers (shared) ============================== */
const PALETTE = ['#1E6FD9', '#E63946', '#1FA055', '#F6A800', '#8A5CF6', '#F2569B', '#14A3A3', '#FF7A1A'];

function cloudHTML(texts, opt = {}) {
  const counts = new Map();
  for (const t of texts) {
    const k = t.trim().toLowerCase();
    if (!k) continue;
    const e = counts.get(k) || { word: t.trim(), n: 0 };
    e.n++; counts.set(k, e);
  }
  const arr = [...counts.values()].sort((a, b) => b.n - a.n || a.word.localeCompare(b.word));
  if (!arr.length) return `<div class="wall-empty">Words will appear here…</div>`;
  const max = arr[0].n;
  const laid = [];
  arr.forEach((w, i) => (i % 2 ? laid.push(w) : laid.unshift(w)));
  const big = opt.big ? 1 : 0.62;
  return `<div class="cloud">${laid.map((w) => {
    const f = (20 + (w.n / max) * 70) * big;
    const c = PALETTE[[...w.word.toLowerCase()].reduce((a, ch) => a + ch.charCodeAt(0), 0) % PALETTE.length];
    return `<span class="cw" ${opt.teacher ? `data-w="${esc(w.word)}" title="Click to hide"` : ''} style="font-size:${f.toFixed(0)}px;color:${c}">${esc(w.word)}${w.n > 1 ? `<sup>${w.n}</sup>` : ''}</span>`;
  }).join('')}</div>`;
}

function scaleResultHTML(sl, vals, mineVal) {
  const lo = sl.min, hi = sl.max, span = hi - lo;
  const buckets = span <= 10 ? span + 1 : 10;
  const bw = (span + 1) / buckets;
  const counts = Array(buckets).fill(0);
  for (const v of vals) counts[Math.min(buckets - 1, Math.floor((v - lo) / bw))]++;
  const max = Math.max(1, ...counts);
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  return `<div class="scale-res">
    <div class="sr-bars">${counts.map((c, i) => {
      const label = span <= 10 ? lo + i : Math.round(lo + i * bw) + '–' + Math.round(lo + (i + 1) * bw - 1);
      const hue = 210 - (i / Math.max(1, buckets - 1)) * 205;
      return `<div class="sr-col"><span class="sr-n">${c || ''}</span><div class="sr-well"><div class="sr-bar" style="height:${(c / max) * 100}%;background:hsl(${hue} 75% 52%)"></div></div><span class="sr-l ${mineVal != null && Math.min(buckets - 1, Math.floor((mineVal - lo) / bw)) === i ? 'mine' : ''}">${label}</span></div>`;
    }).join('')}</div>
    <div class="sr-ends"><span>${esc(sl.left || '')}</span><span>${esc(sl.right || '')}</span></div>
    ${avg != null ? `<div class="sr-avg">Class average <b>${avg.toFixed(1)}</b> · ${vals.length} pair${vals.length === 1 ? '' : 's'}</div>` : ''}
  </div>`;
}

function rankResultHTML(sl, orders) {
  const n = sl.items.length;
  const sum = Array(n).fill(0), firsts = Array(n).fill(0);
  for (const o of orders) o.forEach((item, pos) => { sum[item] += pos + 1; if (pos === 0) firsts[item]++; });
  if (!orders.length) return `<div class="wall-empty">Rankings will appear here…</div>`;
  const rows = sl.items.map((t, i) => ({ t, i, avg: sum[i] / orders.length, first: firsts[i] })).sort((a, b) => a.avg - b.avg);
  return `<ol class="rank-res">${rows.map((r, k) => `<li style="--c:${PALETTE[k % PALETTE.length]}"><span class="rr-pos">${k + 1}</span><span class="rr-t">${esc(r.t)}</span><span class="rr-bar"><i style="width:${((n - r.avg + 1) / n) * 100}%"></i></span><span class="rr-avg">avg ${r.avg.toFixed(1)}${r.first ? ` · top for ${r.first}` : ''}</span></li>`).join('')}</ol>`;
}

function sortResultHTML(sl, arrs) {
  if (!arrs.length) return `<div class="wall-empty">Sorting results will appear here…</div>`;
  const G = sl.groups.length;
  if (sl.items.length > 8) {
    const cols = sl.groups.map(() => []);
    const split = [];
    sl.items.forEach((it, i) => {
      const c = Array(G).fill(0);
      let tot = 0;
      for (const a of arrs) if (a[i] >= 0) { c[a[i]]++; tot++; }
      if (!tot) return;
      const top = Math.max(...c);
      const g = c.indexOf(top);
      if (tot >= 2 && top / tot < 0.7) split.push({ it, c, tot });
      else cols[g].push({ it, n: top, tot });
    });
    return `<div class="sort-compact">${sl.groups.map((g, gi) => `<div class="sc-col" style="--c:${PALETTE[gi % PALETTE.length]}"><h4>${esc(g)}</h4><div class="sc-items">${cols[gi].map((x) => `<span class="sc-chip">${esc(x.it)}<small>${x.n}/${x.tot}</small></span>`).join('') || '<span class="muted">—</span>'}</div></div>`).join('')}</div>
      ${split.length ? `<div class="sc-split"><h4>🤔 The class is split on…</h4><div class="sc-items">${split.map((x) => `<span class="sc-chip split">${esc(x.it)}<span class="sc-bar">${x.c.map((n, gi) => `<i style="flex:${n};background:${PALETTE[gi % PALETTE.length]}" title="${esc(sl.groups[gi])}: ${n}"></i>`).join('')}</span></span>`).join('')}</div></div>` : ''}`;
  }
  return `<table class="sort-res"><thead><tr><th></th>${sl.groups.map((g) => `<th>${esc(g)}</th>`).join('')}</tr></thead><tbody>${sl.items.map((it, i) => {
    const c = Array(G).fill(0);
    let tot = 0;
    for (const a of arrs) if (a[i] >= 0) { c[a[i]]++; tot++; }
    const top = Math.max(...c);
    return `<tr><th>${esc(it)}</th>${c.map((x, g) => `<td class="${x && x === top ? 'top' : ''}" style="--a:${tot ? (x / tot).toFixed(2) : 0};--c:${PALETTE[g % PALETTE.length]}"><b>${x || ''}</b></td>`).join('')}</tr>`;
  }).join('')}</tbody></table>`;
}

function tapDotsHTML(points, opt = {}) {
  return points.map((p) => `<span class="tdot ${p.mine ? 'mine' : ''}" style="left:${p.x * 100}%;top:${p.y * 100}%;${p.c ? `--c:${p.c}` : ''}">${p.av ? `<i>${p.av}</i>` : ''}</span>`).join('');
}

/* ============================== shared work view (spotlight) ============================== */
function renderWork(w, sl) {
  if (!w) return '<p class="muted center">Nothing yet.</p>';
  const empty = (t) => `<div class="empty-work">${t}</div>`;
  switch (sl.type) {
    case 'cloud':
      return w.responses.length ? cloudHTML(w.responses.map((r) => r.text), { big: true }) : empty('No words yet.');
    case 'scale':
      return w.vote == null ? empty('Not answered yet.') : `<div class="scale-show"><div class="ss-v">${w.vote}</div><div class="ss-track"><i style="left:${((w.vote - sl.min) / (sl.max - sl.min)) * 100}%"></i></div><div class="sr-ends"><span>${sl.min} ${esc(sl.left || '')}</span><span>${esc(sl.right || '')} ${sl.max}</span></div></div>`;
    case 'rank':
      return w.vote == null ? empty('Not sent yet.') : `<ol class="rank-res">${w.vote.map((i, k) => `<li style="--c:${PALETTE[k % PALETTE.length]}"><span class="rr-pos">${k + 1}</span><span class="rr-t">${esc(sl.items[i])}</span></li>`).join('')}</ol>`;
    case 'sort':
      return w.vote == null ? empty('Not sorted yet.') : `<div class="sort-show">${sl.groups.map((g, gi) => `<div class="ssg" style="--c:${PALETTE[gi % PALETTE.length]}"><h4>${esc(g)}</h4>${sl.items.map((it, i) => (w.vote[i] === gi ? `<span class="schip">${esc(it)}</span>` : '')).join('')}</div>`).join('')}</div>`;
    case 'tap':
      return `<div class="tapwrap static"><img src="${esc(sl.src)}" alt="">${w.vote ? tapDotsHTML([{ ...w.vote, mine: true, av: w.pair && w.pair.av }]) : ''}</div>${w.vote ? '' : empty('No tap yet.')}`;
    case 'quiz': {
      const rev = sl.answer != null && (T.s ? T.s.quizReveal && T.s.quizReveal[sl.id] : P.view && P.view.quizReveal);
      return `<div class="opts static">${sl.options.map((o, i) => `<div class="opt ${w.vote === i ? 'on' : ''} ${rev && i === sl.answer ? 'right' : ''} ${rev && w.vote === i && i !== sl.answer ? 'wrong' : ''}"><span class="ol">${String.fromCharCode(65 + i)}</span><span class="ot">${esc(o)}</span><span class="oc">${w.vote === i ? '✓' : ''}</span></div>`).join('')}</div>`;
    }
    case 'cases':
      return caseWorkHTML(sl, w.casework);
    case 'draw':
      return w.drawing ? (BLOBS.get(w.drawing) ? `<div class="draw-show"><img src="${BLOBS.get(w.drawing)}" alt="Drawing"></div>` : `<div class="waiting"><div class="spinner"></div></div>`) : empty('No drawing sent yet.');
    default:
      return renderWorkBase(w, sl);
  }
}

/* ============================== pupil: new activities ============================== */
Object.assign(PUPIL_MOUNT, {
  cloud(main, sl) {
    const max = sl.max || 3;
    main.innerHTML = `${questionHead(sl)}
      <form class="answer cloud-in" autocomplete="off">
        <input class="tin big-in" maxlength="25" placeholder="Type a word…" enterkeyhint="send">
        <button class="primary" type="submit">Add ➤</button>
      </form>
      <h3 class="sec">Your words <small class="mycount"></small></h3>
      <div class="mywords"></div>
      <div class="wallwrap" hidden><h3 class="sec">The class cloud</h3><div class="pcloud panel-w"></div></div>`;
    const inp = $('input', main);
    const form = $('form', main);
    form.onsubmit = (e) => {
      e.preventDefault();
      const t = inp.value.trim();
      if (!t) return;
      P.link.send({ t: 'act', a: 'respond', slideId: sl.id, text: t });
      inp.value = '';
      form.classList.remove('sent'); void form.offsetWidth; form.classList.add('sent');
    };
    if (!IS_TOUCH && !NOFOCUS) setTimeout(() => inp.focus(), 50);
    return (v) => {
      const mine = (v.mine && v.mine.responses) || [];
      region($('.mywords', main), JSON.stringify(mine), mine.length ? mine.map((r) => `<span class="wchip">${esc(r.text)}<button class="x" data-id="${r.id}">✕</button></span>`).join('') : '<p class="empty-note">No words yet.</p>');
      $$('.mywords .x', main).forEach((b) => (b.onclick = () => P.link.send({ t: 'act', a: 'unrespond', slideId: sl.id, id: b.dataset.id })));
      $('.mycount', main).textContent = `${mine.length} of ${max}`;
      const full = mine.length >= max;
      inp.disabled = full; inp.placeholder = full ? 'All your words are in!' : 'Type a word…';
      const ww = $('.wallwrap', main);
      ww.hidden = !v.wall;
      if (v.wall) region($('.pcloud', main), JSON.stringify(v.wall.map((r) => r.text)), cloudHTML(v.wall.map((r) => r.text)));
    };
  },

  scale(main, sl) {
    const mid = Math.round((sl.min + sl.max) / 2);
    main.innerHTML = `${questionHead(sl)}
      <div class="scale-p">
        <div class="sp-val"><span class="sp-num">${mid}</span></div>
        <input type="range" class="sp-range" min="${sl.min}" max="${sl.max}" step="1" value="${mid}">
        <div class="sr-ends"><span>${sl.min} · ${esc(sl.left || '')}</span><span>${esc(sl.right || '')} · ${sl.max}</span></div>
        <div class="arow"><span class="saved"></span><button class="primary send">Send ➤</button></div>
      </div>
      <div class="wallwrap" hidden><h3 class="sec">The class</h3><div class="panel-w pres"></div></div>`;
    const rg = $('.sp-range', main);
    let touched = false;
    const paint = () => {
      $('.sp-num', main).textContent = rg.value;
      const f = (rg.value - sl.min) / (sl.max - sl.min);
      rg.style.setProperty('--f', f);
      $('.sp-val', main).style.setProperty('--f', f);
    };
    rg.oninput = () => { touched = true; paint(); $('.saved', main).textContent = 'Not sent yet'; $('.saved', main).className = 'saved'; };
    $('.send', main).onclick = () => { P.link.send({ t: 'act', a: 'vote', slideId: sl.id, value: +rg.value }); touched = false; };
    paint();
    return (v) => {
      const mv = v.mine ? v.mine.vote : undefined;
      if (mv != null && !touched) { rg.value = mv; paint(); }
      const sv = $('.saved', main);
      if (mv != null && !touched) { sv.textContent = '✓ Sent: ' + mv; sv.className = 'saved ok'; }
      $('.wallwrap', main).hidden = !v.agg;
      if (v.agg) region($('.pres', main), JSON.stringify([v.agg, mv]), scaleResultHTML(sl, v.agg, mv));
    };
  },

  rank(main, sl) {
    let order = sl.items.map((_, i) => i);
    main.innerHTML = `${questionHead(sl)}
      <ul class="rank-p"></ul>
      <div class="arow"><span class="saved"></span><button class="primary send">Send our order ➤</button></div>
      <div class="wallwrap" hidden><h3 class="sec">The class order</h3><div class="panel-w pres"></div></div>`;
    const ul = $('.rank-p', main);
    let dirty = false;
    const mark = () => { dirty = true; const sv = $('.saved', main); sv.textContent = 'Not sent yet'; sv.className = 'saved'; };
    const draw = () => {
      ul.innerHTML = order.map((i, k) => `<li data-i="${i}" style="--c:${PALETTE[k % PALETTE.length]}"><span class="rk-handle" title="Drag">⠿</span><span class="rk-pos">${k + 1}</span><span class="rk-t">${esc(sl.items[i])}</span><button class="rk-b up" ${k === 0 ? 'disabled' : ''}>▲</button><button class="rk-b dn" ${k === order.length - 1 ? 'disabled' : ''}>▼</button></li>`).join('');
      $$('li', ul).forEach((li, k) => {
        $('.up', li).onclick = () => { [order[k - 1], order[k]] = [order[k], order[k - 1]]; mark(); draw(); };
        $('.dn', li).onclick = () => { [order[k + 1], order[k]] = [order[k], order[k + 1]]; mark(); draw(); };
      });
    };
    let drag = null;
    ul.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.rk-handle');
      if (!h) return;
      const li = h.closest('li');
      e.preventDefault();
      try { li.setPointerCapture(e.pointerId); } catch {}
      drag = { li };
      li.classList.add('dragging');
    });
    ul.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const others = [...ul.children].filter((x) => x !== drag.li);
      let before = null;
      for (const it of others) { const r = it.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { before = it; break; } }
      if (before !== drag.li.nextSibling) ul.insertBefore(drag.li, before);
    });
    const end = () => {
      if (!drag) return;
      drag.li.classList.remove('dragging');
      drag = null;
      const next = [...ul.children].map((li) => +li.dataset.i);
      if (next.join() !== order.join()) { order = next; mark(); }
      draw();
    };
    ul.addEventListener('pointerup', end);
    ul.addEventListener('pointercancel', end);
    $('.send', main).onclick = () => { P.link.send({ t: 'act', a: 'vote', slideId: sl.id, order }); dirty = false; };
    draw();
    return (v) => {
      const mv = v.mine ? v.mine.vote : undefined;
      if (Array.isArray(mv) && !dirty && !drag && mv.join() !== order.join()) { order = mv.slice(); draw(); }
      if (Array.isArray(mv) && !dirty) { const sv = $('.saved', main); sv.textContent = '✓ Sent'; sv.className = 'saved ok'; }
      $('.wallwrap', main).hidden = !v.agg;
      if (v.agg) region($('.pres', main), JSON.stringify(v.agg), rankResultHTML(sl, v.agg));
    };
  },

  sort(main, sl) {
    let groups = sl.items.map(() => -1);
    let sel = null;
    main.innerHTML = `${questionHead(sl)}
      <div class="sort-tray"><div class="st-l">Cards to sort</div><div class="st-items"></div></div>
      <div class="sort-groups">${sl.groups.map((g, gi) => `<div class="sgz" data-g="${gi}" style="--c:${PALETTE[gi % PALETTE.length]}"><h4>${esc(g)}</h4><div class="sgz-items"></div></div>`).join('')}</div>
      <div class="arow"><span class="saved"></span></div>
      <div class="wallwrap" hidden><h3 class="sec">The class</h3><div class="panel-w pres"></div></div>`;
    let lastLocal = 0;
    const send = () => { lastLocal = Date.now(); P.link.send({ t: 'act', a: 'vote', slideId: sl.id, groups }); };
    const chip = (i) => `<button class="schip ${sel === i ? 'sel' : ''}" data-i="${i}">${esc(sl.items[i])}</button>`;
    const draw = () => {
      $('.st-items', main).innerHTML = sl.items.map((_, i) => (groups[i] === -1 ? chip(i) : '')).join('') || '<span class="st-done">✅ All sorted! Tap a card to move it.</span>';
      $$('.sgz', main).forEach((z) => { const g = +z.dataset.g; $('.sgz-items', z).innerHTML = sl.items.map((_, i) => (groups[i] === g ? chip(i) : '')).join(''); z.classList.toggle('ready', sel != null); });
      $('.sort-tray', main).classList.toggle('ready', sel != null && groups[sel] !== -1);
      const sv0 = $('.saved', main);
      if (sv0 && sv0.classList.contains('ok')) sv0.textContent = `✓ Saved · ${groups.filter((g) => g >= 0).length} of ${sl.items.length} sorted`;
      $$('.schip', main).forEach((b) => (b.onclick = (e) => {
        e.stopPropagation();
        const i = +b.dataset.i;
        const zone = b.closest('.sgz');
        if (sel != null && sel !== i && zone) { groups[sel] = +zone.dataset.g; sel = null; draw(); send(); return; }
        if (sel != null && sel !== i && b.closest('.sort-tray') && groups[sel] !== -1) { groups[sel] = -1; sel = null; draw(); send(); return; }
        sel = sel === i ? null : i; draw();
      }));
    };
    $$('.sgz', main).forEach((z) => (z.onclick = () => { if (sel == null) return; groups[sel] = +z.dataset.g; sel = null; draw(); send(); }));
    $('.sort-tray', main).onclick = () => { if (sel == null || groups[sel] === -1) return; groups[sel] = -1; sel = null; draw(); send(); };
    draw();
    return (v) => {
      const mv = v.mine ? v.mine.vote : undefined;
      if (Array.isArray(mv) && sel == null && Date.now() - lastLocal > 1500 && mv.join() !== groups.join()) { groups = mv.slice(); draw(); }
      const placed = groups.filter((g) => g >= 0).length;
      const sv = $('.saved', main);
      sv.textContent = Array.isArray(mv) ? `✓ Saved · ${placed} of ${sl.items.length} sorted` : 'Tap a card, then tap the group it belongs in.';
      sv.className = 'saved ' + (Array.isArray(mv) ? 'ok' : '');
      $('.wallwrap', main).hidden = !v.agg;
      if (v.agg) region($('.pres', main), JSON.stringify(v.agg), sortResultHTML(sl, v.agg));
    };
  },

  tap(main, sl) {
    main.innerHTML = `${questionHead(sl)}<div class="tapwrap"><img src="${esc(sl.src)}" alt="${esc(sl.title)}" draggable="false"><div class="tdots"></div></div><p class="look-note tap-note">👆 Tap the picture</p>`;
    const wrap = $('.tapwrap', main);
    const img = $('img', wrap);
    wrap.onclick = (e) => {
      const r = img.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      P.link.send({ t: 'act', a: 'vote', slideId: sl.id, x, y });
    };
    return (v) => {
      const mv = v.mine ? v.mine.vote : undefined;
      const pts = v.agg ? v.agg.map((p) => ({ ...p, av: p.mine ? v.me.av : '' })) : mv ? [{ ...mv, mine: true, av: v.me.av }] : [];
      region($('.tdots', main), JSON.stringify(pts), tapDotsHTML(pts));
      $('.tap-note', main).textContent = mv ? '✓ Got it! Tap somewhere else to move your dot.' : '👆 Tap the picture';
    };
  },

  quiz(main, sl) {
    main.innerHTML = `${questionHead(sl)}<div class="opts">${sl.options.map((o, i) => `<button class="opt" data-i="${i}"><span class="fill"></span><span class="ol">${String.fromCharCode(65 + i)}</span><span class="ot">${esc(o)}</span><span class="oc"></span></button>`).join('')}</div><div class="quiz-msg"></div>`;
    $$('.opt', main).forEach((b) => (b.onclick = () => { if (!P.view.quizReveal) P.link.send({ t: 'act', a: 'vote', slideId: sl.id, opt: +b.dataset.i }); }));
    return (v) => {
      const mine = v.mine ? v.mine.vote : undefined;
      const rev = v.quizReveal;
      const ans = v.cur.answer;
      const total = v.counts ? v.counts.reduce((a, b) => a + b, 0) : 0;
      $$('.opt', main).forEach((b, i) => {
        b.classList.toggle('on', mine === i);
        b.classList.toggle('right', rev && i === ans);
        b.classList.toggle('wrong', rev && mine === i && i !== ans);
        b.disabled = !!rev;
        $('.fill', b).style.width = rev && v.counts ? (total ? (v.counts[i] / total) * 100 : 0) + '%' : '0';
        $('.oc', b).textContent = rev && v.counts ? v.counts[i] : mine === i ? '✓' : '';
      });
      const msg = $('.quiz-msg', main);
      const html = !rev
        ? `<p class="empty-note center">${mine == null ? 'Choose your answer.' : 'Answer locked in. You can change it until your teacher shows the answer.'}</p>`
        : `<div class="qres ${mine === ans ? 'good' : 'bad'}"><b>${mine === ans ? '🎉 Correct!' : mine == null ? 'The answer is ' + String.fromCharCode(65 + ans) : '❌ Not this time'}</b>${v.cur.explain ? `<p>${esc(v.cur.explain)}</p>` : ''}</div>`;
      region(msg, html, html);
    };
  },

  draw(main, sl) {
    const COLS = ['#1D2846', '#E63946', '#1E6FD9', '#1FA055', '#F6A800', '#8A5CF6', '#F2569B', '#8B5A2B'];
    main.innerHTML = `${questionHead(sl)}
      <div class="draw-p">
        <div class="draw-tools">
          ${COLS.map((c, i) => `<button class="dcol ${i === 0 ? 'on' : ''}" data-c="${c}" style="--c:${c}" title="Colour"></button>`).join('')}
          <span class="dsep"></span>
          ${[4, 10, 22].map((w, i) => `<button class="dsize ${i === 1 ? 'on' : ''}" data-w="${w}" title="Pen size"><i style="width:${w / 1.4 + 4}px;height:${w / 1.4 + 4}px"></i></button>`).join('')}
          <span class="dsep"></span>
          <button class="dtool" data-t="eraser" title="Rubber">🧽</button>
          <button class="dtool" data-t="undo" title="Undo">↩️</button>
          <button class="dtool" data-t="clear" title="Clear">🗑️</button>
        </div>
        <canvas class="dcanvas" width="1000" height="700"></canvas>
        <div class="arow"><span class="saved"></span><button class="primary send">Send our drawing ➤</button></div>
      </div>`;
    const cv = $('canvas', main);
    const ctx = cv.getContext('2d');
    const fill = () => { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); };
    fill();
    let col = COLS[0], w = 10, eraser = false, drawing = null, dirty = false, loadedOwn = false;
    const hist = [];
    const snap = () => { try { hist.push(ctx.getImageData(0, 0, cv.width, cv.height)); if (hist.length > 20) hist.shift(); } catch {} };
    const mark = () => { dirty = true; const sv = $('.saved', main); sv.textContent = 'Not sent yet'; sv.className = 'saved'; };
    const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * cv.width, y: ((e.clientY - r.top) / r.height) * cv.height }; };
    cv.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { cv.setPointerCapture(e.pointerId); } catch {}
      snap();
      const p = pos(e);
      drawing = p;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = eraser ? '#fff' : col;
      ctx.lineWidth = (eraser ? w * 2.2 : w) * (e.pressure && e.pointerType === 'pen' ? 0.5 + e.pressure : 1);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
      mark();
    });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of evs) {
        const p = pos(ev);
        if (ev.pointerType === 'pen' && ev.pressure) ctx.lineWidth = (eraser ? w * 2.2 : w) * (0.5 + ev.pressure);
        ctx.beginPath(); ctx.moveTo(drawing.x, drawing.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        drawing = p;
      }
    });
    const up = () => { drawing = null; };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', up);
    $$('.dcol', main).forEach((b) => (b.onclick = () => { col = b.dataset.c; eraser = false; $$('.dcol,.dtool[data-t=eraser]', main).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('.dsize', main).forEach((b) => (b.onclick = () => { w = +b.dataset.w; $$('.dsize', main).forEach((x) => x.classList.toggle('on', x === b)); }));
    $$('.dtool', main).forEach((b) => (b.onclick = () => {
      const t = b.dataset.t;
      if (t === 'eraser') { eraser = !eraser; b.classList.toggle('on', eraser); $$('.dcol', main).forEach((x) => x.classList.toggle('on', !eraser && x.dataset.c === col)); }
      if (t === 'undo' && hist.length) { ctx.putImageData(hist.pop(), 0, 0); mark(); }
      if (t === 'clear') { snap(); fill(); mark(); }
    }));
    $('.send', main).onclick = () => {
      let data = cv.toDataURL('image/jpeg', 0.72);
      if (data.length > 420000) data = cv.toDataURL('image/jpeg', 0.5);
      P.link.send({ t: 'act', a: 'draw', slideId: sl.id, data });
      dirty = false;
      toast('Drawing sent 🎨', 'good');
    };
    return (v) => {
      const id = v.mine && v.mine.drawing;
      if (id && !loadedOwn && !dirty && BLOBS.get(id)) {
        loadedOwn = true;
        const im = new Image();
        im.onload = () => { if (!dirty) ctx.drawImage(im, 0, 0, cv.width, cv.height); };
        im.src = BLOBS.get(id);
      }
      if (id && !dirty) { const sv = $('.saved', main); sv.textContent = '✓ Sent. You can keep drawing and send again.'; sv.className = 'saved ok'; }
    };
  },
});

/* ============================== teacher: new activities ============================== */
const votesOf = (s, sl) => Object.entries(s.polls[sl.id] || {});
const metaPill = (st, html) => { const m = $('.st-meta', st); if (m && m.innerHTML !== html) m.innerHTML = html; };

Object.assign(TEACHER_MOUNT, {
  cloud(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="panel-w tcloud"></div><div class="hidden-words"></div>`;
    return (s) => {
      const items = s.responses[sl.id] || [];
      const vis = items.filter((r) => !r.hidden);
      metaPill(st, `<span class="pillc">☁️ ${vis.length} words</span><span class="pillc">🧑‍🤝‍🧑 ${new Set(items.map((r) => r.pairId)).size} pairs</span>`);
      region($('.tcloud', st), JSON.stringify(vis.map((r) => r.text)), cloudHTML(vis.map((r) => r.text), { big: true, teacher: true }));
      $$('.tcloud .cw', st).forEach((w) => (w.onclick = () => act('hideWord', { slideId: sl.id, word: w.dataset.w })));
      const hidden = [...new Set(items.filter((r) => r.hidden).map((r) => r.text.toLowerCase()))];
      region($('.hidden-words', st), JSON.stringify(hidden), hidden.length ? `Hidden: ${hidden.map((w) => `<button data-w="${esc(w)}">${esc(w)} ↺</button>`).join('')}` : '');
      $$('.hidden-words button', st).forEach((b) => (b.onclick = () => act('hideWord', { slideId: sl.id, word: b.dataset.w, show: true })));
    };
  },
  scale(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="panel-w tscale"></div>`;
    return (s) => {
      const vals = votesOf(s, sl).map(([, v]) => v);
      metaPill(st, `<span class="pillc">🎚️ ${vals.length} of ${Object.keys(s.pairs).length} pairs</span>`);
      region($('.tscale', st), JSON.stringify(vals), scaleResultHTML(sl, vals));
    };
  },
  rank(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="panel-w trank"></div>`;
    return (s) => {
      const vals = votesOf(s, sl).map(([, v]) => v);
      metaPill(st, `<span class="pillc">🔢 ${vals.length} of ${Object.keys(s.pairs).length} pairs</span>`);
      region($('.trank', st), JSON.stringify(vals), rankResultHTML(sl, vals));
    };
  },
  sort(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="panel-w tsort"></div>`;
    return (s) => {
      const vals = votesOf(s, sl).map(([, v]) => v);
      metaPill(st, `<span class="pillc">🗂️ ${vals.length} of ${Object.keys(s.pairs).length} pairs</span>`);
      region($('.tsort', st), JSON.stringify(vals), sortResultHTML(sl, vals));
    };
  },
  tap(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="tapwrap big"><img src="${esc(sl.src)}" alt=""><div class="tdots"></div></div>`;
    return (s) => {
      const vals = votesOf(s, sl);
      metaPill(st, `<span class="pillc">👆 ${vals.length} of ${Object.keys(s.pairs).length} pairs</span>`);
      const pts = vals.map(([pid, v]) => ({ ...v, av: s.hideNames ? '' : (s.pairs[pid] || {}).av, c: PALETTE[[...pid].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length] }));
      region($('.tdots', st), JSON.stringify(pts), tapDotsHTML(pts));
    };
  },
  quiz(st, sl) {
    st.innerHTML = `${stageHead(sl)}
      <div class="panel-w tquiz"><div class="bars"></div>
        <div class="tq-row"><button class="primary huge revealbtn"></button></div>
        <div class="tq-explain"></div></div>
      <div class="panel-w leader" hidden></div>`;
    $('.revealbtn', st).onclick = () => act('quizReveal', { on: !(T.s.quizReveal && T.s.quizReveal[sl.id]) });
    return (s) => {
      const rev = !!(s.quizReveal && s.quizReveal[sl.id]);
      const votes = votesOf(s, sl).map(([, v]) => v);
      const counts = sl.options.map((_, i) => votes.filter((v) => v === i).length);
      const max = Math.max(1, ...counts);
      metaPill(st, `<span class="pillc">❓ ${votes.length} of ${Object.keys(s.pairs).length} pairs answered</span>`);
      region($('.tquiz .bars', st), JSON.stringify([counts, rev]), sl.options.map((o, i) => `<div class="bar ${rev && i === sl.answer ? 'right' : ''} ${rev && i !== sl.answer ? 'faded' : ''}" style="--c:var(--c${i % 8})"><div class="bl">${String.fromCharCode(65 + i)}. ${esc(o)}${rev && i === sl.answer ? ' ✅' : ''}</div><div class="bt"><div class="bf" style="width:${rev ? (counts[i] / max) * 100 : 0}%"></div><span class="bn">${rev ? counts[i] : ''}</span></div></div>`).join(''));
      $('.revealbtn', st).textContent = rev ? '🙈 Hide the answer' : '✨ Show the answer';
      region($('.tq-explain', st), String(rev), rev && sl.explain ? `<p>💡 ${esc(sl.explain)}</p>` : '');
      const lb = $('.leader', st);
      lb.hidden = !rev;
      if (rev) {
        const score = {};
        for (const x of s.slides) if (x.type === 'quiz' && s.quizReveal[x.id]) for (const [pid, v] of Object.entries(s.polls[x.id] || {})) if (v === x.answer) score[pid] = (score[pid] || 0) + 1;
        const top = Object.entries(score).filter(([pid]) => s.pairs[pid]).sort((a, b) => b[1] - a[1]).slice(0, 5);
        region(lb, JSON.stringify([top, s.hideNames]), `<h3>🏆 Quiz scores so far</h3>${top.length ? `<ol class="lb-list">${top.map(([pid, n]) => `<li>${avHTML(s.pairs[pid].av)}<span>${s.hideNames ? '' : esc(s.pairs[pid].name)}</span><b>⭐ ${n}</b></li>`).join('')}</ol>` : '<p class="muted">No correct answers yet.</p>'}`);
      }
    };
  },
  draw(st, sl) {
    st.innerHTML = `${stageHead(sl)}<div class="gallery"></div>`;
    return (s) => {
      const map = (s.drawings && s.drawings[sl.id]) || {};
      const list = Object.entries(map).filter(([pid]) => s.pairs[pid]).sort((a, b) => a[1].at - b[1].at);
      metaPill(st, `<span class="pillc">🎨 ${list.length} of ${Object.keys(s.pairs).length} drawings</span>`);
      region($('.gallery', st), JSON.stringify([list, s.hideNames, T.blobTick]), list.length ? list.map(([pid, d]) => {
        const p = s.pairs[pid];
        const src = BLOBS.get(d.id);
        return `<div class="gcardd ${d.hidden ? 'hidden-card' : ''}" data-pid="${pid}">${src ? `<img src="${src}" alt="">` : '<div class="spinner"></div>'}<footer>${s.hideNames ? '' : `${p.av} ${esc(p.name)}`}</footer><button class="hidebtn" data-hide="${pid}" title="Hide or show">🙈</button></div>`;
      }).join('') : `<div class="wall-empty">Drawings appear here when pairs press Send…</div>`);
      $$('.gallery .gcardd', st).forEach((c) => (c.onclick = (e) => { if (e.target.dataset.hide) return act('hideDrawing', { slideId: sl.id, pairId: e.target.dataset.hide }); openSpotlight(c.dataset.pid); }));
    };
  },
});

/* ============================== case files ============================== */
const SEV_COL = ['#1FA055', '#8BC34A', '#F6A800', '#FF7A1A', '#E63946'];
const caseOf = (sl, id) => sl.cases.find((c) => c.id === id) || { name: '?', e: '📁', text: '' };
function sevHTML(avg, n) {
  if (avg == null) return `<div class="sevm empty">No ratings yet</div>`;
  const pct = ((avg - 1) / 4) * 100;
  return `<div class="sevm"><div class="sev-track"><i style="left:${pct}%"></i></div><b style="color:${SEV_COL[Math.min(4, Math.round(avg) - 1)]}">${avg.toFixed(1)}</b><small>${n} rating${n === 1 ? '' : 's'}</small></div>`;
}
function caseWorkHTML(sl, w) {
  if (!w) return `<div class="empty-work">No case chosen yet.</div>`;
  const c = caseOf(sl, w.c);
  return `<div class="cw-show">
    <div class="case-card big"><span class="cc-e">${c.e}</span><div><h3>${esc(c.name)}</h3><p>${esc(c.text)}</p></div></div>
    <div class="cw-sev">${w.sev ? `<span class="sevpill" style="--c:${SEV_COL[w.sev - 1]}">${w.sev} · ${esc(sl.scaleLabels[w.sev - 1])}</span>` : '<span class="muted">Not rated yet</span>'}</div>
    <div class="dd-cols"><div class="dd do"><h4>✅ DO</h4>${w.dos.map((x) => `<p>${esc(x.t)}</p>`).join('') || '<p class="muted">—</p>'}</div><div class="dd dont"><h4>⛔ DON'T</h4>${w.donts.map((x) => `<p>${esc(x.t)}</p>`).join('') || '<p class="muted">—</p>'}</div></div>
  </div>`;
}
function caseBoardHTML(sl, board, teacher) {
  return `<div class="case-board">${board.map((b) => {
    const c = caseOf(sl, b.id);
    const item = (x, kind) => `<li class="${x.hidden ? 'hidden-card' : ''}">${esc(x.t)}${x.name ? `<small>${x.av || ''} ${esc(x.name)}</small>` : ''}${teacher ? `<button class="hidebtn sm" data-pid="${x.pid}" data-id="${x.id}" data-kind="${kind}" title="Hide or show">🙈</button>` : ''}</li>`;
    return `<div class="cb-col">
      <div class="cb-head"><span class="cc-e">${c.e}</span><div><h3>${esc(c.name)}</h3><small>${b.n} pair${b.n === 1 ? '' : 's'}${b.avs ? ' ' + b.avs : ''}</small></div></div>
      ${sevHTML(b.avg, b.nr != null ? b.nr : b.n)}
      <div class="cb-dd do"><h4>✅ DO</h4><ul>${b.dos.map((x) => item(x, 'do')).join('') || '<li class="none">—</li>'}</ul></div>
      <div class="cb-dd dont"><h4>⛔ DON'T</h4><ul>${b.donts.map((x) => item(x, 'dont')).join('') || '<li class="none">—</li>'}</ul></div>
    </div>`;
  }).join('')}</div>`;
}

PUPIL_MOUNT.cases = function (main, sl) {
  main.innerHTML = `${questionHead(sl)}<div class="cases-p"></div><div class="wallwrap" hidden><h3 class="sec">The class case board</h3><div class="pboard"></div></div>`;
  const box = $('.cases-p', main);
  let curCase = undefined;
  const send = (o) => P.link.send({ t: 'act', ...o });
  return (v) => {
    const w = v.mine && v.mine.casework;
    const key = w ? w.c : null;
    if (key !== curCase) {
      curCase = key;
      if (!w) {
        box.innerHTML = `<h3 class="sec">Choose your case file</h3><div class="case-pick">${sl.cases.map((c) => `<button class="case-card" data-id="${c.id}"><span class="cc-e">${c.e}</span><div><h3>${esc(c.name)}</h3><p>${esc(c.text)}</p></div></button>`).join('')}</div>`;
        $$('.case-pick .case-card', box).forEach((b) => (b.onclick = () => send({ a: 'casePick', id: b.dataset.id })));
      } else {
        const c = caseOf(sl, w.c);
        box.innerHTML = `
          <div class="case-card big"><span class="cc-e">${c.e}</span><div><h3>${esc(c.name)}</h3><p>${esc(c.text)}</p></div><button class="linkbtn dark changecase">Change case</button></div>
          <div class="case-talk"><span class="lbl">Talk about</span><ol>${sl.prompts.map((q) => `<li>${esc(q)}</li>`).join('')}</ol></div>
          <div class="step-card">
            <div class="step"><span class="n">1</span>How serious is it?</div>
            <div class="sev-btns">${sl.scaleLabels.map((l, i) => `<button data-v="${i + 1}" style="--c:${SEV_COL[i]}"><b>${i + 1}</b><span>${esc(l)}</span></button>`).join('')}</div>
            <div class="step"><span class="n">2</span>What should people DO, and NOT do?</div>
            <div class="dd-cols">
              ${['do', 'dont'].map((k) => `<div class="dd ${k}"><h4>${k === 'do' ? '✅ DO' : '⛔ DON’T'}</h4><div class="dd-list"></div><form class="dd-in" data-k="${k}" autocomplete="off"><input class="tin" maxlength="120" placeholder="${k === 'do' ? 'e.g. Listen and help them report it' : 'e.g. Reply with something mean'}"><button class="primary" type="submit">Add</button></form></div>`).join('')}
            </div>
          </div>`;
        $('.changecase', box).onclick = () => send({ a: 'caseUnpick' });
        $$('.sev-btns button', box).forEach((b) => (b.onclick = () => send({ a: 'caseSev', v: +b.dataset.v })));
        $$('.dd-in', box).forEach((f) => (f.onsubmit = (e) => {
          e.preventDefault();
          const inp = $('input', f);
          const t = inp.value.trim();
          if (!t) return;
          send({ a: 'caseAdd', kind: f.dataset.k, text: t });
          inp.value = '';
        }));
      }
    }
    if (w) {
      $$('.sev-btns button', box).forEach((b) => b.classList.toggle('on', +b.dataset.v === w.sev));
      const cc = $('.changecase', box); if (cc) cc.hidden = !!(w.dos.length || w.donts.length);
      for (const k of ['do', 'dont']) {
        const list = k === 'do' ? w.dos : w.donts;
        const el = $(`.dd.${k} .dd-list`, box);
        region(el, JSON.stringify(list), list.map((x) => `<p class="dd-item">${esc(x.t)}<button class="x" data-id="${x.id}">✕</button></p>`).join(''));
        $$('.x', el).forEach((b) => (b.onclick = () => send({ a: 'caseDel', kind: k, id: b.dataset.id })));
        const inp = $(`.dd-in[data-k=${k}] input`, box);
        if (inp) inp.disabled = list.length >= 5;
      }
    }
    $('.wallwrap', main).hidden = !v.caseBoard;
    if (v.caseBoard) region($('.pboard', main), JSON.stringify(v.caseBoard), caseBoardHTML(sl, v.caseBoard.filter((b) => b.n), false));
  };
};

TEACHER_MOUNT.cases = function (st, sl) {
  st.innerHTML = `${stageHead(sl)}<div class="case-ctrl"><button class="tbtn assign">🎲 Share out cases to pairs who haven’t chosen</button><span class="case-ctrl-n"></span></div><div class="tboard"></div>`;
  $('.assign', st).onclick = () => act('caseAssign');
  return (s) => {
    const ws = Object.entries(s.cases || {}).filter(([k, w]) => w.slide === sl.id && s.pairs[k]);
    const total = Object.keys(s.pairs).length;
    metaPill(st, `<span class="pillc">📁 ${ws.length} of ${total} pairs have a case</span><span class="pillc">✍️ ${ws.filter(([, w]) => w.dos.length || w.donts.length).length} writing</span>`);
    $('.assign', st).hidden = ws.length >= total || !total;
    const board = sl.cases.map((c) => {
      const mine = ws.filter(([, w]) => w.c === c.id);
      const sevs = mine.map(([, w]) => w.sev).filter((x) => x);
      const nm = (k) => (s.hideNames ? {} : { name: s.pairs[k].name, av: s.pairs[k].av });
      return {
        id: c.id, n: mine.length, nr: sevs.length,
        avg: sevs.length ? sevs.reduce((a, b) => a + b, 0) / sevs.length : null,
        avs: s.hideNames ? '' : mine.map(([k]) => s.pairs[k].av).join(''),
        dos: mine.flatMap(([k, w]) => w.dos.map((x) => ({ ...x, pid: k, ...nm(k) }))),
        donts: mine.flatMap(([k, w]) => w.donts.map((x) => ({ ...x, pid: k, ...nm(k) }))),
      };
    });
    region($('.tboard', st), JSON.stringify(board), caseBoardHTML(sl, board, true));
    $$('.tboard .hidebtn', st).forEach((b) => (b.onclick = () => act('caseHide', { pairId: b.dataset.pid, id: b.dataset.id, kind: b.dataset.kind })));
  };
};

/* ============================== demo pairs (demo mode only) ============================== */
const BOT_NAMES = ['Ava & Theo', 'Mia & Jack', 'Ruby & Leo', 'Isla & Noah', 'Freya & Alfie', 'Poppy & Oscar', 'Ella & Finn', 'Lily & Max', 'Grace & Sam', 'Evie & Harry', 'Daisy & Archie', 'Rosie & Ted', 'Millie & Arlo', 'Zara & Kai', 'Maya & Reuben', 'Esme & Jude'];
const BOT_SAY = {
  s2: ['Playing Minecraft', 'Fortnite', 'Coding in Scratch', 'Typing a story', 'Watching a how-to video', 'FIFA', 'Maths games on the iPad', 'Reading on a Kindle'],
  s3: ['If you stop concentrating you lose the game', 'You have to listen to the instructions', 'You can’t really talk to people at the same time', 'You might miss something important', 'I can listen to music while I draw'],
  s5: ['Playing outside', 'Seeing their friends', 'Getting enough sleep', 'Their homework', 'Family time', 'Football practice', 'Reading books', 'Eating proper meals'],
  s10: { left: ['Listen to music', 'Eat a snack', 'Talk to my mum', 'Relax on the sofa'], right: ['Swimming', 'Sleeping', 'Riding my bike', 'Having a shower', 'Playing football'] },
  s12: ['Homework comes first', 'I check what time it is', 'I ask my parents', 'I think about what I need to do first', 'If it helps me learn'],
  any: ['I think so', 'Not sure', 'Sometimes', 'It depends on the day'],
};
const BOT_WHY = {
  yes: ['You can listen to music while you relax', 'It helps if it is research for homework', 'You can do both easily', 'It can help you calm down'],
  depends: ['Only if it is for a short time', 'If your parents say it is okay', 'It depends if you are being careful', 'Only if your friends want to as well'],
  no: ['You might get hurt', 'Your device could get wet', 'Your friends would feel ignored', 'You need to concentrate on both', 'It is rude at the dinner table', 'You would not get to sleep'],
};
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
function botDrawing() {
  const c = () => pickOne(['#E63946', '#1E6FD9', '#1FA055', '#F6A800', '#8A5CF6', '#F2569B']);
  const sx = 120 + Math.random() * 760;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 700'><rect width='1000' height='700' fill='#fff'/><circle cx='${sx}' cy='140' r='70' fill='#F6C23D'/><rect x='0' y='520' width='1000' height='180' fill='#9BD47A'/><rect x='${200 + Math.random() * 200}' y='330' width='170' height='190' fill='${c()}' stroke='#1D2846' stroke-width='8'/><path d='M${180 + Math.random() * 200} 330 l105 -110 l105 110z' fill='${c()}' stroke='#1D2846' stroke-width='8'/><rect x='${600 + Math.random() * 120}' y='400' width='190' height='120' rx='14' fill='#1D2846'/><rect x='${612 + Math.random() * 120}' y='412' width='166' height='90' rx='8' fill='${c()}'/><path d='M${100 + Math.random() * 100} 560 q60 -90 120 0' stroke='${c()}' stroke-width='14' fill='none' stroke-linecap='round'/></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

function startBots(n) {
  const core = T.link && T.link.core;
  if (!core) return;
  const bots = [];
  for (let i = 0; i < n; i++) {
    const cid = 'bot' + i + rnd(4);
    const bot = { cid, pid: null };
    T.link.sinks.set(cid, (m) => { if (m.t === 'welcome') bot.pid = m.pairId; });
    core.connect(cid);
    core.message(cid, { t: 'hello', role: 'pupil', name: BOT_NAMES[i % BOT_NAMES.length], av: AVATARS[i % AVATARS.length] });
    bots.push(bot);
  }
  const timer = setInterval(() => {
    const s = core.state;
    if (!s || s.frozen || s.flash || s.ended) return;
    const sl = s.slides[s.slide];
    for (const b of bots) {
      if (!b.pid || !s.pairs[b.pid] || Math.random() > 0.16) continue;
      const send = (o) => core.message(b.cid, { t: 'act', ...o });
      const mine = (s.responses[sl.id] || []).filter((r) => r.pairId === b.pid).length;
      if (sl.type === 'respond' && mine < 2) send({ a: 'respond', slideId: sl.id, text: pickOne(BOT_SAY[sl.id] || BOT_SAY.any) });
      if (sl.type === 'split' && mine < 3) { const side = Math.random() < 0.5 ? 'left' : 'right'; send({ a: 'respond', slideId: sl.id, side, text: pickOne(BOT_SAY.s10[side]) }); }
      if (sl.type === 'poll' && !(s.polls[sl.id] && s.polls[sl.id][b.pid] !== undefined)) send({ a: 'vote', slideId: sl.id, opt: Math.min(sl.options.length - 1, Math.floor(Math.random() ** 1.4 * sl.options.length)) });
      if (sl.type === 'deal') {
        const d = s.deals[b.pid];
        if (!d || !d.cur) { if (!d || d.board.length < 6) send({ a: 'deal' }); }
        else {
          const ids = d.cur.cards.map((c) => c.id);
          const risky = ids.some((x) => ['L2', 'L5', 'L8', 'L3'].includes(x));
          const v = risky ? (Math.random() < 0.75 ? 'no' : 'depends') : pickOne(['yes', 'yes', 'depends', 'no']);
          send({ a: 'decide', verdict: v, important: pickOne(['life', 'life', 'tech', 'same']), why: pickOne(BOT_WHY[v]) });
        }
      }
      if (Math.random() < 0.03) send({ a: 'light', v: pickOne(['green', 'green', 'green', 'amber', 'red']) });
      if (Math.random() < 0.004) send({ a: 'help', on: true });
      const hasVote = s.polls[sl.id] && s.polls[sl.id][b.pid] !== undefined;
      if (sl.type === 'cloud' && mine < 2) send({ a: 'respond', slideId: sl.id, text: pickOne(['annoyed', 'sad', 'grumpy', 'fine', 'cross', 'okay', 'frustrated', 'annoyed', 'sad', 'happy', 'bored']) });
      if (sl.type === 'scale' && !hasVote) send({ a: 'vote', slideId: sl.id, value: Math.round(sl.min + (sl.max - sl.min) * Math.min(1, Math.max(0, 0.65 + (Math.random() - 0.5) * 0.7))) });
      if (sl.type === 'rank' && !hasVote) { const o = sl.items.map((_, i) => i); for (let i = o.length - 1; i > 0; i--) { if (Math.random() < 0.45) { const j = Math.floor(Math.random() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; } } send({ a: 'vote', slideId: sl.id, order: o }); }
      if (sl.type === 'sort' && !hasVote) send({ a: 'vote', slideId: sl.id, groups: sl.items.map((_, i) => (Math.random() < 0.7 ? [0, 1, 0, 1, 0, 1, 2][i % 7] : Math.floor(Math.random() * sl.groups.length))) });
      if (sl.type === 'tap' && !hasVote) { const spots = [[0.47, 0.43], [0.38, 0.68], [0.5, 0.82], [0.2, 0.62], [0.75, 0.3]]; const [x, y] = pickOne(spots); send({ a: 'vote', slideId: sl.id, x: x + (Math.random() - 0.5) * 0.06, y: y + (Math.random() - 0.5) * 0.06 }); }
      if (sl.type === 'quiz' && !hasVote && !(s.quizReveal && s.quizReveal[sl.id])) send({ a: 'vote', slideId: sl.id, opt: Math.random() < 0.7 ? sl.answer : Math.floor(Math.random() * sl.options.length) });
      if (sl.type === 'draw' && !(s.drawings[sl.id] && s.drawings[sl.id][b.pid])) send({ a: 'draw', slideId: sl.id, data: botDrawing() });
      if (sl.type === 'cases') {
        const w = s.cases && s.cases[b.pid];
        const DOS = ['Tell a trusted adult', 'Listen to your friend', 'Report it', 'Ask before posting photos', 'Keep your password secret', 'Send a kind private message', 'Block the person'];
        const DONTS = ['Reply with something mean', 'Join in', 'Share the photo', 'Give out your password', 'Snoop on their phone', 'Ignore your friend', 'Pass on their nickname'];
        if (!w || w.slide !== sl.id) send({ a: 'casePick', id: pickOne(sl.cases).id });
        else if (!w.sev) send({ a: 'caseSev', v: 2 + Math.floor(Math.random() * 4) });
        else if (w.dos.length < 2) send({ a: 'caseAdd', kind: 'do', text: pickOne(DOS) });
        else if (w.donts.length < 2) send({ a: 'caseAdd', kind: 'dont', text: pickOne(DONTS) });
      }
      if (sl.type === 'task') {
        const t = s.tasks[b.pid] || {};
        if (!t.pos) send({ a: 'task', side: 'pos', life: pickOne(['L1', 'L4', 'L10', 'L7']), tech: pickOne(['T1', 'T7', 'T6']), why: pickOne(BOT_WHY.yes) });
        else if (!t.neg) send({ a: 'task', side: 'neg', life: pickOne(['L2', 'L5', 'L8', 'L9', 'L6']), tech: pickOne(['T2', 'T3', 'T8', 'T5', 'T4']), why: pickOne(BOT_WHY.no) });
      }
    }
  }, 700);
  T.bots = { bots, timer };
}
function stopBots() {
  if (!T.bots) return;
  clearInterval(T.bots.timer);
  const core = T.link && T.link.core;
  for (const b of T.bots.bots) { if (core) { if (b.pid) core.message('host', { t: 'act', a: 'kick', pairId: b.pid }); core.disconnect(b.cid); } T.link.sinks.delete(b.cid); }
  T.bots = null;
}

/* ============================== INTERACTIVE LESSON PLANNER ============================== */
let TCODE = null; // teacher code: kept in memory only, never saved on the device
let SERVER_AI = false;
const ACT_TYPES = ['respond', 'poll', 'quiz', 'cloud', 'scale', 'rank', 'sort', 'split', 'cases', 'draw', 'tap'];
const ACT_INFO = {
  image: ['🖼️', 'Teaching slide', 'One of your slides, shown on every screen.'],
  title: ['🏁', 'Joining screen', 'Title, objective, QR code and room code.'],
  respond: ['💬', 'Typed answers', 'Pairs type answers; cards pop up on your screen.'],
  poll: ['📊', 'Vote', 'Pairs pick one option; live bar chart.'],
  quiz: ['❓', 'Quiz question', 'One right answer; you reveal it; pairs score stars.'],
  cloud: ['☁️', 'Word cloud', 'Short words; popular ones grow bigger.'],
  scale: ['🎚️', 'Scale', 'A slider from low to high, with the class average.'],
  rank: ['🔢', 'Rank it', 'Put items in order; see the class order.'],
  sort: ['🗂️', 'Sort it', 'Tap cards into groups; see where the class agrees.'],
  split: ['↔️', 'Two columns', 'Typed answers sorted into two columns.'],
  cases: ['📁', 'Case files', 'Scenarios: rate how serious, write DO’s and DON’Ts.'],
  draw: ['🎨', 'Draw it', 'Drawing pad for finger, pencil or mouse.'],
  tap: ['👆', 'Tap the picture', 'Pupils tap a spot on a picture.'],
  deal: ['🎴', 'Card deal', 'Built-in card game (from the examples).'],
  task: ['⚖️', 'Positive & negative', 'Built-in card task (from the examples).'],
  cards: ['🃏', 'Card decks', 'Shows the two card decks.'],
  split_: [],
};
const TIMER_OPTS = [[0, 'No timer'], [60, '1 min'], [120, '2 min'], [180, '3 min'], [300, '5 min'], [600, '10 min'], [900, '15 min'], [1200, '20 min']];
const PL = { lesson: null, sel: 0, dirty: false };
const slugify = (t) => (String(t || 'lesson').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 28) || 'lesson') + '-' + rnd(4);
const authorName = () => lstore.get('ilp-author') || '';

/* ---------- storage: Cloudflare (live) or this browser (demo) ---------- */
let _idb = null;
const memLessons = new Map();
function idb() {
  if (_idb) return _idb;
  _idb = new Promise((res) => {
    try {
      const rq = indexedDB.open('interactive-lesson-planner', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('lessons', { keyPath: 'id' });
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    } catch { res(null); }
  });
  return _idb;
}
async function idbDo(mode, fn) {
  const db = await idb();
  if (!db) return fn(null);
  return new Promise((res, rej) => {
    const tx = db.transaction('lessons', mode);
    const st = tx.objectStore('lessons');
    const r = fn(st);
    if (r && 'onsuccess' in r) { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
    else tx.oncomplete = () => res(r);
  });
}
const hdr = (extra = {}) => ({ 'x-teacher-code': TCODE || '', ...extra });
async function jfetch(url, opt = {}) {
  const r = await fetch(url, opt);
  let j = null;
  try { j = await r.json(); } catch {}
  if (!r.ok) { const e = new Error((j && j.error) || 'http' + r.status); e.code = j && j.error; e.detail = j && j.detail; throw e; }
  return j;
}
function exampleList() {
  return ((window.LVT_LESSONS && window.LVT_LESSONS.index) || []).map((x) => ({ ...x, cover: x.cover ? 'lessons/' + x.cover : '' }));
}
const API = {
  async list() {
    if (MODE === 'live') return jfetch('/api/lessons', { headers: hdr() });
    let mine = [];
    const all = await idbDo('readonly', (st) => (st ? st.getAll() : null));
    const arr = all || [...memLessons.values()];
    mine = arr.map((l) => ({ id: l.id, title: l.title, subject: l.subject, author: l.author, updated: l.updated, cover: l.cover || (l.slides.find((s) => s.src) || {}).src || '', count: l.slides.length })).sort((a, b) => b.updated - a.updated);
    return { lessons: mine, examples: exampleList() };
  },
  async get(id) {
    if (MODE === 'live') return jfetch('/api/lessons/' + id, { headers: hdr() });
    const ex = window.LVT_LESSONS && window.LVT_LESSONS.lessons[id];
    if (ex) { const L = normaliseLesson(ex, 'lessons/' + id + '/'); return { ...ex, slides: L.slides, decks: L.decks, cover: (L.slides.find((x) => x.src) || {}).src, example: true }; }
    const l = await idbDo('readonly', (st) => (st ? st.get(id) : null));
    return l || memLessons.get(id) || null;
  },
  async save(lesson) {
    lesson.updated = Date.now();
    lesson.cover = (lesson.slides.find((x) => x.src) || {}).src || '';
    if (MODE === 'live') return jfetch('/api/lessons/' + lesson.id, { method: 'PUT', headers: hdr({ 'content-type': 'application/json' }), body: JSON.stringify(lesson) });
    const copy = JSON.parse(JSON.stringify(lesson));
    const ok = await idbDo('readwrite', (st) => (st ? st.put(copy) : null)).catch(() => null);
    if (ok === null) memLessons.set(copy.id, copy);
    return { ok: true };
  },
  async del(id) {
    if (MODE === 'live') return jfetch('/api/lessons/' + id, { method: 'DELETE', headers: hdr() });
    await idbDo('readwrite', (st) => (st ? st.delete(id) : null)).catch(() => {});
    memLessons.delete(id);
  },
  async media(blob) {
    if (MODE === 'live') {
      const j = await jfetch('/api/media', { method: 'POST', headers: hdr({ 'content-type': blob.type }), body: blob });
      return j.url;
    }
    return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
  },
  async generate(body) {
    if (MODE !== 'live') { const e = new Error('noai'); e.code = 'noai'; throw e; }
    return jfetch('/api/generate', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: JSON.stringify(body) });
  },
  async run(id, lesson) {
    if (MODE === 'live') {
      const j = await jfetch('/api/create', { method: 'POST', headers: hdr({ 'content-type': 'application/json' }), body: JSON.stringify({ teacherCode: TCODE, lessonId: id }) });
      startTeacher({ code: j.code, key: j.key });
    } else {
      const raw = lesson || (await API.get(id));
      startDemoTeacher(normaliseLesson(raw, ''));
    }
  },
};

/* ---------- entering the teacher area ---------- */
function teacherEnter() {
  if (MODE !== 'live' || TCODE) return showHub();
  const m = modal(`
    <h2>Teacher area</h2>
    <p class="muted">Enter the teacher code. It isn’t saved on this device.</p>
    <input id="tcodeIn" type="password" class="tin" placeholder="Teacher code" autocomplete="off">
    <p class="err" id="gerr"></p>
    <div class="mrow"><button class="ghost" data-close>Cancel</button><button class="primary" id="gok">Open ➜</button></div>`);
  const go = async () => {
    const c = $('#tcodeIn', m).value;
    try {
      await jfetch('/api/check', { method: 'POST', headers: { 'x-teacher-code': c } });
      TCODE = c; closeModal(); showHub();
    } catch { $('#gerr', m).textContent = 'That teacher code isn’t right.'; }
  };
  $('#gok', m).onclick = go;
  $('#tcodeIn', m).onkeydown = (e) => { if (e.key === 'Enter') go(); };
  if (!IS_TOUCH) setTimeout(() => $('#tcodeIn', m).focus(), 50);
}

/* ---------- hub: the lesson library ---------- */
async function showHub(msg = '') {
  document.body.className = 'hub-mode';
  setTheme(0);
  app.innerHTML = `
  <div class="hub">
    <header class="hub-top">
      <div class="hub-brand"><span class="hb-mark">✦</span>Interactive Lesson Planner</div>
      <span class="spacer"></span>
      <button class="primary" id="newL">＋ New lesson</button>
      <button class="ghost" id="hubOut">${MODE === 'live' ? 'Sign out' : 'Home'}</button>
    </header>
    <main class="hub-main">
      ${msg ? `<p class="home-msg">${esc(msg)}</p>` : ''}
      ${MODE === 'local' ? `<div class="demo-note">Demo mode: lessons are kept in this browser only, and AI drafting needs the Cloudflare version. Everything else works.</div>` : ''}
      <h2 class="hub-h">School lessons</h2>
      <div class="lgrid" id="lgrid"><div class="spinner"></div></div>
      <h2 class="hub-h">Examples</h2>
      <div class="lgrid" id="egrid"></div>
    </main>
  </div>`;
  $('#newL').onclick = () => showWizard();
  $('#hubOut').onclick = () => { TCODE = null; showHome(); };
  let data;
  try { data = await API.list(); } catch (e) {
    if (e.code === 'badcode') { TCODE = null; return showHome('Please enter the teacher code again.'); }
    $('#lgrid').innerHTML = `<p class="err">Couldn’t load lessons. Check the connection and try again.</p>`; return;
  }
  const when = (t) => (t ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
  const card = (l, ex) => `
    <div class="lcard2" data-id="${esc(l.id)}">
      <div class="lc-img">${l.cover ? `<img src="${esc(l.cover)}" alt="" loading="lazy">` : '<span>📘</span>'}</div>
      <div class="lc-body">
        <b>${esc(l.title)}</b>
        <small>${esc([l.subject, l.author ? 'by ' + l.author : '', l.count ? l.count + ' steps' : '', when(l.updated)].filter(Boolean).join(' · '))}</small>
        <div class="lc-btns">
          <button class="primary sm" data-a="run">▶ Run</button>
          ${ex ? '<button class="ghost sm" data-a="dup">⧉ Copy to edit</button>' : '<button class="ghost sm" data-a="edit">✏️ Edit</button><button class="ghost sm icon" data-a="dup" title="Duplicate">⧉</button><button class="ghost sm icon danger" data-a="del" title="Delete">🗑</button>'}
        </div>
      </div>
    </div>`;
  $('#lgrid').innerHTML = data.lessons.length ? data.lessons.map((l) => card(l, false)).join('') : `<div class="empty-lib"><b>No lessons yet.</b><span>Press <i>＋ New lesson</i> to upload your slides and plan.</span></div>`;
  $('#egrid').innerHTML = data.examples.map((l) => card(l, true)).join('');
  $$('.lcard2 [data-a]').forEach((b) => (b.onclick = async () => {
    const id = b.closest('.lcard2').dataset.id;
    const a = b.dataset.a;
    try {
      if (a === 'run') { b.disabled = true; await API.run(id); }
      if (a === 'edit') { const l = await API.get(id); showEditor(l); }
      if (a === 'dup') {
        const l = await API.get(id);
        const copy = { ...JSON.parse(JSON.stringify(l)), id: slugify(l.title), title: l.title + (l.example ? '' : ' (copy)'), author: authorName(), example: undefined, created: Date.now() };
        if (!copy.media) copy.media = copy.slides.filter((s) => s.src).map((s) => ({ src: s.src }));
        await API.save(copy);
        showEditor(copy);
      }
      if (a === 'del') {
        confirmBox('Delete this lesson? This can’t be undone.', 'Delete', async () => { await API.del(id); showHub('Lesson deleted.'); }, true);
      }
    } catch (e) { toast(e.code === 'nolesson' ? 'That lesson could not be found.' : 'Something went wrong. Try again.'); b.disabled = false; }
  }));
}

/* ---------- reading files in the browser ---------- */
const vendorUrl = (f) => new URL('vendor/' + f, location.href.split('#')[0]).href;
let _pdfjs = null;
async function pdfjs() {
  if (_pdfjs) return _pdfjs;
  const m = await import(vendorUrl('pdf.min.mjs'));
  m.GlobalWorkerOptions.workerSrc = vendorUrl('pdf.worker.min.mjs');
  return (_pdfjs = m);
}
function jszip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = vendorUrl('jszip.min.js'); s.onload = () => res(window.JSZip); s.onerror = rej; document.head.appendChild(s); });
}
function canvasBlob(cv) {
  return new Promise((res) => cv.toBlob((b) => {
    if (b && b.type === 'image/webp' && b.size < 1800000) return res(b);
    cv.toBlob((j) => res(j), 'image/jpeg', 0.84);
  }, 'image/webp', 0.82));
}
function loadImg(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
async function pdfSlides(file, prog) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    prog(`Reading page ${i} of ${doc.numPages}…`);
    const page = await doc.getPage(i);
    const v1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, 1400 / v1.width) });
    const cv = document.createElement('canvas');
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const tc = await page.getTextContent();
    const text = tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ').trim();
    out.push({ blob: await canvasBlob(cv), text });
  }
  return out;
}
async function pdfText(file) {
  const lib = await pdfjs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  let t = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    t += tc.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('') + '\n\n';
  }
  return t.replace(/[ \t]+/g, ' ').trim();
}
const NS = { a: 'http://schemas.openxmlformats.org/drawingml/2006/main', p: 'http://schemas.openxmlformats.org/presentationml/2006/main', r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships' };
const xmlDoc = (s) => new DOMParser().parseFromString(s, 'application/xml');
const kids = (el, ns, name) => [...el.children].filter((c) => c.namespaceURI === ns && c.localName === name);
const first = (el, ns, name) => el.getElementsByTagNameNS(ns, name)[0];
function relMap(xml) {
  const m = {};
  if (!xml) return m;
  for (const r of xmlDoc(xml).getElementsByTagName('Relationship')) m[r.getAttribute('Id')] = r.getAttribute('Target');
  return m;
}
const joinPath = (base, rel) => { const out = base.split('/').slice(0, -1); for (const p of rel.split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };
async function pptxSlides(file, prog) {
  const JSZip = await jszip();
  const zip = await JSZip.loadAsync(file);
  const pres = xmlDoc(await zip.file('ppt/presentation.xml').async('string'));
  const prels = relMap(await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'));
  const sz = first(pres, NS.p, 'sldSz');
  const SW = +(sz && sz.getAttribute('cx')) || 12192000, SH = +(sz && sz.getAttribute('cy')) || 6858000;
  const ids = [...pres.getElementsByTagNameNS(NS.p, 'sldId')].map((e) => prels[e.getAttributeNS(NS.r, 'id')]).filter(Boolean);
  const W = 1400, H = Math.round((W * SH) / SW), K = W / SW;
  const out = [];
  for (let n = 0; n < ids.length; n++) {
    prog(`Reading slide ${n + 1} of ${ids.length}…`);
    const path = joinPath('ppt/presentation.xml', ids[n]);
    const sx = zip.file(path);
    if (!sx) continue;
    const doc = xmlDoc(await sx.async('string'));
    const rels = relMap(await zip.file(path.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))?.async('string'));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const bgc = first(doc, NS.p, 'bg') && first(first(doc, NS.p, 'bg'), NS.a, 'srgbClr');
    ctx.fillStyle = bgc ? '#' + bgc.getAttribute('val') : '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const texts = [];
    const tree = first(doc, NS.p, 'spTree');
    const xf = (el) => {
      const x = first(el, NS.a, 'xfrm');
      if (!x) return null;
      const o = first(x, NS.a, 'off'), e = first(x, NS.a, 'ext');
      return o && e ? { x: +o.getAttribute('x'), y: +o.getAttribute('y'), w: +e.getAttribute('cx'), h: +e.getAttribute('cy') } : null;
    };
    const walk = async (parent, tf) => {
      for (const el of [...parent.children]) {
        if (el.namespaceURI !== NS.p) continue;
        if (el.localName === 'grpSp') {
          const g = first(el, NS.a, 'xfrm');
          let t2 = tf;
          if (g) {
            const o = first(g, NS.a, 'off'), e = first(g, NS.a, 'ext'), co = first(g, NS.a, 'chOff'), ce = first(g, NS.a, 'chExt');
            if (o && e && co && ce) {
              const sxk = +e.getAttribute('cx') / (+ce.getAttribute('cx') || 1), syk = +e.getAttribute('cy') / (+ce.getAttribute('cy') || 1);
              t2 = (b) => tf({ x: +o.getAttribute('x') + (b.x - +co.getAttribute('x')) * sxk, y: +o.getAttribute('y') + (b.y - +co.getAttribute('y')) * syk, w: b.w * sxk, h: b.h * syk });
            }
          }
          await walk(el, t2);
        } else if (el.localName === 'pic') {
          const blip = first(el, NS.a, 'blip');
          const rid = blip && blip.getAttributeNS(NS.r, 'embed');
          const b = xf(el);
          const target = rid && rels[rid];
          if (!b || !target || !/\.(png|jpe?g|gif|webp|bmp)$/i.test(target)) continue;
          const f = zip.file(joinPath(path, target));
          if (!f) continue;
          try {
            const url = URL.createObjectURL(await f.async('blob'));
            const im = await loadImg(url);
            const bb = tf(b);
            ctx.drawImage(im, bb.x * K, bb.y * K, bb.w * K, bb.h * K);
            URL.revokeObjectURL(url);
          } catch {}
        } else if (el.localName === 'sp') {
          const body = first(el, NS.p, 'txBody');
          if (!body) continue;
          const ph = first(el, NS.p, 'ph');
          const isTitle = ph && /title/i.test(ph.getAttribute('type') || '');
          const paras = kids(body, NS.a, 'p').map((p) => [...p.getElementsByTagNameNS(NS.a, 't')].map((t) => t.textContent).join('')).filter((t) => t.trim());
          if (!paras.length) continue;
          texts.push(paras.join('\n'));
          let b = xf(el);
          if (!b) b = isTitle ? { x: SW * 0.06, y: SH * 0.05, w: SW * 0.88, h: SH * 0.18 } : { x: SW * 0.06, y: SH * 0.26, w: SW * 0.88, h: SH * 0.66 };
          const bb = tf(b);
          const rpr = first(body, NS.a, 'rPr');
          const szv = rpr && +rpr.getAttribute('sz');
          let fs = (szv ? szv / 100 : isTitle ? 36 : 22) * 12700 * K;
          const col = rpr && first(rpr, NS.a, 'srgbClr');
          ctx.fillStyle = col ? '#' + col.getAttribute('val') : '#1D2846';
          ctx.textBaseline = 'top';
          const x0 = bb.x * K + 8, maxW = bb.w * K - 16;
          const lines = [];
          const layout = () => {
            lines.length = 0;
            ctx.font = `${isTitle ? 700 : 600} ${fs}px Nunito, 'Segoe UI', sans-serif`;
            for (const p of paras) {
              let line = '';
              for (const w of p.split(/\s+/)) {
                const t = line ? line + ' ' + w : w;
                if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
              }
              lines.push(line);
            }
          };
          layout();
          while (lines.length * fs * 1.25 > bb.h * K + fs && fs > 10) { fs *= 0.9; layout(); }
          lines.forEach((l, i) => ctx.fillText(l, x0, bb.y * K + 4 + i * fs * 1.25));
        }
      }
    };
    if (tree) await walk(tree, (b) => b);
    let notes = '';
    const nrel = Object.values(rels).find((t) => /notesSlide/.test(t));
    if (nrel) {
      const nf = zip.file(joinPath(path, nrel));
      if (nf) notes = [...xmlDoc(await nf.async('string')).getElementsByTagNameNS(NS.a, 't')].map((t) => t.textContent).join(' ').replace(/\s+/g, ' ').trim();
    }
    out.push({ blob: await canvasBlob(cv), text: texts.join('\n') + (notes && notes.length > 3 ? '\nNotes: ' + notes : '') });
  }
  return out;
}
async function imageSlides(files, prog) {
  const out = [];
  const list = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (let i = 0; i < list.length; i++) {
    prog(`Reading picture ${i + 1} of ${list.length}…`);
    const url = URL.createObjectURL(list[i]);
    try {
      const im = await loadImg(url);
      const k = Math.min(1, 1400 / im.naturalWidth);
      const cv = document.createElement('canvas'); cv.width = Math.round(im.naturalWidth * k); cv.height = Math.round(im.naturalHeight * k);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(im, 0, 0, cv.width, cv.height);
      out.push({ blob: await canvasBlob(cv), text: '' });
    } catch {}
    URL.revokeObjectURL(url);
  }
  return out;
}
async function docxText(file) {
  const JSZip = await jszip();
  const zip = await JSZip.loadAsync(file);
  const doc = xmlDoc(await zip.file('word/document.xml').async('string'));
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  return [...doc.getElementsByTagNameNS(W, 'p')].map((p) => {
    let t = '';
    for (const n of p.getElementsByTagNameNS(W, '*')) {
      if (n.localName === 't') t += n.textContent;
      else if (n.localName === 'tab') t += '\t';
      else if (n.localName === 'br') t += '\n';
    }
    return t;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function pptxText(file) {
  const s = await pptxSlides(file, () => {});
  return s.map((x, i) => `Slide ${i + 1}: ${x.text}`).join('\n');
}

/* ---------- wizard: new lesson ---------- */
function showWizard() {
  document.body.className = 'hub-mode';
  setTheme(1);
  const W = { slides: [], plan: '', busy: false };
  app.innerHTML = `
  <div class="hub">
    <header class="hub-top">
      <button class="ghost" id="wBack">← Library</button>
      <div class="hub-brand">New lesson</div>
      <span class="spacer"></span>
    </header>
    <main class="hub-main wiz">
      <section class="wcard1">
        <div class="wc-h"><span class="wn">1</span><h2>Your slides</h2><small>PowerPoint, PDF, or pictures</small></div>
        <label class="drop" id="dropS"><input type="file" id="fileS" accept=".pdf,.pptx,image/*" multiple hidden><b>Drop your slides here</b><span>or tap to choose a file</span></label>
        <p class="tip">Tip: for an exact copy of your slides, save your PowerPoint as a PDF and upload that.</p>
        <div class="wstatus" id="statS"></div>
        <div class="thumbs" id="thumbs"></div>
      </section>
      <section class="wcard1">
        <div class="wc-h"><span class="wn">2</span><h2>Your lesson plan</h2><small>Word, PDF or text, or paste it in</small></div>
        <label class="drop slim" id="dropP"><input type="file" id="fileP" accept=".pdf,.docx,.txt,.md,.pptx" hidden><b>Drop your lesson plan here</b><span>or tap to choose a file</span></label>
        <div class="wstatus" id="statP"></div>
        <textarea class="tin plan" id="planT" rows="7" placeholder="…or paste your lesson plan here"></textarea>
      </section>
      <section class="wcard1">
        <div class="wc-h"><span class="wn">3</span><h2>About the lesson</h2></div>
        <div class="fgrid">
          <label>Lesson title<input class="tin" id="wTitle" maxlength="80" placeholder="e.g. Digital Dilemmas"></label>
          <label>Year group<select class="tin" id="wYear">${['', 'Reception', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Year 6', 'KS1', 'KS2', 'Year 7+'].map((y) => `<option>${y}</option>`).join('')}</select></label>
          <label>Subject<input class="tin" id="wSubj" maxlength="40" placeholder="e.g. PSHE"></label>
          <label>Your name<input class="tin" id="wAuth" maxlength="40" placeholder="Shown on the lesson" value="${esc(authorName())}"></label>
          <label class="wide">Learning objective <small>(optional: the AI can write one)</small><input class="tin" id="wObj" maxlength="240" placeholder="I can…"></label>
          <label class="wide">Anything you’d like? <small>(for the AI)</small><input class="tin" id="wNotes" maxlength="400" placeholder="e.g. include a word sort and a 5-question quiz at the end"></label>
        </div>
      </section>
      <section class="wcard1 wgo">
        <button class="bigchoice ai" id="goAI"><span>✨</span><b>Draft it with AI</b><small>${MODE === 'live' ? 'Free Cloudflare AI adds activities between your slides. You check and edit it next.' : 'Needs the Cloudflare version.'}</small></button>
        <button class="bigchoice hand" id="goHand"><span>🛠</span><b>Build it myself</b><small>Start with your slides in order, then add activities.</small></button>
        <p class="err" id="wErr"></p>
      </section>
    </main>
  </div>`;
  $('#wBack').onclick = () => showHub();
  const statS = $('#statS'), statP = $('#statP');
  const drawThumbs = () => {
    $('#thumbs').innerHTML = W.slides.map((s, i) => `<div class="thumb"><img src="${esc(s.src)}" alt=""><span class="tn">${i + 1}</span><button class="x" data-i="${i}" title="Remove">✕</button></div>`).join('');
    $$('#thumbs .x').forEach((b) => (b.onclick = () => { W.slides.splice(+b.dataset.i, 1); drawThumbs(); }));
  };
  const addSlides = async (files) => {
    if (W.busy || !files.length) return;
    W.busy = true;
    statS.className = 'wstatus busy';
    const prog = (t) => (statS.textContent = t);
    try {
      let got = [];
      for (const f of files) {
        if (/\.pdf$/i.test(f.name)) got = got.concat(await pdfSlides(f, prog));
        else if (/\.pptx$/i.test(f.name)) got = got.concat(await pptxSlides(f, prog));
      }
      const imgs = [...files].filter((f) => /^image\//.test(f.type));
      if (imgs.length) got = got.concat(await imageSlides(imgs, prog));
      for (let i = 0; i < got.length; i++) {
        prog(`Saving slide ${i + 1} of ${got.length}…`);
        const src = await API.media(got[i].blob);
        W.slides.push({ src, text: got[i].text });
        drawThumbs();
      }
      statS.className = 'wstatus ok';
      statS.textContent = got.length ? `✓ ${W.slides.length} slides ready.` : 'No slides found in that file.';
      if (!$('#wTitle').value && W.slides[0] && W.slides[0].text) $('#wTitle').value = W.slides[0].text.split('\n')[0].slice(0, 80);
    } catch (e) {
      statS.className = 'wstatus bad';
      statS.textContent = 'Sorry, that file couldn’t be read. Try saving it as a PDF.';
    }
    W.busy = false;
  };
  const addPlan = async (f) => {
    statP.className = 'wstatus busy'; statP.textContent = 'Reading your plan…';
    try {
      let t = '';
      if (/\.pdf$/i.test(f.name)) t = await pdfText(f);
      else if (/\.docx$/i.test(f.name)) t = await docxText(f);
      else if (/\.pptx$/i.test(f.name)) t = await pptxText(f);
      else t = await f.text();
      $('#planT').value = t;
      statP.className = 'wstatus ok'; statP.textContent = `✓ Read ${f.name} (${t.split(/\s+/).length} words). You can edit it below.`;
    } catch { statP.className = 'wstatus bad'; statP.textContent = 'Sorry, that file couldn’t be read. Try pasting the text instead.'; }
  };
  const wireDrop = (lab, input, fn) => {
    input.onchange = () => { fn([...input.files]); input.value = ''; };
    lab.ondragover = (e) => { e.preventDefault(); lab.classList.add('over'); };
    lab.ondragleave = () => lab.classList.remove('over');
    lab.ondrop = (e) => { e.preventDefault(); lab.classList.remove('over'); fn([...e.dataTransfer.files]); };
  };
  wireDrop($('#dropS'), $('#fileS'), addSlides);
  wireDrop($('#dropP'), $('#fileP'), (fs) => fs[0] && addPlan(fs[0]));
  const info = () => {
    const author = $('#wAuth').value.trim();
    if (author) lstore.set('ilp-author', author);
    return { title: $('#wTitle').value.trim(), year: $('#wYear').value, subject: $('#wSubj').value.trim(), objective: $('#wObj').value.trim(), notes: $('#wNotes').value.trim(), author, plan: $('#planT').value.trim() };
  };
  const err = (t) => ($('#wErr').textContent = t);
  $('#goHand').onclick = () => {
    if (W.busy) return err('Please wait for your slides to finish loading.');
    const I = info();
    const L = baseLesson(I, W.slides);
    L.slides = [titleStep(I, W.slides), ...W.slides.slice(1).map((s, i) => imgStep(s, i + 2))];
    if (!W.slides.length) L.slides.push({ id: 'x' + rnd(5), type: 'respond', title: 'Type your first question here' });
    showEditor(L, true);
  };
  $('#goAI').disabled = MODE !== 'live';
  $('#goAI').onclick = async () => {
    if (W.busy) return err('Please wait for your slides to finish loading.');
    const I = info();
    if (!I.plan && !W.slides.some((s) => s.text)) return err('Add a lesson plan (or slides with text) so the AI has something to work from.');
    err('');
    const m = modal(`<div class="ai-wait"><div class="spinner"></div><h2>Planning your lesson…</h2><p class="muted">This usually takes 20 to 60 seconds.</p></div>`);
    modalEl.onclick = null;
    try {
      const j = await API.generate({ ...I, slides: W.slides.map((s) => ({ text: s.text })) });
      closeModal();
      showEditor(lessonFromDraft(j.draft, I, W.slides), true);
      toast('Draft ready. Check each step before you use it.', 'good');
    } catch (e) {
      closeModal();
      err(e.code === 'noai' ? 'AI isn’t switched on for this app yet. See the setup guide, or build it yourself.' : 'The AI couldn’t make a draft this time (the free daily allowance may be used up). Try again, or build it yourself.');
    }
  };
}

function baseLesson(I, slides) {
  return { id: slugify(I.title), title: I.title || 'Untitled lesson', subject: [I.subject, I.year].filter(Boolean).join(' · '), objective: I.objective || '', author: I.author || '', created: Date.now(), media: slides.map((s) => ({ src: s.src, text: (s.text || '').slice(0, 300) })), slides: [] };
}
const firstLine = (t) => String(t || '').split('\n').map((x) => x.trim()).find((x) => x && !/^Notes:/.test(x)) || '';
function titleStep(I, slides) { return { id: 's1', type: 'title', title: I.title || firstLine(slides[0] && slides[0].text) || 'Our lesson', sub: I.objective || '', src: slides[0] ? slides[0].src : undefined }; }
function imgStep(s, n) { return { id: 'i' + rnd(6), type: 'image', title: firstLine(s.text).slice(0, 80) || 'Slide ' + n, src: s.src }; }

function lessonFromDraft(d, I, slides) {
  const L = baseLesson({ ...I, title: I.title || d.title, objective: I.objective || d.objective }, slides);
  const steps = [];
  const used = new Set();
  const addSlide = (n) => {
    if (!(n >= 1 && n <= slides.length) || used.has(n)) return;
    for (let m = 1; m < n; m++) if (!used.has(m)) { used.add(m); steps.push(m === 1 ? null : imgStep(slides[m - 1], m)); }
    used.add(n);
    steps.push(n === 1 ? null : imgStep(slides[n - 1], n));
  };
  const s = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
  const list = (a, n, k = 60) => (Array.isArray(a) ? a : []).map((x) => s(x, k)).filter(Boolean).slice(0, n);
  for (const st of d.steps || []) {
    if (st.type === 'slide') { addSlide(st.n | 0); continue; }
    const base = { id: 'a' + rnd(6), type: st.type, title: s(st.title, 200) || 'Question' };
    if (st.hint) base.hint = s(st.hint, 200);
    if (st.timer) base.timer = Math.max(30, Math.min(1800, st.timer | 0));
    if (st.type === 'poll') { base.options = list(st.options, 8); if (base.options.length < 2) base.options = ['Yes', 'No', 'Not sure']; }
    if (st.type === 'quiz') { base.options = list(st.options, 6); if (base.options.length < 2) continue; base.answer = Math.max(0, Math.min(base.options.length - 1, st.answer | 0)); if (st.explain) base.explain = s(st.explain, 200); }
    if (st.type === 'split') { base.left = s(st.left, 40) || 'Yes'; base.right = s(st.right, 40) || 'No'; }
    if (st.type === 'cloud') base.max = 3;
    if (st.type === 'scale') { base.min = st.min === 0 ? 0 : 1; base.max = st.max >= 3 && st.max <= 10 ? st.max : 5; base.left = s(st.left, 30) || 'Not at all'; base.right = s(st.right, 30) || 'Very much'; }
    if (st.type === 'rank') { base.items = list(st.items, 10); if (base.items.length < 2) continue; }
    if (st.type === 'sort') { base.items = list(st.items, 20, 50); base.groups = list(st.groups, 4, 30); if (base.items.length < 2) continue; if (base.groups.length < 2) base.groups = ['Yes', 'No']; }
    if (st.type === 'cases') {
      base.cases = (Array.isArray(st.cases) ? st.cases : []).slice(0, 6).map((c, i) => ({ id: 'c' + (i + 1), e: '📁', name: s(c && c.name, 40) || 'Case ' + (i + 1), text: s(c && c.text, 400) })).filter((c) => c.text);
      if (!base.cases.length) continue;
    }
    steps.push(base);
  }
  for (let m = 1; m <= slides.length; m++) if (!used.has(m)) { used.add(m); steps.push(m === 1 ? null : imgStep(slides[m - 1], m)); }
  L.slides = [titleStep({ ...I, title: L.title, objective: L.objective }, slides), ...steps.filter(Boolean)];
  return L;
}

/* ---------- editor ---------- */
function showEditor(lesson, isNew = false) {
  PL.lesson = lesson;
  PL.sel = 0;
  PL.dirty = !!isNew;
  if (!lesson.media) lesson.media = lesson.slides.filter((s) => s.src).map((s) => ({ src: s.src }));
  document.body.className = 'hub-mode editor-mode';
  setTheme(0);
  app.innerHTML = `
  <div class="ed">
    <header class="ed-top">
      <button class="ghost" id="eBack">← Library</button>
      <input class="ed-title" id="eTitle" maxlength="80" value="${esc(lesson.title)}" aria-label="Lesson title">
      <span class="ed-state" id="eState"></span>
      <span class="spacer"></span>
      <button class="ghost" id="eInfo">⚙️ Details</button>
      <button class="primary" id="eSave">Save</button>
      <button class="primary run" id="eRun">▶ Run lesson</button>
    </header>
    <div class="ed-body">
      <aside class="ed-list" id="eList"></aside>
      <main class="ed-pane" id="ePane"></main>
    </div>
  </div>`;
  $('#eTitle').oninput = () => { lesson.title = $('#eTitle').value; markDirty(); };
  $('#eBack').onclick = () => (PL.dirty ? confirmBox('Leave without saving your changes?', 'Leave', () => showHub(), true) : showHub());
  $('#eSave').onclick = () => saveLesson();
  $('#eRun').onclick = async () => { if (await saveLesson()) API.run(lesson.id, lesson).catch(() => toast('Couldn’t start the lesson. Try again.')); };
  $('#eInfo').onclick = () => lessonDetails();
  drawList();
  drawPane();
  markDirty(PL.dirty);
}
function markDirty(on = true) {
  PL.dirty = on;
  const st = $('#eState');
  if (st) { st.textContent = on ? 'Not saved' : '✓ Saved'; st.className = 'ed-state ' + (on ? 'dirty' : 'ok'); }
}
async function saveLesson() {
  const L = PL.lesson;
  if (!L.title.trim()) { toast('Give the lesson a title first.'); $('#eTitle').focus(); return false; }
  try {
    L.cover = (L.slides.find((s) => s.src) || {}).src || '';
    L.slides = normaliseLesson({ ...L }, '').slides.map((x, i) => ({ ...L.slides[i], id: x.id }));
    await API.save(L);
    markDirty(false);
    toast('Saved ✓', 'good');
    return true;
  } catch (e) {
    toast(e.code === 'toobig' ? 'This lesson is too big to save. Remove some slides.' : e.code === 'badcode' ? 'Please sign in again.' : 'Couldn’t save. Check the connection and try again.');
    return false;
  }
}
function lessonDetails() {
  const L = PL.lesson;
  const m = modal(`
    <h2>Lesson details</h2>
    <div class="fgrid">
      <label class="wide">Title<input class="tin" id="dT" maxlength="80" value="${esc(L.title)}"></label>
      <label>Subject / year<input class="tin" id="dS" maxlength="60" value="${esc(L.subject || '')}"></label>
      <label>Made by<input class="tin" id="dA" maxlength="40" value="${esc(L.author || '')}"></label>
      <label class="wide">Learning objective<input class="tin" id="dO" maxlength="240" value="${esc(L.objective || '')}" placeholder="I can…"></label>
    </div>
    <div class="mrow"><button class="ghost" data-close>Cancel</button><button class="primary" id="dOk">Done</button></div>`, 'wide');
  $('#dOk', m).onclick = () => {
    L.title = $('#dT', m).value.trim() || L.title; L.subject = $('#dS', m).value.trim(); L.author = $('#dA', m).value.trim(); L.objective = $('#dO', m).value.trim();
    const t = L.slides.find((s) => s.type === 'title'); if (t && !t.sub) t.sub = L.objective;
    $('#eTitle').value = L.title; closeModal(); markDirty(); drawList(); drawPane();
  };
}
function stepLabel(s) { return (ACT_INFO[s.type] || ['•', s.type])[1]; }
function drawList() {
  const L = PL.lesson;
  const box = $('#eList');
  box.innerHTML = `<div class="el-h">Lesson steps <small>${L.slides.length}</small></div>` + L.slides.map((s, i) => `
    <div class="el-item ${i === PL.sel ? 'on' : ''} ${s.type === 'image' || s.type === 'title' ? 'teach' : 'act'}" data-i="${i}">
      <span class="el-n">${i + 1}</span>
      ${s.src && (s.type === 'image' || s.type === 'title' || s.type === 'tap') ? `<img src="${esc(s.src)}" alt="" loading="lazy">` : `<span class="el-ic">${(ACT_INFO[s.type] || ['•'])[0]}</span>`}
      <span class="el-t"><small>${esc(stepLabel(s))}${s.timer ? ' · ⏱' : ''}</small>${esc(s.title)}</span>
      <span class="el-b"><button data-m="up" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button data-m="dn" title="Move down" ${i === L.slides.length - 1 ? 'disabled' : ''}>▼</button></span>
    </div>
    <button class="el-add" data-after="${i}" title="Add a step here">＋</button>`).join('');
  $$('.el-item', box).forEach((el) => (el.onclick = (e) => {
    const i = +el.dataset.i;
    const mv = e.target.dataset.m;
    if (mv) {
      const j = mv === 'up' ? i - 1 : i + 1;
      [L.slides[i], L.slides[j]] = [L.slides[j], L.slides[i]];
      PL.sel = j; markDirty(); drawList(); drawPane(); return;
    }
    PL.sel = i; drawList(); drawPane();
  }));
  $$('.el-add', box).forEach((b) => (b.onclick = () => addStepMenu(+b.dataset.after, b)));
  const on = $('.el-item.on', box); if (on) on.scrollIntoView({ block: 'nearest' });
}
function addStepMenu(after, anchor) {
  const L = PL.lesson;
  popMenu(anchor, `<div class="tm-head">Add after step ${after + 1}</div>
    <button data-t="image"><span>🖼️</span>Teaching slide</button>
    ${ACT_TYPES.map((t) => `<button data-t="${t}"><span>${ACT_INFO[t][0]}</span><span class="am"><b>${ACT_INFO[t][1]}</b><small>${ACT_INFO[t][2]}</small></span></button>`).join('')}`, (menu) => {
    $$('[data-t]', menu).forEach((b) => (b.onclick = () => {
      const st = newStep(b.dataset.t);
      L.slides.splice(after + 1, 0, st);
      PL.sel = after + 1; closeMenu(); markDirty(); drawList(); drawPane();
    }));
  });
  if (menuEl) { const r = anchor.getBoundingClientRect(); menuEl.style.left = r.right + 8 + 'px'; menuEl.style.right = 'auto'; menuEl.style.top = Math.max(8, Math.min(r.top, innerHeight - menuEl.offsetHeight - 8)) + 'px'; menuEl.classList.add('wide-menu'); }
}
function newStep(type, old) {
  const s = { id: 'a' + rnd(6), type, title: (old && old.title) || '' };
  const pool = PL.lesson.media;
  switch (type) {
    case 'image': s.src = (old && old.src) || (pool[0] || {}).src; s.title = s.title || 'Teaching slide'; break;
    case 'respond': s.title ||= 'What do you think…?'; break;
    case 'split': s.title ||= 'Sort your ideas'; s.left = 'Yes'; s.right = 'No'; break;
    case 'poll': s.title ||= 'Which do you choose?'; s.options = ['Option A', 'Option B', 'Option C']; break;
    case 'quiz': s.title ||= 'Quiz question'; s.options = ['Right answer', 'Wrong answer', 'Wrong answer']; s.answer = 0; break;
    case 'cloud': s.title ||= 'In one word…'; s.max = 3; break;
    case 'scale': s.title ||= 'How much do you agree?'; s.min = 1; s.max = 5; s.left = 'Not at all'; s.right = 'Completely'; break;
    case 'rank': s.title ||= 'Put these in order'; s.hint = 'Most important at the top.'; s.items = ['First thing', 'Second thing', 'Third thing']; break;
    case 'sort': s.title ||= 'Sort these cards'; s.hint = 'Tap a card, then tap where it belongs.'; s.items = ['Card 1', 'Card 2', 'Card 3', 'Card 4']; s.groups = ['Group A', 'Group B']; s.timer = 180; break;
    case 'cases': s.title ||= 'Case files'; s.cases = [{ id: 'c1', e: '📁', name: 'Case 1', text: 'Describe the first scenario here.' }, { id: 'c2', e: '📁', name: 'Case 2', text: 'Describe the second scenario here.' }]; s.timer = 600; break;
    case 'draw': s.title ||= 'Draw…'; s.timer = 240; break;
    case 'tap': s.title ||= 'Tap the picture where…'; s.src = (old && old.src) || (pool[0] || {}).src; break;
  }
  if (old && old.timer && !s.timer) s.timer = old.timer;
  return s;
}

/* field builders */
const F = {
  text: (k, label, v, ph = '', max = 200) => `<label class="ef">${label}<input class="tin" data-k="${k}" maxlength="${max}" value="${esc(v || '')}" placeholder="${esc(ph)}"></label>`,
  area: (k, label, v, ph = '', rows = 2, max = 400) => `<label class="ef">${label}<textarea class="tin" data-k="${k}" rows="${rows}" maxlength="${max}" placeholder="${esc(ph)}">${esc(v || '')}</textarea></label>`,
  lines: (k, label, arr, help, rows = 5) => `<label class="ef">${label} <small>${help}</small><textarea class="tin" data-lines="${k}" rows="${rows}">${esc((arr || []).join('\n'))}</textarea></label>`,
  num: (k, label, v, min, max) => `<label class="ef sm">${label}<input class="tin" type="number" data-num="${k}" min="${min}" max="${max}" value="${v ?? ''}"></label>`,
  check: (k, label, v) => `<label class="ef chk"><input type="checkbox" data-chk="${k}" ${v ? 'checked' : ''}> ${label}</label>`,
  timer: (v) => `<label class="ef sm">Suggested timer<select class="tin" data-timer>${TIMER_OPTS.map(([t, l]) => `<option value="${t}" ${(v || 0) === t ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`,
};
function imagePicker(cur) {
  const pool = PL.lesson.media || [];
  return `<div class="ef">Picture <small>choose one of your slides, or upload a new picture</small>
    <div class="pick-grid">${pool.map((m, i) => `<button class="pk ${m.src === cur ? 'on' : ''}" data-src="${i}"><img src="${esc(m.src)}" alt="Slide ${i + 1}" loading="lazy"><span>${i + 1}</span></button>`).join('')}
    <label class="pk up"><input type="file" accept="image/*,.pdf" hidden id="upPic"><span>＋<small>Upload</small></span></label></div></div>`;
}
function drawPane() {
  const L = PL.lesson;
  const pane = $('#ePane');
  const s = L.slides[PL.sel];
  if (!s) { pane.innerHTML = ''; return; }
  const info = ACT_INFO[s.type] || ['•', s.type, ''];
  const isAct = ACT_TYPES.includes(s.type);
  let f = '';
  switch (s.type) {
    case 'title': f = F.text('title', 'Title', s.title) + F.area('sub', 'Objective shown under the title', s.sub, 'I can…', 2) + imagePicker(s.src); break;
    case 'image': f = F.text('title', 'Name in the slide list', s.title) + imagePicker(s.src); break;
    case 'respond': f = F.area('title', 'Question', s.title, '', 2) + F.text('hint', 'Hint (optional)', s.hint) + F.check('anon', 'Anonymous: no names on the class board', s.anon); break;
    case 'split': f = F.area('title', 'Question', s.title, '', 2) + `<div class="ef-row">${F.text('left', 'Left column', s.left, '', 40)}${F.text('right', 'Right column', s.right, '', 40)}</div>`; break;
    case 'poll': f = F.area('title', 'Question', s.title, '', 2) + F.lines('options', 'Options', s.options, 'one per line, up to 8') + F.text('hint', 'Hint (optional)', s.hint); break;
    case 'quiz': f = F.area('title', 'Question', s.title, '', 2) + `<div class="ef">Answers <small>tick the right one</small><div class="qopts">${(s.options || []).map((o, i) => `<div class="qo"><input type="radio" name="qa" data-qa="${i}" ${s.answer === i ? 'checked' : ''} aria-label="Correct answer"><input class="tin" data-qo="${i}" maxlength="60" value="${esc(o)}"><button class="x" data-qd="${i}" title="Remove">✕</button></div>`).join('')}</div>${(s.options || []).length < 6 ? '<button class="ghost sm" id="qAdd">＋ Add an answer</button>' : ''}</div>` + F.text('explain', 'Why it’s right (shown after you reveal)', s.explain); break;
    case 'cloud': f = F.area('title', 'Question', s.title, '', 2) + F.text('hint', 'Hint (optional)', s.hint) + F.num('max', 'Words per pair', s.max || 3, 1, 6); break;
    case 'scale': f = F.area('title', 'Question', s.title, '', 2) + `<div class="ef-row">${F.num('min', 'From', s.min, 0, 10)}${F.text('left', 'Label for the low end', s.left, '', 30)}</div><div class="ef-row">${F.num('max', 'To', s.max, 1, 20)}${F.text('right', 'Label for the high end', s.right, '', 30)}</div>`; break;
    case 'rank': f = F.area('title', 'Question', s.title, '', 2) + F.text('hint', 'Hint', s.hint) + F.lines('items', 'Items to put in order', s.items, 'one per line, up to 12'); break;
    case 'sort': f = F.area('title', 'Question', s.title, '', 2) + F.text('hint', 'Hint', s.hint) + `<div class="ef-row">${F.lines('items', 'Cards', s.items, 'one per line, up to 20', 7)}${F.lines('groups', 'Groups', s.groups, 'one per line, 2–4', 7)}</div>`; break;
    case 'cases': f = F.area('title', 'Title', s.title, '', 2) + F.text('hint', 'Hint', s.hint) + `<div class="ef">Case files <small>up to 6</small><div class="cedit">${(s.cases || []).map((c, i) => `<div class="ce"><input class="tin ce-e" data-ce="${i}" data-f="e" maxlength="4" value="${esc(c.e || '📁')}" aria-label="Icon"><input class="tin" data-ce="${i}" data-f="name" maxlength="40" value="${esc(c.name)}" placeholder="Name"><textarea class="tin" data-ce="${i}" data-f="text" rows="2" maxlength="400" placeholder="What happened?">${esc(c.text)}</textarea><button class="x" data-cd="${i}" title="Remove">✕</button></div>`).join('')}</div>${(s.cases || []).length < 6 ? '<button class="ghost sm" id="cAdd">＋ Add a case</button>' : ''}</div>`; break;
    case 'draw': f = F.area('title', 'What should they draw?', s.title, '', 2) + F.text('hint', 'Hint', s.hint); break;
    case 'tap': f = F.area('title', 'Question', s.title, '', 2) + F.text('hint', 'Hint', s.hint) + imagePicker(s.src); break;
    default: f = `<p class="muted">This step comes from an example lesson. You can move or delete it, but not edit it here.</p>`;
  }
  pane.innerHTML = `
    <div class="ep-head">
      <span class="ep-ic">${info[0]}</span>
      <div><small>Step ${PL.sel + 1}</small><h2>${esc(info[1])}</h2></div>
      <span class="spacer"></span>
      ${isAct ? `<label class="ef sm inline">Change to<select class="tin" id="eType">${ACT_TYPES.map((t) => `<option value="${t}" ${t === s.type ? 'selected' : ''}>${ACT_INFO[t][1]}</option>`).join('')}</select></label>` : ''}
      <button class="ghost sm" id="eDup" title="Duplicate">⧉ Duplicate</button>
      <button class="ghost sm danger" id="eDel" ${L.slides.length < 2 ? 'disabled' : ''}>🗑 Delete</button>
    </div>
    <div class="ep-grid">
      <div class="ep-form">${f}${s.type !== 'title' && s.type !== 'image' ? F.timer(s.timer) : ''}</div>
      <div class="ep-prev"><div class="pv-h">What pupils see</div><div class="pv-frame"><div class="pv-inner p-main" id="pvMain"></div></div></div>
    </div>`;
  const ch = () => { markDirty(); drawPreview(); clearTimeout(drawPane._t); drawPane._t = setTimeout(() => { const keep = PL.sel; drawListOnly(keep); }, 300); };
  $$('[data-k]', pane).forEach((el) => (el.oninput = () => { s[el.dataset.k] = el.value; ch(); }));
  $$('[data-lines]', pane).forEach((el) => (el.oninput = () => { s[el.dataset.lines] = el.value.split('\n').map((x) => x.trim()).filter(Boolean); ch(); }));
  $$('[data-num]', pane).forEach((el) => (el.oninput = () => { const v = parseInt(el.value, 10); if (Number.isFinite(v)) { s[el.dataset.num] = v; ch(); } }));
  $$('[data-chk]', pane).forEach((el) => (el.onchange = () => { s[el.dataset.chk] = el.checked; ch(); }));
  const tm = $('[data-timer]', pane); if (tm) tm.onchange = () => { const v = +tm.value; if (v) s.timer = v; else delete s.timer; ch(); };
  $$('[data-qa]', pane).forEach((el) => (el.onchange = () => { s.answer = +el.dataset.qa; ch(); }));
  $$('[data-qo]', pane).forEach((el) => (el.oninput = () => { s.options[+el.dataset.qo] = el.value; ch(); }));
  $$('[data-qd]', pane).forEach((el) => (el.onclick = () => { const i = +el.dataset.qd; if (s.options.length <= 2) return toast('A quiz needs at least two answers.'); s.options.splice(i, 1); if (s.answer >= s.options.length) s.answer = 0; else if (s.answer > i) s.answer--; markDirty(); drawPane(); }));
  const qa = $('#qAdd', pane); if (qa) qa.onclick = () => { s.options.push('Another answer'); markDirty(); drawPane(); };
  $$('[data-ce]', pane).forEach((el) => (el.oninput = () => { s.cases[+el.dataset.ce][el.dataset.f] = el.value; ch(); }));
  $$('[data-cd]', pane).forEach((el) => (el.onclick = () => { if (s.cases.length <= 1) return toast('Keep at least one case.'); s.cases.splice(+el.dataset.cd, 1); markDirty(); drawPane(); }));
  const ca = $('#cAdd', pane); if (ca) ca.onclick = () => { s.cases.push({ id: 'c' + rnd(4), e: '📁', name: 'Case ' + (s.cases.length + 1), text: '' }); markDirty(); drawPane(); };
  $$('.pk[data-src]', pane).forEach((b) => (b.onclick = () => { s.src = L.media[+b.dataset.src].src; markDirty(); drawPane(); drawList(); }));
  const up = $('#upPic', pane);
  if (up) up.onchange = async () => {
    const f0 = up.files[0];
    if (!f0) return;
    toast('Adding picture…');
    try {
      const got = /\.pdf$/i.test(f0.name) ? await pdfSlides(f0, () => {}) : await imageSlides([f0], () => {});
      for (const g of got) { const src = await API.media(g.blob); L.media.push({ src, text: g.text }); s.src = src; }
      markDirty(); drawPane(); drawList();
    } catch { toast('That picture couldn’t be added.'); }
  };
  const et = $('#eType', pane); if (et) et.onchange = () => { L.slides[PL.sel] = newStep(et.value, s); markDirty(); drawList(); drawPane(); };
  $('#eDup', pane).onclick = () => { const c = JSON.parse(JSON.stringify(s)); c.id = 'a' + rnd(6); if (c.type === 'title') c.type = 'image'; L.slides.splice(PL.sel + 1, 0, c); PL.sel++; markDirty(); drawList(); drawPane(); };
  $('#eDel', pane).onclick = () => { L.slides.splice(PL.sel, 1); PL.sel = Math.max(0, Math.min(PL.sel, L.slides.length - 1)); markDirty(); drawList(); drawPane(); };
  drawPreview();
}
function drawListOnly(keep) { const sc = $('#eList') && $('#eList').scrollTop; drawList(); PL.sel = keep; if ($('#eList')) $('#eList').scrollTop = sc; }
function drawPreview() {
  const el = $('#pvMain');
  if (!el) return;
  const raw = PL.lesson.slides[PL.sel];
  let sl;
  try { sl = normaliseLesson({ slides: [raw], decks: PL.lesson.decks }, '').slides[0]; } catch { return; }
  const prevLink = P.link;
  if (!P.link) P.link = { send() {}, hello() {}, close() {} };
  try {
    el.innerHTML = '';
    if (PL.lesson.decks) DK = normaliseLesson({ decks: PL.lesson.decks, slides: [] }, '').decks;
    const mount = PUPIL_MOUNT[sl.type] || PUPIL_MOUNT.title;
    NOFOCUS = true;
    const upd = mount(el, sl);
    NOFOCUS = false;
    if (upd) upd({ cur: sl, mine: null, me: { av: '🦊', name: 'Preview' }, focusQ: 0, dealMode: 2, slides: [], quizReveal: false, decks: DK });
  } catch (e) { el.innerHTML = `<p class="muted">Preview not available for this step.</p>`; }
  if (!prevLink) P.link = null;
  el.querySelectorAll('input,textarea,button,select').forEach((x) => { x.tabIndex = -1; });
}

/* ============================== boot ============================== */
async function detectMode() {
  if (window.LVT_FORCE_LOCAL) return 'local';
  if (location.protocol === 'file:') return 'local';
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/ping', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(to);
    const j = await r.json();
    return j && j.app === 'lifevtech' ? 'live' : 'local';
  } catch { return 'local'; }
}

(async function boot() {
  MODE = await detectMode();
  document.documentElement.dataset.mode = MODE;
  const q = new URLSearchParams(location.search);
  const hj = (location.hash.match(/^#join-([a-z]{4})$/i) || [])[1] || '';
  const join = (q.get('join') || hj).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  const savedP = ss.get('lvt-pupil');
  if (savedP && savedP.pairId && (!join || join === savedP.code)) return startPupil(savedP);
  if (join) return showJoin(join);
  showHome();
})();
