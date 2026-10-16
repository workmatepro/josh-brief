// Josh's Brief: PWA skeleton. Offline MOCK backend (localStorage + data/briefs.json, EXAMPLE data).
// The live build swaps MockApi for SupabaseApi (same method names); each method's live equivalent is noted.
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LS = { get: (k, d) => JSON.parse(localStorage.getItem('brief.' + k) || 'null') ?? d, set: (k, v) => localStorage.setItem('brief.' + k, JSON.stringify(v)) };

const MockApi = {
  data: null,
  async load() { this.data = await (await fetch('./data/briefs.json', { cache: 'no-store' })).json(); return this.data; },  // live: select briefs/updates/projects/project_items (RLS: Josh only)
  log(action, item, extra = {}) { const l = LS.get('action_log', []); l.push({ at: new Date().toISOString(), actor: 'josh', action, item, ...extra }); LS.set('action_log', l); }, // live: rows written by DB triggers / rpc
  state(id) { return LS.get('item.' + id, {}); },
  save(id, patch) { const s = { ...this.state(id), ...patch }; LS.set('item.' + id, s); return s; },
  async answer(id, v, owner) { this.save(id, { answer: v, at: new Date().toISOString() }); this.log('pressed_' + v, id, { owner }); },  // live: update items set answer=v | rpc answer_project_item(p_item, p_answer)
  async comment(id, body) { const c = this.state(id).comments || []; c.push({ body, at: new Date().toISOString() }); this.save(id, { comments: c }); this.log('comment', id, { body }); }, // live: insert item_comments
  async saveEdit(id, f) { this.save(id, { edit: f, status: 'draft' }); this.log('email_edited', id); },
  async confirm(id, orig, f) {
    const edited = ['to', 'subject', 'body'].some(k => (f[k] || '') !== (orig[k] || ''));
    this.save(id, { status: 'approved', edited, final: f, at: new Date().toISOString() });
    this.log(edited ? 'confirmed_edited' : 'confirmed_unedited', id, { outcome: edited ? 'Original + final stored; diff to writing bot' : 'Successful, no changes' });
    return edited;
  },
  async reject(id) { this.save(id, { status: 'declined', at: new Date().toISOString() }); this.log('pressed_no', id); },
  async rate(id, score, comment) { this.save(id, { rating: { score, comment } }); this.log('rated', id, { score, comment }); }, // live: insert ratings
  async answerQuestion(id, a) { this.save(id, { answer: a, at: new Date().toISOString() }); this.log('answered_question', id); },
  seen() { return new Set(LS.get('seen', [])); },
  markSeen(id) { const s = this.seen(); if (!s.has(id)) { s.add(id); LS.set('seen', [...s]); this.log('opened', id); } },        // live: rpc mark_report_read / per-project seen
  todos() { return LS.get('todos', null); },
  setTodos(t) { LS.set('todos', t); },
  // Live updates. Live: supabase.channel('today').on('postgres_changes',{event:'INSERT',schema:'public',table:'updates'},cb)
  //   (+ project_items) .subscribe(); fallback poll every 30 s if the socket drops. Mock: poll data file every 15 s + window.__push for tests.
  subscribe(cb) {
    window.__push = u => { this.data.updates.push({ id: 'u' + Date.now(), at: new Date().toISOString(), ...u }); cb('push'); };
    setInterval(async () => { try { const n = await (await fetch('./data/briefs.json', { cache: 'no-store' })).json(); const have = new Set(this.data.updates.map(u => u.id));
      const fresh = n.updates.filter(u => !have.has(u.id)); if (fresh.length) { this.data.updates.push(...fresh); cb('poll'); } } catch (e) {} }, +(new URLSearchParams(location.search).get('poll')) || 15000);
  },
};
const api = MockApi;
let D, days, route = [];
// Hosting: GitHub Pages project site, https://<user>.github.io/josh-brief/. Every URL is relative; routes are #hash so no server rewrites are needed.
// Auth redirect (magic-link fallback only; main flow is the 6-digit code) = current origin + path, so it works under /josh-brief/ and locally.
const REDIRECT = location.origin + location.pathname;   // live: auth.signInWithOtp({email, options:{shouldCreateUser:false, emailRedirectTo: REDIRECT}})
// ---- 6-digit code sign-in (mock). Live: auth.signInWithOtp({email, options:{shouldCreateUser:false}}) then auth.verifyOtp({email, token, type:'email'})
function signIn() {
  $('#view').innerHTML = `<div class="card signin"><h2>Sign in</h2><p class="mut">We'll email a 6-digit code to Josh's address. Type it here, inside the app (email links don't work in home-screen apps on iPhone).</p>
   <input id="em" type="email" value="josh@example.com" autocomplete="email"><button class="btn" id="send">Email me a code</button>
   <input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" hidden><button class="btn" id="ver" hidden>Sign in</button>
   <p class="mut small">Mock: any 6 digits work. Live: code expires in 1 hour.</p></div>`;
  $('#send').onclick = () => { $('#code').hidden = $('#ver').hidden = false; $('#code').focus(); };
  $('#ver').onclick = () => { if (/^\d{6}$/.test($('#code').value)) { LS.set('session', { at: Date.now() }); boot2(); } else $('#code').classList.add('bad'); };
}

