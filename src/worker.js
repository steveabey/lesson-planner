// Interactive Lesson Planner — Cloudflare Worker + Durable Objects + Workers AI.
//
//  Room     one Durable Object per live lesson (named by its 4-letter code)
//  Library  one Durable Object holding the school's saved lessons and their pictures
//  env.AI   Cloudflare Workers AI, used to draft a lesson from a plan and slides

import { RoomCore, freshState, normaliseLesson, CODE_CHARS } from '../public/room-core.js';

const IDLE_LIMIT = 4 * 60 * 60 * 1000;
const DEFAULT_TEACHER_CODE = 'walden'; // change by adding a TEACHER_CODE secret in Cloudflare
const AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_MEDIA = 1900 * 1024;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const codeOk = (env, given) => String(given || '').trim().toLowerCase() === String(env.TEACHER_CODE || DEFAULT_TEACHER_CODE).trim().toLowerCase();

function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

const library = (env) => env.LIBRARY.get(env.LIBRARY.idFromName('school-library'));

async function exampleIndex(env, url) {
  const r = await env.ASSETS.fetch(new Request(new URL('/lessons/index.json', url).toString()));
  return r.ok ? r.json() : [];
}

async function loadLesson(env, url, id) {
  const ex = (await exampleIndex(env, url)).find((x) => x.id === id);
  if (ex) {
    const r = await env.ASSETS.fetch(new Request(new URL('/lessons/' + id + '/lesson.json', url).toString()));
    if (!r.ok) return null;
    return normaliseLesson(await r.json(), 'lessons/' + id + '/');
  }
  const r = await library(env).fetch('https://lib/lesson/' + encodeURIComponent(id));
  if (!r.ok) return null;
  return normaliseLesson(await r.json(), '');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    const tcode = req.headers.get('x-teacher-code');

    if (p === '/api/ping') return json({ app: 'lifevtech', planner: true, ai: !!env.AI, ok: true });

    if (p === '/api/check' && req.method === 'POST') {
      return codeOk(env, tcode) ? json({ ok: true }) : json({ error: 'badcode' }, 403);
    }

    // ---- live rooms ----
    if (p === '/api/create' && req.method === 'POST') {
      let body = {};
      try { body = await req.json(); } catch {}
      if (!codeOk(env, body.teacherCode || tcode)) return json({ error: 'badcode' }, 403);
      const lesson = await loadLesson(env, url, String(body.lessonId || '').replace(/[^a-z0-9-]/gi, ''));
      if (!lesson) return json({ error: 'nolesson' }, 404);
      for (let attempt = 0; attempt < 8; attempt++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const r = await stub.fetch('https://room/init?code=' + code, { method: 'POST', body: JSON.stringify(lesson) });
        if (r.status === 200) {
          const { key } = await r.json();
          return json({ code, key });
        }
      }
      return json({ error: 'busy' }, 503);
    }

    if (p === '/ws') {
      const code = String(url.searchParams.get('code') || '').toUpperCase();
      if (!/^[A-Z]{4}$/.test(code)) return new Response('Bad room code', { status: 400 });
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected websocket', { status: 426 });
      return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
    }

    // ---- pictures (public: pupils load them) ----
    if (p.startsWith('/media/') && req.method === 'GET') {
      return library(env).fetch('https://lib' + p);
    }

    // ---- library (teacher code required) ----
    if (p.startsWith('/api/lessons') || p === '/api/media') {
      if (!codeOk(env, tcode)) return json({ error: 'badcode' }, 403);
      if (p === '/api/lessons' && req.method === 'GET') {
        const r = await library(env).fetch('https://lib/list');
        const mine = await r.json();
        const ex = (await exampleIndex(env, url)).map((x) => ({ ...x, cover: x.cover ? 'lessons/' + x.cover : '' }));
        return json({ lessons: mine, examples: ex });
      }
      const m = p.match(/^\/api\/lessons\/([a-z0-9-]{1,40})$/i);
      if (m && req.method === 'GET') {
        const ex = (await exampleIndex(env, url)).find((x) => x.id === m[1]);
        if (ex) {
          const r = await env.ASSETS.fetch(new Request(new URL('/lessons/' + m[1] + '/lesson.json', url).toString()));
          const raw = await r.json();
          const base = 'lessons/' + m[1] + '/';
          const L = normaliseLesson(raw, base);
          return json({ ...raw, slides: L.slides, decks: L.decks, cover: (L.slides.find((x) => x.src) || {}).src, example: true });
        }
        return library(env).fetch('https://lib/lesson/' + m[1]);
      }
      if (m && req.method === 'PUT') return library(env).fetch('https://lib/lesson/' + m[1], { method: 'PUT', body: await req.text() });
      if (m && req.method === 'DELETE') return library(env).fetch('https://lib/lesson/' + m[1], { method: 'DELETE' });
      if (p === '/api/media' && req.method === 'POST') {
        const type = req.headers.get('content-type') || '';
        if (!/^image\/(webp|jpeg|png|gif)$/.test(type)) return json({ error: 'type' }, 415);
        const buf = await req.arrayBuffer();
        if (buf.byteLength > MAX_MEDIA) return json({ error: 'toobig' }, 413);
        return library(env).fetch('https://lib/media', { method: 'POST', headers: { 'content-type': type }, body: buf });
      }
      return json({ error: 'notfound' }, 404);
    }

    // ---- AI draft ----
    if (p === '/api/generate' && req.method === 'POST') {
      if (!codeOk(env, tcode)) return json({ error: 'badcode' }, 403);
      if (!env.AI) return json({ error: 'noai' }, 501);
      let body = {};
      try { body = await req.json(); } catch {}
      try {
        const draft = await draftLesson(env, body);
        return json({ draft });
      } catch (e) {
        return json({ error: 'aifail', detail: String((e && e.message) || e).slice(0, 300) }, 502);
      }
    }

    return env.ASSETS.fetch(req);
  },
};

