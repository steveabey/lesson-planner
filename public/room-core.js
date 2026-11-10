// Live Lessons — shared room logic.
// Runs inside the Cloudflare Durable Object (live lessons) and inside the
// teacher's browser tab (demo mode). Keep it free of DOM / platform APIs.

export const LIFE = [
  { id: 'L1', t: 'Eating a snack', e: '🍎' },
  { id: 'L2', t: 'Walking to school', e: '🚶' },
  { id: 'L3', t: 'Playing a sport', e: '⚽' },
  { id: 'L4', t: 'Doing your homework', e: '📚' },
  { id: 'L5', t: 'Going to sleep', e: '😴' },
  { id: 'L6', t: 'Eating a large meal', e: '🍽️' },
  { id: 'L7', t: 'Doing chores', e: '🧹' },
  { id: 'L8', t: 'Having a bath/shower', e: '🛁' },
  { id: 'L9', t: 'Spending time with my friends', e: '🧑‍🤝‍🧑' },
  { id: 'L10', t: 'Relaxing or calming down', e: '🧘' },
];

export const TECH = [
  { id: 'T1', t: 'Streaming music', e: '🎧' },
  { id: 'T2', t: 'Watching a film', e: '🎬' },
  { id: 'T3', t: 'Playing a video game', e: '🎮' },
  { id: 'T4', t: 'Using an app on a phone', e: '📱' },
  { id: 'T5', t: 'Taking a selfie', e: '🤳' },
  { id: 'T6', t: 'Messaging a friend', e: '💬' },
  { id: 'T7', t: 'Looking at a website', e: '🌐' },
  { id: 'T8', t: 'Using a VR headset', e: '🥽' },
  { id: 'T9', t: 'Livestreaming', e: '📡' },
  { id: 'T10', t: 'Editing a video', e: '🎞️' },
];

export const DEFAULT_DECKS = { life: { name: 'Life', cards: LIFE }, tech: { name: 'Tech', cards: TECH } };

export const PROMPTS = [
  'Can you do both at the same time?',
  'Is it okay to do both at the same time? Why? Why not?',
  'Which one is more important?',
  'Which one takes more time?',
  'How would other people feel if you did those two things at once?',
  'How do these make you feel? How would you feel if you could only pick one?',
];

export const AVATARS = ['🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐙', '🦉', '🐝', '🐢', '🦄', '🐳', '🐧', '🦋', '🐞', '🐬', '🦔', '🐿️', '🦒', '🐘'];
export const OBJECTIVE = 'I can explain how using technology can be a distraction from other things, in both a positive and negative way.';
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
export const MAX_PAIRS = 40;
export const SLIDE_TYPES = ['title', 'image', 'cards', 'respond', 'split', 'poll', 'deal', 'task', 'cloud', 'scale', 'rank', 'sort', 'draw', 'tap', 'quiz', 'cases'];
const VOTE_TYPES = ['poll', 'scale', 'rank', 'sort', 'tap', 'quiz'];
const MAX_RESP_PER_SLIDE = 6;
const MAX_BOARD = 40;
const MAX_BLOB = 450000;

const clone = (o) => JSON.parse(JSON.stringify(o));
const rid = (n = 8) => Math.random().toString(36).slice(2, 2 + n);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function cardIn(decks, id) {
  const d = decks || DEFAULT_DECKS;
  return d.life.cards.find((c) => c.id === id) || d.tech.cards.find((c) => c.id === id) || null;
}