async function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
  const p = new URLSearchParams(location.search);
  if (p.get('mock') === '1') LS.set('session', { at: Date.now() });   // headless test hook only
  if (!LS.get('session')) return signIn();
  boot2();
}
async function boot2() {
  D = await api.load();
  days = Object.keys(D.days).sort().reverse();               // Today = newest iso_date (live: today's UK date)
  carryOver();
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => go(b.dataset.r));
  addEventListener('hashchange', draw);
  let x0 = null, y0 = null;
  addEventListener('touchstart', e => { x0 = (e.target.closest && e.target.closest('.carousel')) ? null : e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  addEventListener('touchend', e => {
    if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx)) return;
    const i = dayIdx(); if (i < 0) return;
    if (dx > 0 && i < days.length - 1) go(dayHash(i + 1));    // swipe right = earlier day
    else if (dx < 0 && i > 0) go(dayHash(i - 1));
  });
  api.subscribe(why => { if (dayIdx() === 0) { draw(true); flash(why); } else badge(); });
  setInterval(() => { if (dayIdx() === 0 && nightNow() !== lastNight) draw(true); }, 60000);   // flips to Night around 18:00 UK without a reload
  draw();
}
const go = h => { if (location.hash === h) draw(); else location.hash = h; scrollTo(0, 0); };
const dayHash = i => i ? '#/day/' + days[i] : '#/';
const dayIdx = () => !route[0] ? 0 : route[0] === 'day' ? Math.max(0, days.indexOf(route[1])) : -1;
let lastNight = null;
function nightNow() {
  const m = new URLSearchParams(location.search).get('mode'); if (m) return m === 'night';     // test/preview override
  return +new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Europe/London' }).format(new Date()) >= 18;
}
function flash(why) { const f = $('#live'); if (f) { f.classList.add('pulse'); setTimeout(() => f.classList.remove('pulse'), 1500); } }
// ---- To-do with carry-over (ASSUMPTION: undone items carry to the next day). Live: daily job copies undone rows.
function carryOver() {
  const today = days[0], t = api.todos();
  if (!t) return api.setTodos({ date: today, items: D.todos });
  if (t.date !== today) api.setTodos({ date: today, items: t.items.filter(x => !x.done).map(x => ({ ...x, carried: true })) });
}

// ---- small word diff for showing Josh what changed (the writing bot gets the stored original + final and writes its own analysis)
function wordDiff(a, b) {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/), m = A.length, n = B.length, L = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0, out = '';
  while (i < m && j < n) { if (A[i] === B[j]) { out += esc(A[i]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) out += `<del>${esc(A[i++])}</del>`; else out += `<ins>${esc(B[j++])}</ins>`; }
  while (i < m) out += `<del>${esc(A[i++])}</del>`; while (j < n) out += `<ins>${esc(B[j++])}</ins>`;
  return out;
}

const commentBox = (id, ro) => {
  const cs = api.state(id).comments || [];
  return `<div class="cm">${cs.map(c => `<div class="cmt">💬 ${esc(c.body)} <span class="tag">sent to owner</span></div>`).join('')}
   ${ro ? '' : `<div class="cmrow"><input placeholder="Add a comment" data-cm="${id}" aria-label="Comment"><button class="mini" data-cmsend="${id}">Add</button></div>`}</div>`;
};
const ownerTag = o => `<span class="tag">${esc(o)}</span>`;