/* ======================= AI drafting ======================= */
const STEP_TYPES = ['slide', 'respond', 'split', 'poll', 'quiz', 'cloud', 'scale', 'rank', 'sort', 'cases', 'draw'];

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    objective: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: STEP_TYPES },
          n: { type: 'integer' },
          title: { type: 'string' },
          hint: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'integer' },
          explain: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
          groups: { type: 'array', items: { type: 'string' } },
          left: { type: 'string' },
          right: { type: 'string' },
          min: { type: 'integer' },
          max: { type: 'integer' },
          cases: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' } }, required: ['name', 'text'] } },
          timer: { type: 'integer' },
        },
        required: ['type'],
      },
    },
  },
  required: ['title', 'objective', 'steps'],
};

const SYSTEM_PROMPT = `You are an experienced UK primary school teacher planning an interactive lesson.
Pupils work in pairs on laptops or iPads. The teacher shows slides and the pupils respond on their devices.
Build a teaching sequence that mixes the teacher's own slides with short interactive activities taken from the lesson plan.

Step types you may use:
- "slide": show the teacher's slide number n. Use EVERY slide exactly once, in the original order.
- "respond": pairs type short answers to an open question. Fields: title (the question), hint.
- "split": pairs sort their typed answers into two columns. Fields: title, left, right.
- "poll": a vote. Fields: title, options (2-6 short options).
- "quiz": a question with one correct answer. Fields: title, options (3-4), answer (0-based index of the correct option), explain (one sentence why).
- "cloud": a word cloud of short words. Fields: title, hint.
- "scale": a slider rating. Fields: title, min (1), max (5 or 10), left (label for min), right (label for max).
- "rank": put items in order. Fields: title, hint, items (3-8 short items).
- "sort": tap cards into groups. Fields: title, hint, items (4-16 short items), groups (2-3 group names).
- "cases": pairs choose a scenario, rate how serious it is and write DO's and DON'Ts. Fields: title, hint, cases (2-6 items, each {name, text}). Use for scenario or dilemma work.
- "draw": pairs draw a picture. Fields: title, hint.

Rules:
- Use the lesson plan's own questions, vocabulary, scenarios and quiz items wherever possible. Do not invent facts.
- Put an activity after every 1-3 slides, where it fits what the slides have just taught.
- Use a variety of activity types. Include a quiz near the end if the plan has check-for-understanding questions.
- Add "timer" (in seconds) only to longer activities: sort 180-300, cases 600-900, draw 180-300.
- Write in clear, friendly language for the year group, in UK English. Keep titles under 120 characters and options short.
- Never use real children's names other than names that appear in the lesson plan.
- The objective is one "I can..." sentence.
Return only JSON that matches the schema.`;