/** Tidy a lesson.json: give slides ids, resolve image paths against the lesson folder. */
export function normaliseLesson(raw, base = '') {
  const L = raw && typeof raw === 'object' ? raw : {};
  const fix = (src) => {
    if (!src || /^(https?:|data:|\/)/.test(src)) return src;
    const out = [];
    for (const p of (base + src).split('/')) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); }
    return out.join('/');
  };
  const mkDeck = (d, key, fallback) => {
    if (!d || !Array.isArray(d.cards) || !d.cards.length) return clone(fallback);
    const pre = key === 'life' ? 'L' : 'T';
    return { name: clean(d.name, 20) || fallback.name, cards: d.cards.slice(0, 30).map((c, i) => ({ id: pre + (i + 1), t: clean(c.t || c.text || c, 40), e: clean(c.e || c.emoji || '•', 8) })) };
  };
  const decks = L.decks ? { life: mkDeck(L.decks.life, 'life', DEFAULT_DECKS.life), tech: mkDeck(L.decks.tech, 'tech', DEFAULT_DECKS.tech) } : clone(DEFAULT_DECKS);
  const seen = new Set();
  const slides = (Array.isArray(L.slides) ? L.slides : []).filter((x) => x && SLIDE_TYPES.includes(x.type)).slice(0, 80).map((x, i) => {
    const sl = clone(x);
    let id = clean(sl.id, 20) || 'x' + (i + 1);
    while (seen.has(id)) id += '_';
    seen.add(id);
    sl.id = id;
    if (sl.src) sl.src = fix(sl.src);
    sl.title = clean(sl.title, 200) || ' ';
    if (sl.type === 'poll' || sl.type === 'quiz') sl.options = (sl.options || ['Yes', 'No']).map((o) => clean(o, 60)).slice(0, 12);
    if (sl.type === 'rank') sl.items = (sl.items || []).map((o) => clean(o, 50)).slice(0, 12);
    if (sl.type === 'sort') sl.items = (sl.items || []).map((o) => clean(o, 50)).slice(0, 20);
    if (sl.type === 'cases') {
      sl.cases = (sl.cases || []).slice(0, 8).map((c, k) => ({ id: clean(c.id, 12) || 'c' + (k + 1), name: clean(c.name, 40) || 'Case ' + (k + 1), e: clean(c.e || '📁', 8), text: clean(c.text, 400) }));
      sl.prompts = (sl.prompts || ['What happened?', 'How was respect lacking?', 'How do the people involved feel?', 'How could it be handled differently?']).map((x) => clean(x, 100)).slice(0, 6);
      sl.scaleLabels = (sl.scaleLabels || ['Minor slip-up', 'Not great', 'Unkind', 'Harmful', 'Serious breach']).map((x) => clean(x, 30)).slice(0, 5);
    }
    if (sl.type === 'sort') sl.groups = (sl.groups || ['Yes', 'No']).map((o) => clean(o, 40)).slice(0, 4);
    if (sl.type === 'scale') { sl.min = Number.isFinite(sl.min) ? sl.min : 1; sl.max = Number.isFinite(sl.max) ? sl.max : 10; if (sl.max <= sl.min) sl.max = sl.min + 1; }
    if (sl.type === 'quiz') sl.answer = clamp(sl.answer | 0, 0, sl.options.length - 1);
    if (sl.type === 'cloud') sl.max = clamp(sl.max | 0 || 3, 1, 6);
    if (sl.timer) sl.timer = clamp(sl.timer | 0, 10, 3600);
    return sl;
  });
  if (!slides.length) slides.push({ id: 's1', type: 'title', title: clean(L.title, 80) || 'Lesson' });
  return {
    id: clean(L.id, 40) || 'lesson',
    title: clean(L.title, 80) || 'Lesson',
    objective: clean(L.objective, 240),
    decks,
    slides,
  };
}

export function freshState(code, teacherKey, lesson) {
  const L = lesson && lesson.slides ? lesson : normaliseLesson({ title: 'Lesson' });
  return {
    v: 2, code, teacherKey,
    created: Date.now(), last: Date.now(),
    lessonId: L.id, lessonTitle: L.title, objective: L.objective,
    decks: L.decks, slides: clone(L.slides), slide: 0,
    frozen: false, flash: null, timer: null,
    spotlight: null, share: false,
    reveal: false, hideNames: false, chime: true,
    dealMode: 2, focusQ: 0,
    pairs: {}, responses: {}, polls: {}, deals: {}, tasks: {}, drawings: {}, quizReveal: {}, cases: {},
    ended: false,
  };
}

export class RoomCore {
  /**
   * io.send(cid,msg) required. Optional: io.persist(state), io.saveBlob(id,data), io.dropBlob(id)
   */
  constructor(io) {
    this.io = io;
    this.clients = new Map(); // cid -> { role, pairId, sent:Set }
    this.state = null;
    this.blobs = new Map();
    this._timer = null;
    this._tt = null;
  }