// Every decision is a pair of buttons: writes the choice + logs it (owner bot acts; result appears on Today / Since last brief)
const PAIRS = { yn: [['yes', 'Yes'], ['no', 'No']], ar: [['approve', 'Approve'], ['reject', 'Reject']], th: [['up', '👍'], ['down', '👎']] };
function buttons(id, owner, kind = 'yn', ro = false) {
  const s = api.state(id), [a, b] = PAIRS[kind], label = { yes: 'Yes', no: 'No', approve: 'Approved', reject: 'Rejected', up: 'Thumbs up', down: 'Thumbs down' };
  return `<div class="yn">${[a, b].map(([v, t], k) => `<button class="${k ? 'n' : 'y'} ${s.answer === v ? 'on' : ''}" ${ro ? 'disabled' : ''} data-ans="${esc(id)}" data-v="${v}" data-o="${esc(owner)}" aria-pressed="${s.answer === v}">${t}</button>`).join('')}</div>
    ${s.answer ? `<div class="mut small done-line">✓ ${label[s.answer]} · logged · ${esc(owner)} will act</div>` : ''}`;
}
function emailCard(m, ro) {
  const s = api.state(m.id), f = s.edit || { to: m.to, subject: m.subject, body: m.body };
  const head = `<div class="row">${ownerTag('Written by ' + m.writer)}<span class="tag">via ${esc(m.lead)}</span></div>`;
  if (s.status === 'declined') return `<div class="card">${head}<b>${esc(m.subject)}</b><div class="mut">Rejected. ${esc(m.writer)} won't send it.</div>${commentBox(m.id, ro)}</div>`;
  if (s.status === 'approved') {
    const r = s.rating;
    return `<div class="card">${head}<b>${esc(s.final.subject)}</b> <span class="tag done">Approved</span>
      <div class="mut small">${s.edited ? 'You edited it: original and final saved; the changes go to ' + esc(m.writer) + ' to learn from.' : 'Sent as written: logged as successful, no changes.'}</div>
      ${s.edited ? `<div class="diff">${wordDiff(m.body, s.final.body)}</div>` : ''}
      <div class="rate"><div class="lbl">Rate this email (1–10)</div><div class="nums">${[...Array(10)].map((_, i) => `<button class="n10 ${r && r.score === i + 1 ? 'on' : ''}" data-rate="${m.id}" data-s="${i + 1}" ${ro ? 'disabled' : ''}>${i + 1}</button>`).join('')}</div>
      <textarea rows="2" placeholder="Comment on the rating (optional)" data-ratec="${m.id}" ${ro ? 'disabled' : ''}>${esc(r ? r.comment : '')}</textarea>
      ${r ? `<div class="mut small">Rated ${r.score}. Goes to ${esc(m.writer)} via ${esc(m.lead)}. Any question back shows in Questions for you.</div>` : ''}</div>
      ${commentBox(m.id, ro)}</div>`;
  }
  return `<div class="card" data-kind="email">${head}<details class="em" data-open="${m.id}"><summary><b>${esc(f.subject)}</b><span class="mini">Open email</span></summary>
    <label class="lbl">To<input data-f="to" data-e="${m.id}" value="${esc(f.to)}" ${ro ? 'disabled' : ''}></label>
    <label class="lbl">Subject<input data-f="subject" data-e="${m.id}" value="${esc(f.subject)}" ${ro ? 'disabled' : ''}></label>
    <label class="lbl">Message<textarea rows="6" data-f="body" data-e="${m.id}" ${ro ? 'disabled' : ''}>${esc(f.body)}</textarea></label>
    <div class="yn"><button class="y" data-confirm="${m.id}" ${ro ? 'disabled' : ''}>Approve</button><button class="n" data-rejectmail="${m.id}" ${ro ? 'disabled' : ''}>Reject</button></div>
    <div class="mut small">Edit anything, then Approve. Nothing is sent until you approve; ${esc(m.writer)} then sends exactly this text.</div></details>
    ${commentBox(m.id, ro)}</div>`;
}
// ---- Departments: safe markdown (escape first, then a small whitelist), tiles, reader
function md(src) {
  const inline = t => esc(t)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, (m, a, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>`);
  const out = []; let list = null, table = null;
  const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.t}>`); list = null; }
    if (table) { out.push(`<div class="tw"><table>${table.map((r, i) => `<tr>${r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table></div>`); table = null; } };
  for (const raw of String(src || '').split('\n')) {
    const l = raw.trimEnd(); let m;
    if (/^\s*\|/.test(l)) { const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()); if (cells.every(c => /^:?-{2,}:?$/.test(c))) continue; if (list) flush(); (table = table || []).push(cells); continue; }
    if (table) flush();
    if ((m = l.match(/^(#{1,4})\s+(.*)/))) { flush(); out.push(`<h${Math.min(m[1].length + 2, 6)}>${inline(m[2])}</h${Math.min(m[1].length + 2, 6)}>`); continue; }
    if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(inline(m[1])); continue; }
    if ((m = l.match(/^\s*\d+[.)]\s+(.*)/))) { if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; } list.items.push(inline(m[1])); continue; }
    if (!l.trim()) { flush(); continue; }
    flush(); out.push(`<p>${inline(l)}</p>`);
  }
  flush(); return out.join('');
}

// ---- helpers
const fmtT = iso => new Date(iso).toLocaleString('en-GB', { hour: 'numeric', minute: '2-digit', timeZone: 'Europe/London' });
const ukDate = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const tileOf = s => D.tiles.find(t => t.slug === s);
const initials = n => n.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const avatar = (t, big) => t.avatar ? `<img class="av ${big ? 'big' : ''}" src="${esc(t.avatar)}" alt="">` : `<span class="av ${big ? 'big' : ''}" data-d="${esc(t.slug)}" aria-hidden="true">${esc(initials(t.name))}</span>`;
const projectsOf = s => D.projects.filter(p => p.dept === s).sort((a, b) => b.updated_at.localeCompare(a.updated_at));   // newest first
const isOpen = it => it.needs_answer && !api.state(it.id).answer;
function unread(slug) {
  const seen = api.seen();
  if (slug === 'family') return D.family.filter(f => !seen.has(f.id)).length;
  return projectsOf(slug).reduce((n, p) => n + (seen.has(p.id) ? 0 : 1) + p.items.filter(isOpen).length, 0);
}
const linkList = ls => (ls || []).map(l => l.url ? `<a class="lnk" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.label)} ↗</a>`
  : `<div class="lnk off">${esc(l.label)}<span class="mut small">box file, becomes a hosted link when published: ${esc(l.box_path)}</span></div>`).join('');

// ---- breadcrumbs: every page, first crumb always Today
function crumbs() {
  const c = [['Today', '#/']], r = route;
  if (r[0] === 'day') c.push([D.days[r[1]] ? D.days[r[1]].label : r[1], '']);
  if (r[0] === 'team' || r[0] === 'd') c.push(['Team', '#/team']);
  if (r[0] === 'd') { const t = tileOf(r[1]); c.push([t ? t.name : r[1], '#/d/' + r[1]]);
    const p = D.projects.find(x => x.id === r[2]); if (p) c.push([p.title, `#/d/${r[1]}/${p.id}`]);
    const it = p && p.items.find(x => x.id === r[3]); if (it) c.push([it.title, '']);
    if (r[2] === 'report') c.push(['Full report', '']); }
  if (r[0] === 'todo') c.push(['To-do', '']);
  if (r[0] === 'more') c.push(['More', '']);
  return `<nav class="crumbs" aria-label="Breadcrumb">${c.map(([t, h], i) => i === c.length - 1 ? `<span aria-current="page">${esc(t)}</span>` : `<a href="${h}">${esc(t)}</a>`).join('<span class="sep">›</span>')}</nav>`;
}