async function draftLesson(env, b) {
  const clip = (s, n) => String(s || '').replace(/\s+\n/g, '\n').slice(0, n);
  const slides = (Array.isArray(b.slides) ? b.slides : []).slice(0, 60);
  const slideList = slides.map((s, i) => `Slide ${i + 1}: ${clip(s.text, 300).replace(/\s+/g, ' ').trim() || '(picture only, no readable text)'}`).join('\n');
  const user = `Lesson title: ${clip(b.title, 120) || '(not given)'}
Year group: ${clip(b.year, 40) || '(not given)'}
Subject: ${clip(b.subject, 60) || '(not given)'}
Objective (if given): ${clip(b.objective, 300) || '(write one from the plan)'}
Teacher's requests: ${clip(b.notes, 600) || '(none)'}

The teacher's slides, in order (${slides.length} slides):
${slideList || '(no slides uploaded)'}

The lesson plan:
"""
${clip(b.plan, 14000) || '(no plan given)'}
"""`;
  const run = (schema) =>
    env.AI.run(AI_MODEL, {
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }],
      max_tokens: 4096,
      temperature: 0.4,
      response_format: schema ? { type: 'json_schema', json_schema: DRAFT_SCHEMA } : { type: 'json_object' },
    });
  let out;
  try { out = await run(true); } catch { out = await run(false); }
  let r = out && out.response !== undefined ? out.response : out;
  if (typeof r === 'string') {
    const a = r.indexOf('{'), z = r.lastIndexOf('}');
    r = JSON.parse(r.slice(a, z + 1));
  }
  if (!r || !Array.isArray(r.steps)) throw new Error('The AI did not return a lesson. Please try again.');
  r.steps = r.steps.filter((s) => s && STEP_TYPES.includes(s.type)).slice(0, 90);
  return r;
}

/* ======================= Library ======================= */
export class Library {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }

  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const S = this.ctx.storage;

    if (p === '/list') {
      const all = await S.list({ prefix: 'L:' });
      const out = [...all.values()].map((l) => ({
        id: l.id, title: l.title, subject: l.subject || '', author: l.author || '', updated: l.updated || 0,
        cover: l.cover || (l.slides || []).find((s) => s.src)?.src || '', count: (l.slides || []).length,
      })).sort((a, b) => b.updated - a.updated);
      return json(out);
    }

    let m = p.match(/^\/lesson\/([a-z0-9-]{1,40})$/i);
    if (m) {
      const key = 'L:' + m[1];
      if (req.method === 'GET') {
        const l = await S.get(key);
        return l ? json(l) : json({ error: 'notfound' }, 404);
      }
      if (req.method === 'PUT') {
        let l;
        try { l = JSON.parse(await req.text()); } catch { return json({ error: 'bad' }, 400); }
        if (!l || !Array.isArray(l.slides)) return json({ error: 'bad' }, 400);
        const prev = await S.get(key);
        l.id = m[1];
        l.updated = Date.now();
        l.created = (prev && prev.created) || Date.now();
        const text = JSON.stringify(l);
        if (text.length > 1800000) return json({ error: 'toobig' }, 413);
        await S.put(key, l);
        return json({ ok: true, id: l.id, updated: l.updated });
      }
      if (req.method === 'DELETE') {
        const l = await S.get(key);
        if (l) {
          const ids = new Set();
          for (const s of [...(l.slides || []), ...(l.media || [])]) {
            const mm = String(s.src || '').match(/^\/media\/([a-z0-9]+)$/i);
            if (mm) ids.add(mm[1]);
          }
          // only delete pictures no other lesson uses
          const all = await S.list({ prefix: 'L:' });
          for (const [k, other] of all) {
            if (k === key) continue;
            for (const s of [...(other.slides || []), ...(other.media || [])]) {
              const mm = String(s.src || '').match(/^\/media\/([a-z0-9]+)$/i);
              if (mm) ids.delete(mm[1]);
            }
          }
          await S.delete([key, ...[...ids].map((i) => 'M:' + i)].slice(0, 128));
        }
        return json({ ok: true });
      }
    }

    if (p === '/media' && req.method === 'POST') {
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
      const type = req.headers.get('content-type');
      const data = await req.arrayBuffer();
      await S.put('M:' + id, { type, data });
      return json({ url: '/media/' + id });
    }

    m = p.match(/^\/media\/([a-z0-9]{1,40})$/i);
    if (m) {
      const v = await S.get('M:' + m[1]);
      if (!v) return new Response('Not found', { status: 404 });
      return new Response(v.data, { headers: { 'content-type': v.type, 'cache-control': 'public, max-age=31536000, immutable' } });
    }
    return json({ error: 'notfound' }, 404);
  }
}