  load(state, blobs) {
    this.state = state;
    if (blobs) for (const [k, v] of blobs) this.blobs.set(k, v);
    this.armTimer();
  }

  connect(cid) { this.clients.set(cid, { role: null, pairId: null, sent: new Set() }); }

  disconnect(cid) {
    const c = this.clients.get(cid);
    this.clients.delete(cid);
    if (c && c.role) this.schedule();
  }

  online() {
    const set = new Set();
    for (const c of this.clients.values()) if (c.role === 'pupil' && c.pairId) set.add(c.pairId);
    return set;
  }

  currentSlide() { return this.state.slides[this.state.slide]; }

  message(cid, raw) {
    let m;
    try { m = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return; }
    if (!m || typeof m !== 'object') return;
    const c = this.clients.get(cid);
    if (!c || !this.state) return;
    try {
      if (m.t === 'hello') return this.hello(cid, c, m);
      if (m.t === 'ping') return this.io.send(cid, { t: 'pong', now: Date.now() });
      if (!c.role) return;
      if (c.role === 'teacher') this.teacherAct(c, m);
      else this.pupilAct(c, m);
      this.state.last = Date.now();
      this.schedule();
    } catch (e) {
      this.io.send(cid, { t: 'error', e: 'bad', detail: String((e && e.message) || e) });
    }
  }

  hello(cid, c, m) {
    const s = this.state;
    if (m.role === 'teacher') {
      if (m.key !== s.teacherKey) return this.io.send(cid, { t: 'error', e: 'badkey' });
      c.role = 'teacher'; c.sent = new Set();
      this.io.send(cid, { t: 'welcome', role: 'teacher' });
      return this.flush(cid);
    }
    if (s.ended) return this.io.send(cid, { t: 'error', e: 'ended' });
    let pairId = clean(m.pairId, 20);
    if (!pairId && c.pairId && s.pairs[c.pairId]) pairId = c.pairId; // repeated hello from same connection
    let p = pairId && s.pairs[pairId];
    if (!p) {
      const name = clean(m.name, 32);
      if (!name) return this.io.send(cid, { t: 'error', e: 'noname' });
      if (Object.keys(s.pairs).length >= MAX_PAIRS) return this.io.send(cid, { t: 'error', e: 'full' });
      pairId = pairId || rid(10);
      const av = AVATARS.includes(m.av) ? m.av : pick(AVATARS);
      p = s.pairs[pairId] = { id: pairId, name, av, joined: Date.now() };
    }
    c.role = 'pupil'; c.pairId = pairId; c.sent = new Set();
    this.io.send(cid, { t: 'welcome', role: 'pupil', pairId, name: p.name, av: p.av });
    s.last = Date.now();
    this.schedule();
  }

  /* ---------- timer ---------- */
  armTimer() {
    clearTimeout(this._tt); this._tt = null;
    const t = this.state && this.state.timer;
    if (!t || t.paused || t.done) return;
    this._tt = setTimeout(() => this.expire(), Math.max(0, t.end - Date.now()) + 40);
  }
  expire() {
    const s = this.state;
    const t = s && s.timer;
    if (!t || t.paused || t.done) return;
    if (Date.now() < t.end - 60) return this.armTimer();
    t.done = true; t.end = Date.now();
    if (t.freeze !== false) {
      s.frozen = true;
      s.flash = { text: 'Time’s up!', id: rid(6), at: Date.now() };
    }
    this.schedule();
  }