// ---- TODAY (live). Morning until ~18:00 UK, then Night summary.
function tilesRow() {
  return `<div class="tiles5">${D.tiles.map(t => { const u = unread(t.slug); return `<a class="tile ${t.private ? 'priv' : ''}" href="#/d/${t.slug}" aria-label="${esc(t.name)}, ${u} unread">
    ${u ? `<span class="badge">${u}</span>` : ''}${avatar(t)}<b>${esc(t.name)}</b><span class="tsum">${esc(t.summary)}</span></a>`; }).join('')}</div>`;
}
function openDeptItems() { return D.projects.flatMap(p => p.items.filter(isOpen).map(it => ({ it, p }))); }
function dayView(k) {
  const d = D.days[k], i = days.indexOf(k), ro = i > 0, night = !ro && nightNow(); lastNight = night;
  const ups = D.updates.filter(u => ukDate(u.at) === k || (i === 0 && (ukDate(u.at) > days[1] || ukDate(u.at) === ukDate(new Date().toISOString())))).sort((a, b) => b.at.localeCompare(a.at));
  const upd = ups.length ? `<div class="card list feed">${ups.map(u => `<div class="li"><span class="av sm" data-d="${esc(u.dept)}">${esc(initials(u.bot))}</span><div><b>${esc(u.bot)}</b> <span class="mut small">${fmtT(u.at)}</span><div>${esc(u.text)}</div></div></div>`).join('')}</div>` : '<div class="card mut">No updates yet today.</div>';
  const live = ro ? '' : `<div class="live" id="live"><span class="ldot"></span>Live · ${ups.length} update${ups.length === 1 ? '' : 's'} today · last ${ups[0] ? fmtT(ups[0].at) : '–'}</div>`;
  const focus = `<section><h2>${ro ? 'Focus that day' : "Today's focus"}</h2><div class="card">${d.focus ? `<b>${esc(d.focus.area)}</b><div class="mut">Tech will: ${esc(d.focus.tech)}<br>Marketing will: ${esc(d.focus.marketing)}</div>` : '<b class="none">Focus not agreed</b>'}</div></section>`;
  const qs = d.questions.map(q => { const a = api.state(q.id).answer; return `<div class="card" data-kind="question"><div class="mut small">From ${esc(q.from)} · via ${esc(q.via)}</div><b>${esc(q.q)}</b>
     ${a ? `<div class="cmt">✓ ${esc(a)} <span class="tag">sent back</span></div>` : ro ? '' : `<div class="cmrow"><input placeholder="Your answer" data-qa="${q.id}"><button class="mini" data-qsend="${q.id}">Send</button></div>`}</div>`; });
  const decs = d.decisions.map(q => `<div class="card" data-kind="decision">${ownerTag(q.owner)}<b class="q">${esc(q.q)}</b><div class="mut">${esc(q.why)}</div>${buttons(q.id, q.owner, 'yn', ro)}${commentBox(q.id, ro)}</div>`);
  const ideas = d.ideas.map(x => `<div class="card" data-kind="idea">${ownerTag(x.dept)}<div>${esc(x.text)}</div>${buttons(x.id, x.dept, 'th', ro)}${commentBox(x.id, ro)}</div>`);
  const deptOpen = ro ? [] : openDeptItems().map(({ it, p }) => `<a class="card link" href="#/d/${p.dept}/${p.id}/${it.id}"><span class="tag">${esc(tileOf(p.dept).name)}</span>${it.ref ? `<span class="tag ref">${esc(it.ref)}</span>` : ''}<b class="q">${esc(it.title)}</b><span class="mut small">Open to ${it.kind === 'fix' ? 'Approve or Reject' : 'answer Yes or No'} ›</span></a>`);
  const sec = (t, arr, sub = '') => arr.length ? `<section><h2>${t}${sub ? ` <span class="sub">${sub}</span>` : ''}</h2>${arr.join('')}</section>` : '';
  let h = live;
  if (night) {
    const today = k, log = LS.get('action_log', []).filter(a => ukDate(a.at) === ukDate(new Date().toISOString()));
    const openMorning = [...d.decisions.filter(q => !api.state(q.id).answer), ...d.emails.filter(m => !['approved', 'declined'].includes(api.state(m.id).status)), ...d.ideas.filter(x => !api.state(x.id).answer), ...d.questions.filter(q => !api.state(q.id).answer)];
    h += `<section class="night-sum"><h2>Tonight's summary</h2><div class="card nightcard"><div class="big3"><div><b>${log.length}</b><span>things you did</span></div><div><b>${ups.length}</b><span>bot updates</span></div><div><b>${openMorning.length + openDeptItems().length}</b><span>still open</span></div></div>
      ${log.length ? `<div class="mut small">${log.slice(-6).reverse().map(a => esc(a.action.replace(/_/g, ' ')) + ' · ' + fmtT(a.at)).join('<br>')}</div>` : '<div class="mut small">Nothing pressed today yet.</div>'}</div></section>`;
    h += `<section><h2>Carried over from this morning <span class="sub">${openMorning.length + deptOpen.length} open</span></h2>${[...decs.filter((_, j) => !api.state(d.decisions[j].id).answer), ...d.emails.filter(m => !['approved', 'declined'].includes(api.state(m.id).status)).map(m => emailCard(m, false)), ...ideas.filter((_, j) => !api.state(d.ideas[j].id).answer), ...qs.filter((_, j) => !api.state(d.questions[j].id).answer), ...deptOpen].join('') || '<div class="card mut">Nothing left open. 🎉</div>'}</section>`;
    h += `<section><h2>Done today</h2>${tilesRow()}</section>${sec('All updates today', [upd])}`;
  } else {
    h += focus;
    if (!ro) h += `<section><h2>Your team <span class="sub">tap a tile</span></h2>${tilesRow()}</section>`;
    h += sec('Needs you', [...deptOpen], ro ? '' : 'from departments');
    h += sec('Questions for you', qs) + sec('Decisions', decs) + sec('Emails to check', d.emails.map(m => emailCard(m, ro))) + sec('Ideas from the team', ideas);
    h += `<section><h2>${ro ? 'Updates that day' : 'Live updates'}</h2>${upd}</section>`;
    const done = d.since.filter(s => ['done', 'sent'].includes(s.status)).length;
    h += `<section><h2>Since last brief <span class="sub">${done}/${d.since.length} done</span></h2>` + (d.since.length ? `<div class="card list">` + d.since.map(s => `<div class="li"><span class="dot ${s.status}"></span><div><b>${esc(s.you)}</b> ${esc(s.item)}<div class="mut small">${esc(s.outcome)}</div>${ownerTag(s.owner)}<span class="tag st ${s.status}">${esc(s.status.replace('_', ' '))}</span></div></div>`).join('') + `</div>` : '<div class="card mut">Nothing logged.</div>') + `</section>`;
  }
  h += `<div class="hint">${ro ? 'Earlier day (read-only) · swipe left for newer' : 'Swipe right for earlier days'}</div>
   <div class="daynav">${i < days.length - 1 ? `<a class="mini" href="${dayHash(i + 1)}">‹ ${esc(D.days[days[i + 1]].label)}</a>` : '<span></span>'}${i > 0 ? `<a class="mini" href="${dayHash(i - 1)}">${i - 1 ? esc(D.days[days[i - 1]].label) : 'Today'} ›</a>` : ''}</div>`;
  return h;
}