/* ======================= Room (live lesson) ======================= */
export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sockets = new Map();
    this.saveTimer = null;
    this.core = new RoomCore({
      send: (cid, msg) => {
        const ws = this.sockets.get(cid);
        if (ws) try { ws.send(JSON.stringify(msg)); } catch {}
      },
      persist: (state) => this.queueSave(state),
      saveBlob: (id, data) => { this.ctx.storage.put('blob:' + id, data).catch(() => {}); },
      dropBlob: (id) => { this.ctx.storage.delete('blob:' + id).catch(() => {}); },
    });
    ctx.blockConcurrencyWhile(async () => {
      const st = await ctx.storage.get('state');
      if (st && !st.ended) {
        const blobs = await ctx.storage.list({ prefix: 'blob:' });
        this.core.load(st, [...blobs].map(([k, v]) => [k.slice(5), v]));
      }
    });
  }

  queueSave(state) {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(async () => {
      this.saveTimer = null;
      if (state.ended) { await this.wipe(); return; }
      await this.ctx.storage.put('state', state);
    }, 1500);
  }

  async wipe() {
    this.core.state = null;
    await this.ctx.storage.deleteAll();
    for (const [cid, ws] of this.sockets) {
      try { ws.send(JSON.stringify({ t: 'error', e: 'ended' })); ws.close(1000, 'ended'); } catch {}
      this.sockets.delete(cid);
    }
  }

  async alarm() {
    const st = this.core.state;
    if (!st || st.ended || Date.now() - (st.last || 0) > IDLE_LIMIT) { await this.wipe(); return; }
    await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init') {
      if (this.core.state && !this.core.state.ended) return new Response('taken', { status: 409 });
      const key = crypto.randomUUID();
      let lesson = null;
      try { lesson = await req.json(); } catch {}
      const state = freshState(url.searchParams.get('code'), key, lesson);
      this.core.load(state);
      await this.ctx.storage.put('state', state);
      await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
      return new Response(JSON.stringify({ key }), { status: 200 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    if (!this.core.state) {
      server.send(JSON.stringify({ t: 'error', e: 'noroom' }));
      server.close(1000, 'noroom');
      return new Response(null, { status: 101, webSocket: client });
    }
    const cid = crypto.randomUUID();
    this.sockets.set(cid, server);
    this.core.connect(cid);
    server.addEventListener('message', (ev) => this.core.message(cid, ev.data));
    const gone = () => { if (!this.sockets.has(cid)) return; this.sockets.delete(cid); this.core.disconnect(cid); };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }
}