  teacherAct(c, m) {
    const s = this.state;
    const now = Date.now();
    switch (m.a) {
      case 'goto': {
        const i = clamp(m.i | 0, 0, s.slides.length - 1);
        if (i !== s.slide) { s.slide = i; s.reveal = false; s.share = false; }
        break;
      }
      case 'freeze':
        s.frozen = !!m.on;
        if (!m.on) { s.flash = null; if (s.timer && s.timer.done) s.timer = null; }
        break;
      case 'flash': s.flash = { text: clean(m.text, 60) || 'Time to listen', id: rid(6), at: now }; s.frozen = true; break;
      case 'timer': {
        const sec = clamp(Math.round(+m.sec || 0), 5, 3600);
        s.timer = { id: rid(6), dur: sec * 1000, end: now + sec * 1000, paused: false, left: null, done: false, freeze: m.freeze !== false };
        if (s.frozen && !s.flash) s.frozen = false;
        this.armTimer();
        break;
      }
      case 'timerPause': {
        const t = s.timer;
        if (!t || t.done) break;
        if (!t.paused) { t.left = Math.max(0, t.end - now); t.paused = true; }
        else { t.end = now + (t.left || 0); t.paused = false; t.left = null; }
        this.armTimer();
        break;
      }
      case 'timerAdd': {
        const t = s.timer;
        if (!t) break;
        const add = clamp(Math.round(+m.sec || 30), 5, 600) * 1000;
        if (t.done) {
          t.done = false; t.end = now + add; t.dur = add;
          if (s.flash && /Time/.test(s.flash.text)) { s.flash = null; s.frozen = false; }
        } else {
          if (t.paused) t.left += add; else t.end += add;
          t.dur += add;
        }
        this.armTimer();
        break;
      }
      case 'timerCancel': s.timer = null; this.armTimer(); break;
      case 'spotlight': s.spotlight = m.pairId && s.pairs[m.pairId] ? m.pairId : null; if (!s.spotlight) s.share = false; break;
      case 'share': s.share = !!m.on && !!s.spotlight; break;
      case 'reveal': s.reveal = !!m.on; break;
      case 'hideNames': s.hideNames = !!m.on; break;
      case 'chime': s.chime = !!m.on; break;
      case 'dealMode': s.dealMode = m.n === 3 ? 3 : 2; break;
      case 'focusQ': s.focusQ = clamp(m.i | 0, 0, PROMPTS.length - 1); break;
      case 'quizReveal': { const sl = this.currentSlide(); if (sl.type === 'quiz') s.quizReveal[sl.id] = !!m.on; break; }
      case 'hideResp': {
        const r = (s.responses[m.slideId] || []).find((x) => x.id === m.id);
        if (r) r.hidden = !r.hidden;
        break;
      }
      case 'hideWord': {
        const w = clean(m.word, 40).toLowerCase();
        for (const r of s.responses[m.slideId] || []) if (r.text.toLowerCase() === w) r.hidden = !m.show;
        break;
      }
      case 'hideDrawing': {
        const d = (s.drawings[m.slideId] || {})[m.pairId];
        if (d) d.hidden = !d.hidden;
        break;
      }
      case 'hideBoard': {
        const d = s.deals[m.pairId];
        const b = d && d.board.find((x) => x.id === m.id);
        if (b) b.hidden = !b.hidden;
        break;
      }
      case 'caseAssign': {
        const sl = this.currentSlide();
        if (sl.type !== 'cases' || !sl.cases.length) break;
        const C = (s.cases ||= {});
        const counts = Object.fromEntries(sl.cases.map((c) => [c.id, 0]));
        for (const w of Object.values(C)) if (w.slide === sl.id && counts[w.c] != null) counts[w.c]++;
        const pairs = Object.values(s.pairs).sort((a, b) => a.joined - b.joined);
        for (const p of pairs) {
          const w = C[p.id];
          if (w && w.slide === sl.id && w.c) continue;
          const pickC = sl.cases.map((c) => c.id).sort((a, b) => counts[a] - counts[b])[0];
          counts[pickC]++;
          C[p.id] = { slide: sl.id, c: pickC, sev: null, dos: [], donts: [] };
        }
        break;
      }
      case 'caseHide': {
        const w = (s.cases || {})[m.pairId];
        const list = w && (m.kind === 'dont' ? w.donts : w.dos);
        const it = list && list.find((x) => x.id === m.id);
        if (it) it.hidden = !it.hidden;
        break;
      }
      case 'clearHelp': { const p = s.pairs[m.pairId]; if (p) p.help = false; break; }
      case 'clearLights': for (const p of Object.values(s.pairs)) { p.light = null; p.help = false; } break;
      case 'kick': {
        const id = m.pairId;
        if (!s.pairs[id]) break;
        delete s.pairs[id];
        delete s.deals[id];
        delete s.tasks[id];
        if (s.cases) delete s.cases[id];
        for (const k in s.responses) s.responses[k] = s.responses[k].filter((r) => r.pairId !== id);
        for (const k in s.polls) delete s.polls[k][id];
        for (const k in s.drawings) { const d = s.drawings[k][id]; if (d) { this.dropBlob(d.id); delete s.drawings[k][id]; } }
        if (s.spotlight === id) { s.spotlight = null; s.share = false; }
        for (const [cid, cc] of this.clients) if (cc.pairId === id) { this.io.send(cid, { t: 'error', e: 'removed' }); cc.role = null; cc.pairId = null; }
        break;
      }
      case 'quickQ': {
        const title = clean(m.title, 160);
        if (!title) break;
        const type = ['poll', 'cloud', 'scale', 'respond'].includes(m.type) ? m.type : 'respond';
        const slide = { id: 'q' + rid(6), type, title, quick: true };
        if (type === 'poll') {
          const opts = (Array.isArray(m.options) ? m.options : []).map((o) => clean(o, 40)).filter(Boolean).slice(0, 8);
          slide.options = opts.length >= 2 ? opts : ['Yes', 'No', 'Not sure'];
        }
        if (type === 'cloud') slide.max = 3;
        if (type === 'scale') { slide.min = 1; slide.max = 10; slide.left = clean(m.left, 30) || 'Not at all'; slide.right = clean(m.right, 30) || 'Very much'; }
        s.slides.splice(s.slide + 1, 0, slide);
        s.slide += 1; s.reveal = false; s.share = false;
        break;
      }
      case 'removeSlide': {
        const i = s.slides.findIndex((x) => x.id === m.id);
        if (i < 0 || !s.slides[i].quick) break;
        s.slides.splice(i, 1);
        if (s.slide >= i && s.slide > 0) s.slide -= 1;
        break;
      }
      case 'clearSlide': {
        const sl = this.currentSlide();
        delete s.responses[sl.id];
        delete s.polls[sl.id];
        for (const d of Object.values(s.drawings[sl.id] || {})) this.dropBlob(d.id);
        delete s.drawings[sl.id];
        delete s.quizReveal[sl.id];
        if (sl.type === 'cases' && s.cases) for (const k of Object.keys(s.cases)) if (s.cases[k].slide === sl.id) delete s.cases[k];
        break;
      }
      case 'end': s.ended = true; s.frozen = false; s.flash = null; s.timer = null; this.armTimer(); break;
    }
  }