// ---- TEAM: exactly 5 tiles
const teamView = () => `<section><h2>Your team <span class="sub">${D.tiles.reduce((n, t) => n + unread(t.slug), 0)} unread</span></h2>${tilesRow()}</section>`;

// ---- INSIDE A DEPARTMENT: summary, then swipeable project pages (newest first), each with actionable items
function deptView(slug) {
  const t = tileOf(slug); if (!t) return '<div class="card">Unknown department.</div>';
  if (t.private) { D.family.forEach(f => api.markSeen(f.id));
    return `<div class="dhead">${avatar(t, true)}<div><h2>${esc(t.name)}</h2><div class="mut">Kept private. Nothing personal is stored in this app.</div></div></div>
      ${D.family.map(f => `<div class="card priv"><b>${esc(f.summary)}</b><div class="mut small">Pointer: ${esc(f.pointer)}</div></div>`).join('')}`; }
  const ps = projectsOf(slug), open = ps.reduce((n, p) => n + p.items.filter(isOpen).length, 0);
  return `<div class="dhead">${avatar(t, true)}<div><h2>${esc(t.name)}</h2><div class="mut">${esc(t.summary)}</div><div class="mut small">${ps.length} project${ps.length === 1 ? '' : 's'} · ${open} need${open === 1 ? 's' : ''} you</div></div></div>
   <div class="carousel" aria-label="Projects, newest first">${ps.map((p, k) => { const o = p.items.filter(isOpen).length; return `<a class="ppage" href="#/d/${slug}/${p.id}">
     <div class="pn">${k + 1} / ${ps.length}${api.seen().has(p.id) ? '' : ' · <span class="tag new">new</span>'}</div><h3>${esc(p.title)}</h3><p>${esc(p.summary)}</p>
     <div class="pmeta"><span class="tag st ${p.status}">${esc(p.status)}</span>${o ? `<span class="tag act">${o} to decide</span>` : ''}<span class="mut small">${p.items.length} items</span></div><span class="open">Open ›</span></a>`; }).join('')}</div>
   ${ps.length > 1 ? '<div class="hint">Swipe across for older projects</div>' : ''}`;
}
const KIND = { persona: 'Who struggles', fix: 'Fixes to approve', decision: 'Decisions', finding: 'Findings', task: 'Tasks' };
function projectView(slug, pid) {
  const p = D.projects.find(x => x.id === pid && x.dept === slug); if (!p) return '<div class="card">Project not found.</div>';
  api.markSeen(p.id);
  const g = k => p.items.filter(it => it.kind === k);
  const card = it => it.kind === 'persona'
    ? `<a class="pcard" href="#/d/${slug}/${p.id}/${it.id}"><span class="av sm" data-d="persona">${esc(initials(it.title))}</span><div><b>${esc(it.title)}</b><div class="mut small">${esc(it.one_line)}</div></div><span class="chev">›</span></a>`
    : `<div class="card" data-item="${esc(it.id)}">${it.ref ? `<span class="tag ref">${esc(it.ref)}</span>` : ''}<b class="q">${esc(it.title)}</b><div class="mut">${esc(it.one_line)}</div>
       ${it.needs_answer ? buttons(it.id, tileOf(slug).bot, it.kind === 'fix' ? 'ar' : 'yn') : ''}${it.detail_md ? `<a class="mini" href="#/d/${slug}/${p.id}/${it.id}">Details ›</a>` : ''}${commentBox(it.id)}</div>`;
  return `<h2>${esc(p.title)}</h2><div class="card"><div>${esc(p.summary)}</div>${p.report_id ? `<a class="mini" href="#/d/${slug}/report/${p.report_id}">Full report ›</a>` : ''}</div>
    ${['fix', 'decision', 'persona', 'finding', 'task'].map(k => g(k).length ? `<section><h2 class="h3">${KIND[k]} <span class="sub">${g(k).length}</span></h2>${k === 'persona' ? `<div class="pgrid">${g(k).map(card).join('')}</div>` : g(k).map(card).join('')}</section>` : '').join('')}
    ${p.links && p.links.length ? `<section><h2 class="h3">Files and outputs</h2><div class="card rlinks">${linkList(p.links)}</div></section>` : ''}`;
}
function itemView(slug, pid, iid) {
  const p = D.projects.find(x => x.id === pid), it = p && p.items.find(x => x.id === iid); if (!it) return '<div class="card">Item not found.</div>';
  return `<article class="card report">${it.ref ? `<span class="tag ref">${esc(it.ref)}</span>` : `<span class="tag">${esc(KIND[it.kind])}</span>`}<h3 class="rtitle">${esc(it.title)}</h3><div class="rsum">${esc(it.one_line)}</div>
    ${it.needs_answer ? buttons(it.id, tileOf(slug).bot, it.kind === 'fix' ? 'ar' : 'yn') : ''}
    <div class="mdx">${md(it.detail_md)}</div>${it.links && it.links.length ? `<div class="rlinks"><div class="lbl">Files</div>${linkList(it.links)}</div>` : ''}${commentBox(it.id)}</article>
    <a class="btn ghost" href="#/d/${slug}/${pid}">‹ Back to ${esc(p.title)}</a>`;
}
function reportView(slug, rid) {
  const r = (D.reports || []).find(x => x.id === rid); if (!r) return '<div class="card">Report not found.</div>';
  api.markSeen(r.id);
  return `<article class="card report"><div class="rmeta">${esc(r.author)} · ${esc(fmtT(r.created_at))}</div><h3 class="rtitle">${esc(r.title)}</h3><div class="rsum">${esc(r.summary)}</div><div class="mdx">${md(r.body_md)}</div>${r.links ? `<div class="rlinks"><div class="lbl">Files and outputs</div>${linkList(r.links)}</div>` : ''}</article>`;
}

function todoView() {
  const t = api.todos().items;
  return `<section><h2>Your to-do <span class="sub">${t.filter(x => !x.done).length} left</span></h2>` + t.map(x => `<label class="card todo ${x.done ? 'd' : ''}"><input type="checkbox" data-todo="${x.id}" ${x.done ? 'checked' : ''}><span>${esc(x.text)}${x.carried ? '<br><span class="tag">Carried over</span>' : ''}</span></label>`).join('') +
    `<div class="cmrow"><input id="newtodo" placeholder="Add a to-do"><button class="mini" id="addtodo">Add</button></div><p class="mut small">Assumption: anything not ticked carries over to tomorrow.</p></section>`;
}
function moreView() {
  return `<section><h2>More</h2><div class="card">Room for future sections: Ratings history, Ideas bank, Settings.</div>
   <div class="card"><b>Activity on this phone (mock action log)</b><div class="mut small">${(LS.get('action_log', [])).slice(-8).reverse().map(a => esc(a.action + ' · ' + a.item)).join('<br>') || 'Nothing yet.'}</div></div>
   <button class="btn ghost" id="signout">Sign out</button></section>`;
}

function badge() { const n = D.tiles.reduce((a, t) => a + unread(t.slug), 0); document.querySelectorAll('nav [data-r="#/team"] .nb').forEach(b => { b.textContent = n || ''; b.hidden = !n; }); }
function draw(keepScroll) {
  route = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const r = route, di = dayIdx(), y = scrollY;
  let v;
  if (di >= 0) v = dayView(days[di]);
  else if (r[0] === 'team') v = teamView();
  else if (r[0] === 'd' && r[2] === 'report') v = reportView(r[1], r[3]);
  else if (r[0] === 'd' && r[3]) v = itemView(r[1], r[2], r[3]);
  else if (r[0] === 'd' && r[2]) v = projectView(r[1], r[2]);
  else if (r[0] === 'd') v = deptView(r[1]);
  else if (r[0] === 'todo') v = todoView();
  else if (r[0] === 'more') v = moreView();
  else v = dayView(days[0]);
  const night = di === 0 && nightNow();
  document.body.classList.toggle('night', night);
  const k = di >= 0 ? days[di] : null;
  $('#day').innerHTML = k ? `${di ? 'Earlier day' : night ? 'Night' : 'Morning'} · ${esc(D.days[k].label)}` : '';
  $('#view').innerHTML = crumbs() + v + '<div class="motto-foot">always improving</div>';
  const tabR = di === 0 ? '#/' : r[0] === 'day' ? '#/' : r[0] === 'd' ? '#/team' : '#/' + r[0];
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.r === tabR));
  wire(k ? D.days[k] : D.days[days[0]]); badge();
  if (keepScroll) scrollTo(0, y);
}