  dropBlob(id) { this.blobs.delete(id); if (this.io.dropBlob) this.io.dropBlob(id); }

  pupilAct(c, m) {
    const s = this.state;
    const pid = c.pairId;
    const me = s.pairs[pid];
    if (!pid || !me || s.ended) return;
    if (s.frozen || s.flash) return; // screens frozen: ignore input
    const sl = this.currentSlide();
    switch (m.a) {
      case 'help': me.help = !!m.on; break;
      case 'light': me.light = ['green', 'amber', 'red'].includes(m.v) ? m.v : null; break;
      case 'respond': {
        if (m.slideId !== sl.id || !['respond', 'split', 'cloud'].includes(sl.type)) return;
        const text = clean(m.text, sl.type === 'cloud' ? 25 : 160);
        if (!text) return;
        const list = (s.responses[sl.id] ||= []);
        const limit = sl.type === 'cloud' ? sl.max || 3 : MAX_RESP_PER_SLIDE;
        if (list.filter((r) => r.pairId === pid).length >= limit) return;
        const r = { id: rid(8), pairId: pid, text, at: Date.now() };
        if (sl.type === 'split') r.side = m.side === 'right' ? 'right' : 'left';
        list.push(r);
        break;
      }
      case 'unrespond': {
        const list = s.responses[m.slideId];
        if (list) s.responses[m.slideId] = list.filter((r) => !(r.id === m.id && r.pairId === pid));
        break;
      }
      case 'like': {
        if (!s.reveal || m.slideId !== sl.id) return;
        const r = (s.responses[sl.id] || []).find((x) => x.id === m.id);
        if (!r || r.pairId === pid || r.hidden) return;
        r.likes ||= [];
        const i = r.likes.indexOf(pid);
        if (i >= 0) r.likes.splice(i, 1); else r.likes.push(pid);
        break;
      }
      case 'vote': {
        if (m.slideId !== sl.id || !VOTE_TYPES.includes(sl.type)) return;
        let val;
        if (sl.type === 'poll' || sl.type === 'quiz') {
          if (sl.type === 'quiz' && s.quizReveal[sl.id]) return;
          val = m.opt | 0;
          if (val < 0 || val >= sl.options.length) return;
        } else if (sl.type === 'scale') {
          val = Math.round(+m.value);
          if (!Number.isFinite(val)) return;
          val = clamp(val, sl.min, sl.max);
        } else if (sl.type === 'rank') {
          const n = sl.items.length;
          const a = Array.isArray(m.order) ? m.order.map((x) => x | 0) : [];
          if (a.length !== n || new Set(a).size !== n || a.some((x) => x < 0 || x >= n)) return;
          val = a;
        } else if (sl.type === 'sort') {
          const n = sl.items.length;
          const a = Array.isArray(m.groups) ? m.groups.map((x) => (x == null ? -1 : x | 0)) : [];
          if (a.length !== n || a.some((x) => x < -1 || x >= sl.groups.length)) return;
          val = a;
        } else if (sl.type === 'tap') {
          const x = +m.x, y = +m.y;
          if (!Number.isFinite(x) || !Number.isFinite(y)) return;
          val = { x: clamp(Math.round(x * 1000) / 1000, 0, 1), y: clamp(Math.round(y * 1000) / 1000, 0, 1) };
        }
        (s.polls[sl.id] ||= {})[pid] = val;
        break;
      }
      case 'draw': {
        if (m.slideId !== sl.id || sl.type !== 'draw') return;
        const data = String(m.data || '');
        if (!/^data:image\/(png|jpeg|webp|svg\+xml)[;,]/.test(data) || data.length > MAX_BLOB) return;
        const map = (s.drawings[sl.id] ||= {});
        if (map[pid]) this.dropBlob(map[pid].id);
        const id = 'd' + rid(10);
        this.blobs.set(id, data);
        if (this.io.saveBlob) this.io.saveBlob(id, data);
        map[pid] = { id, at: Date.now() };
        break;
      }
      case 'casePick': {
        if (sl.type !== 'cases' || !sl.cases.find((c) => c.id === m.id)) return;
        const C = (s.cases ||= {});
        const w = C[pid];
        if (w && w.slide === sl.id && (w.dos.length || w.donts.length) && w.c !== m.id) return; // keep written work
        C[pid] = { slide: sl.id, c: m.id, sev: w && w.slide === sl.id && w.c === m.id ? w.sev : null, dos: w && w.slide === sl.id && w.c === m.id ? w.dos : [], donts: w && w.slide === sl.id && w.c === m.id ? w.donts : [] };
        break;
      }
      case 'caseUnpick': {
        const w = (s.cases || {})[pid];
        if (w && w.slide === sl.id && !w.dos.length && !w.donts.length) delete s.cases[pid];
        break;
      }
      case 'caseSev': {
        const w = (s.cases || {})[pid];
        if (!w || w.slide !== sl.id) return;
        const v = m.v | 0;
        w.sev = v >= 1 && v <= 5 ? v : null;
        break;
      }
      case 'caseAdd': {
        const w = (s.cases || {})[pid];
        if (!w || w.slide !== sl.id) return;
        const list = m.kind === 'dont' ? w.donts : w.dos;
        const t = clean(m.text, 120);
        if (!t || list.length >= 5) return;
        list.push({ id: rid(6), t });
        break;
      }
      case 'caseDel': {
        const w = (s.cases || {})[pid];
        if (!w) return;
        if (m.kind === 'dont') w.donts = w.donts.filter((x) => x.id !== m.id); else w.dos = w.dos.filter((x) => x.id !== m.id);
        break;
      }
      case 'deal': {
        if (sl.type !== 'deal') return;
        const D = s.decks || DEFAULT_DECKS;
        const d = (s.deals[pid] ||= { cur: null, board: [] });
        const used = new Set(d.board.map((b) => b.cards.map((x) => x.id).sort().join('+')));
        let cards;
        for (let tries = 0; tries < 30; tries++) {
          let nl = 1, nt = 1;
          if (s.dealMode === 3) { if (Math.random() < 0.5) nl = 2; else nt = 2; }
          const ls = shuffle(D.life.cards).slice(0, nl);
          const ts = shuffle(D.tech.cards).slice(0, nt);
          cards = [...ls.map((x) => ({ ...x, k: 'life' })), ...ts.map((x) => ({ ...x, k: 'tech' }))];
          if (!used.has(cards.map((x) => x.id).sort().join('+'))) break;
        }
        d.cur = { cards, at: Date.now(), id: rid(6) };
        break;
      }
      case 'blank': {
        if (sl.type !== 'deal') return;
        const d = (s.deals[pid] ||= { cur: null, board: [] });
        const k = m.k === 'tech' ? 'tech' : 'life';
        const text = clean(m.text, 40);
        if (!text || !d.cur) return;
        const card = { id: 'B' + rid(5), t: text, e: '✏️', k, blank: true };
        const i = d.cur.cards.findIndex((x) => x.k === k);
        if (i >= 0) d.cur.cards[i] = card; else d.cur.cards.push(card);
        d.cur.id = rid(6);
        break;
      }
      case 'decide': {
        const d = s.deals[pid];
        if (!d || !d.cur || sl.type !== 'deal') return;
        const verdict = ['yes', 'depends', 'no'].includes(m.verdict) ? m.verdict : null;
        if (!verdict) return;
        const important = ['life', 'tech', 'same'].includes(m.important) ? m.important : null;
        d.board.unshift({ id: rid(8), cards: d.cur.cards, verdict, important, why: clean(m.why, 200), at: Date.now() });
        d.board = d.board.slice(0, MAX_BOARD);
        d.cur = null;
        break;
      }
      case 'unboard': {
        const d = s.deals[pid];
        if (d) d.board = d.board.filter((b) => b.id !== m.id);
        break;
      }
      case 'task': {
        if (sl.type !== 'task') return;
        const D = s.decks || DEFAULT_DECKS;
        const side = m.side === 'neg' ? 'neg' : 'pos';
        const life = D.life.cards.find((x) => x.id === m.life) ? m.life : null;
        const tech = D.tech.cards.find((x) => x.id === m.tech) ? m.tech : null;
        const why = clean(m.why, 240);
        if (!life || !tech) return;
        (s.tasks[pid] ||= {})[side] = { life, tech, why, at: Date.now() };
        break;
      }
    }
  }

  // ---- views ----
  quizScore(pid) {
    const s = this.state;
    let n = 0;
    for (const sl of s.slides) if (sl.type === 'quiz' && s.quizReveal[sl.id] && s.polls[sl.id] && s.polls[sl.id][pid] === sl.answer) n++;
    return n;
  }

  teacherView() {
    const s = this.state;
    const { teacherKey, ...rest } = s;
    return { ...rest, online: [...this.online()] };
  }

  pairWork(pid, sl) {
    const s = this.state;
    const dr = s.drawings[sl.id] && s.drawings[sl.id][pid];
    return {
      pair: s.pairs[pid],
      responses: (s.responses[sl.id] || []).filter((r) => r.pairId === pid && !r.hidden).map((r) => ({ ...r, likes: (r.likes || []).length })),
      vote: s.polls[sl.id] ? s.polls[sl.id][pid] : undefined,
      drawing: dr && !dr.hidden ? dr.id : null,
      deal: s.deals[pid] ? { cur: s.deals[pid].cur, board: s.deals[pid].board.filter((b) => !b.hidden) } : null,
      task: s.tasks[pid] || null,
      casework: s.cases && s.cases[pid] && s.cases[pid].slide === sl.id ? { ...s.cases[pid], dos: s.cases[pid].dos.filter((x) => !x.hidden), donts: s.cases[pid].donts.filter((x) => !x.hidden) } : null,
    };
  }