function wire(day) {
  const v = $('#view');
  v.querySelectorAll('[data-ans]').forEach(b => b.onclick = async () => { await api.answer(b.dataset.ans, b.dataset.v, b.dataset.o); draw(true); });
  v.querySelectorAll('[data-cmsend]').forEach(b => b.onclick = async () => { const i = v.querySelector(`[data-cm="${b.dataset.cmsend}"]`); if (i.value.trim()) { await api.comment(b.dataset.cmsend, i.value.trim()); draw(true); } });
  v.querySelectorAll('[data-qsend]').forEach(b => b.onclick = async () => { const i = v.querySelector(`[data-qa="${b.dataset.qsend}"]`); if (i.value.trim()) { await api.answerQuestion(b.dataset.qsend, i.value.trim()); draw(true); } });
  v.querySelectorAll('[data-e]').forEach(i => i.onchange = () => { const id = i.dataset.e, m = day.emails.find(x => x.id === id), s = api.state(id); api.saveEdit(id, { ...(s.edit || { to: m.to, subject: m.subject, body: m.body }), [i.dataset.f]: i.value }); });
  v.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
    const id = b.dataset.confirm, m = day.emails.find(x => x.id === id), f = {};
    v.querySelectorAll(`[data-e="${id}"]`).forEach(i => f[i.dataset.f] = i.value);
    await api.saveEdit(id, f); await api.confirm(id, m, f); draw(true);
  });
  v.querySelectorAll('[data-rejectmail]').forEach(b => b.onclick = async () => { await api.reject(b.dataset.rejectmail); draw(true); });
  v.querySelectorAll('[data-rate]').forEach(b => b.onclick = async () => { const id = b.dataset.rate, c = v.querySelector(`[data-ratec="${id}"]`); await api.rate(id, +b.dataset.s, c.value); draw(true); });
  v.querySelectorAll('[data-ratec]').forEach(c => c.onchange = async () => { const r = api.state(c.dataset.ratec).rating; if (r) { await api.rate(c.dataset.ratec, r.score, c.value); draw(true); } });
  v.querySelectorAll('[data-todo]').forEach(c => c.onchange = () => { const t = api.todos(); t.items.find(x => x.id === c.dataset.todo).done = c.checked; api.setTodos(t); api.log('todo_tick', c.dataset.todo); draw(true); });
  const add = $('#addtodo'); if (add) add.onclick = () => { const s = $('#newtodo').value.trim(); if (!s) return; const t = api.todos(); t.items.push({ id: 't' + Date.now(), text: s, done: false }); api.setTodos(t); api.log('todo_add', s); draw(true); };
  const so = $('#signout'); if (so) so.onclick = () => { localStorage.removeItem('brief.session'); location.reload(); };
}
boot();