  pupilView(pid) {
    const s = this.state;
    const sl = this.currentSlide();
    const me = s.pairs[pid];
    const revealedQuiz = sl.type === 'quiz' && !!s.quizReveal[sl.id];
    const cur = sl.type === 'quiz' && !revealedQuiz ? { ...sl, answer: undefined, explain: undefined } : sl;
    const anon = s.hideNames || !!sl.anon;
    const v = {
      code: s.code, ended: s.ended, lessonTitle: s.lessonTitle, objective: s.objective,
      decks: s.decks,
      slides: s.slides.map((x) => ({ id: x.id, type: x.type, src: x.src })),
      slide: s.slide, cur, total: s.slides.length,
      frozen: s.frozen, flash: s.flash, chime: s.chime, timer: s.timer,
      reveal: s.reveal, hideNames: anon, quizReveal: revealedQuiz,
      dealMode: s.dealMode, focusQ: s.focusQ,
      me, mine: me ? this.pairWork(pid, sl) : null,
      score: this.quizScore(pid), hasQuiz: s.slides.some((x) => x.type === 'quiz'),
      pairCount: Object.keys(s.pairs).length,
    };
    if (s.share && s.spotlight && s.pairs[s.spotlight]) {
      v.spot = this.pairWork(s.spotlight, sl);
      if (anon) v.spot.pair = { ...v.spot.pair, name: 'A pair in our class' };
    }
    if (s.reveal || revealedQuiz) {
      const names = (r) => (anon ? {} : { name: s.pairs[r.pairId]?.name, av: s.pairs[r.pairId]?.av });
      v.wall = (s.responses[sl.id] || []).filter((r) => !r.hidden).map((r) => ({ id: r.id, text: r.text, side: r.side, mine: r.pairId === pid, likes: (r.likes || []).length, liked: (r.likes || []).includes(pid), ...names(r) }));
      const vals = Object.entries(s.polls[sl.id] || {}).map(([k, x]) => (sl.type === 'tap' ? { ...x, mine: k === pid } : x));
      v.agg = vals;
      if (sl.type === 'cases') {
        v.caseBoard = sl.cases.map((c) => {
          const ws = Object.entries(s.cases || {}).filter(([k, w]) => w.slide === sl.id && w.c === c.id && s.pairs[k]);
          const sevs = ws.map(([, w]) => w.sev).filter((x) => x);
          const nm = (k) => (anon ? {} : { name: s.pairs[k].name, av: s.pairs[k].av });
          return {
            id: c.id, n: ws.length, avg: sevs.length ? sevs.reduce((a, b) => a + b, 0) / sevs.length : null,
            dos: ws.flatMap(([k, w]) => w.dos.filter((x) => !x.hidden).map((x) => ({ t: x.t, ...nm(k) }))),
            donts: ws.flatMap(([k, w]) => w.donts.filter((x) => !x.hidden).map((x) => ({ t: x.t, ...nm(k) }))),
          };
        });
      }
      if (sl.type === 'poll' || sl.type === 'quiz') {
        const counts = sl.options.map(() => 0);
        for (const o of vals) counts[o]++;
        v.counts = counts;
      }
    }
    return v;
  }

  neededBlobs(c) {
    const s = this.state;
    const ids = [];
    if (c.role === 'teacher') {
      for (const map of Object.values(s.drawings)) for (const d of Object.values(map)) ids.push(d.id);
    } else if (c.pairId) {
      for (const map of Object.values(s.drawings)) if (map[c.pairId]) ids.push(map[c.pairId].id);
      const sl = this.currentSlide();
      if (s.share && s.spotlight && s.drawings[sl.id] && s.drawings[sl.id][s.spotlight]) ids.push(s.drawings[sl.id][s.spotlight].id);
    }
    return ids;
  }

  schedule() {
    if (this._timer) return;
    this._timer = setTimeout(() => { this._timer = null; this.flush(); }, 60);
  }

  flush(only) {
    if (!this.state) return;
    let tv = null;
    const now = Date.now();
    for (const [cid, c] of this.clients) {
      if (only && cid !== only) continue;
      if (!c.role) continue;
      for (const id of this.neededBlobs(c)) {
        if (c.sent.has(id) || !this.blobs.has(id)) continue;
        c.sent.add(id);
        this.io.send(cid, { t: 'blob', id, data: this.blobs.get(id) });
      }
      if (c.role === 'teacher') this.io.send(cid, { t: 'state', now, s: (tv ||= this.teacherView()) });
      else if (c.pairId) this.io.send(cid, { t: 'state', now, s: this.pupilView(c.pairId) });
    }
    if (!only && this.io.persist) this.io.persist(this.state);
  }
}

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
