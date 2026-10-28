/* Reserva por pasos: servicio → fecha y hora → datos → revisión → confirmación.
   La disponibilidad, el precio y las condiciones vienen siempre del servidor. */
const root = document.querySelector('[data-book]');
const lang = root.dataset.lang;
const es = lang !== 'en';
const prefill = JSON.parse(root.dataset.prefill || '{}');
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const csrf = () => document.querySelector('meta[name="csrf-token"]')?.content || '';
const fmtDate = (d, o = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(`${d}T12:00:00`).toLocaleDateString(es ? 'es-ES' : 'en-GB', o);
const fmtDur = (m) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const fmtStr = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);

let CAT = null;
let UI = null;
const state = { step: 'service', service: null, resource: null, date: null, time: null, duration: null, people: 1, voucherId: null, startDate: null, month: null, quote: null, contact: {}, busy: false };

async function api(method, url, body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {};
  try { json = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) { const e = new Error(json.message || UI?.errors?.SERVER_ERROR || 'Error'); e.code = json.error; e.details = json.details; e.status = res.status; throw e; }
  return json;
}

const svc = () => CAT.services.find((s) => s.id === state.service);
const isDesk = () => svc()?.type === 'desk';
const isTimed = () => svc()?.type === 'timed';
const isPlan = () => svc()?.type === 'plan';
const isPurchase = () => svc()?.type === 'purchase';

// ------------------------------------------------------------------ pasos
const ORDER = ['service', 'when', 'details', 'review', 'done'];
function go(step, { focus = true } = {}) {
  state.step = step;
  for (const p of $$('[data-panel]', root)) p.hidden = p.dataset.panel !== step;
  const idx = ORDER.indexOf(step);
  for (const li of $$('[data-step-ind]', root)) {
    const i = Number(li.dataset.stepInd);
    li.classList.toggle('is-done', i < idx);
    li.classList.toggle('is-current', i === idx);
    if (i === idx) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  }
  const panel = $(`[data-panel="${step}"]`, root);
  if (step === 'when') renderWhen();
  if (step === 'details') renderDetails();
  if (step === 'review') renderReview();
  if (focus) {
    const h = $('h2', panel);
    h?.setAttribute('tabindex', '-1');
    h?.focus({ preventScroll: true });
    const top = root.getBoundingClientRect().top + window.scrollY - 90;
    if (Math.abs(window.scrollY - top) > 200) window.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  renderSummary();
}

function chooseService(id, { fromModel = false } = {}) {
  const s = CAT.services.find((x) => x.id === id);
  if (!s) return;
  if (s.type === 'quote') { location.href = `${root.dataset.contactUrl}?asunto=despacho#presupuesto`; return; }
  state.service = id;
  state.resource = s.resources?.[0]?.slug || null;
  state.duration = s.durations ? (s.durations.includes(60) && s.id !== 'visit' ? 60 : s.durations[0]) : null;
  state.time = null;
  state.people = 1;
  state.quote = null;
  for (const b of $$('[data-service]', root)) b.setAttribute('aria-pressed', String(b.dataset.service === id));
  window.dispatchEvent(new CustomEvent('frame:service', { detail: { zone: s.zone, service: id } }));
  if (s.requiresLogin && !CAT.customer) { go('when'); return; }
  go(isPurchase() ? 'details' : 'when', { focus: !fromModel });
  if (fromModel) document.querySelector('#reserva')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ------------------------------------------------------------ fecha y hora
async function renderWhen() {
  const p = $('[data-panel="when"]', root);
  const s = svc();
  if (!s) return go('service');
  if (s.requiresLogin && !CAT.customer) { renderLogin(p, s); return; }
  if (!state.date) state.date = prefill.date && prefill.date >= CAT.today ? prefill.date : null;
  if (!state.month) state.month = (state.date || CAT.today).slice(0, 7);
  const back = `<button type="button" class="textbtn small" data-back="service">← ${esc(UI.booking.back)}</button>`;
  if (isPlan()) {
    p.innerHTML = `${back}<h2 class="display-3 mt-2">${es ? 'Fecha de inicio' : 'Start date'}</h2>
      <p class="muted">${esc(s.summary)}</p>
      <div class="field mt-3" style="max-width:320px"><label for="b-start">${es ? 'Quiero empezar el' : 'I want to start on'}</label>
      <input id="b-start" type="date" min="${CAT.today}" value="${esc(state.startDate || addDays(CAT.today, 1))}" required></div>
      <div class="mt-4">${btn(UI.booking.next, 'data-next')}</div>`;
    $('#b-start', p).addEventListener('change', (e) => { state.startDate = e.target.value; renderSummary(); });
    state.startDate = $('#b-start', p).value;
    $('[data-next]', p).addEventListener('click', () => { state.startDate = $('#b-start', p).value; if (state.startDate) go('details'); });
    bindBack(p);
    return;
  }
  const people = Array.from({ length: s.maxPeople || 1 }, (_, i) => i + 1);
  let resourceSel = '';
  if (s.resources && s.resources.length > 1) {
    resourceSel = `<fieldset class="field"><legend class="field__label">${es ? 'Sala' : 'Room'}</legend><div class="flex gap-1 wrap-row">${s.resources.map((r) => `<button type="button" class="chip" data-res="${esc(r.slug)}" aria-pressed="${r.slug === state.resource}">${esc(r.name)} · ${r.capacity} ${es ? 'pers.' : 'ppl.'}</button>`).join('')}</div></fieldset>`;
  }
  const voucherSel = s.id === 'voucher' ? (CAT.customer.vouchers.length
    ? `<div class="field"><label for="b-voucher">${es ? 'Bono' : 'Pass'}</label><select id="b-voucher">${CAT.customer.vouchers.map((v) => `<option value="${v.id}">${esc(v.code)} · ${v.balance} ${es ? 'días' : 'days'} · ${es ? 'caduca' : 'expires'} ${esc(fmtDate(v.expires_on, { day: 'numeric', month: 'short', year: 'numeric' }))}</option>`).join('')}</select></div>`
    : `<p class="alert alert--error">${es ? 'No tienes bonos con saldo. Puedes comprar uno.' : 'You have no passes with balance. You can buy one.'} <button type="button" class="textbtn" data-goto="bundle">${es ? 'Comprar bono' : 'Buy a pass'}</button></p>`) : '';
  if (s.id === 'voucher' && CAT.customer.vouchers.length && !state.voucherId) state.voucherId = CAT.customer.vouchers[0].id;
  p.innerHTML = `${back}<h2 class="display-3 mt-2">${esc(s.title)}</h2>
    <div class="when">
      <div class="when__cal">
        <div class="cal" data-cal></div>
      </div>
      <div class="when__opts stack" style="--stack:1.1rem">
        ${resourceSel}${voucherSel}
        ${isTimed() && s.durations.length > 1 ? `<div class="field"><label for="b-dur">${esc(UI.booking.duration)}</label><select id="b-dur">${s.durations.map((d) => `<option value="${d}" ${d === state.duration ? 'selected' : ''}>${fmtDur(d)}</option>`).join('')}</select></div>` : isTimed() ? `<p class="small muted">${esc(UI.booking.duration)}: ${fmtDur(s.durations[0])}</p>` : ''}
        ${people.length > 1 ? `<div class="field"><label for="b-people">${esc(UI.booking.people)}</label><select id="b-people">${people.map((n) => `<option ${n === state.people ? 'selected' : ''}>${n}</option>`).join('')}</select></div>` : ''}
        <div data-day-info aria-live="polite"></div>
        <div data-slots aria-live="polite"></div>
        <div data-when-error></div>
        <div>${btn(UI.booking.next, 'data-next disabled')}</div>
      </div>
    </div>`;
  bindBack(p);
  $$('[data-goto]', p).forEach((b) => b.addEventListener('click', () => chooseService(b.dataset.goto)));
  $$('[data-res]', p).forEach((b) => b.addEventListener('click', () => { state.resource = b.dataset.res; state.time = null; $$('[data-res]', p).forEach((x) => x.setAttribute('aria-pressed', String(x === b))); loadSlots(); renderSummary(); }));
  $('#b-dur', p)?.addEventListener('change', (e) => { state.duration = Number(e.target.value); state.time = null; loadSlots(); renderSummary(); });
  $('#b-people', p)?.addEventListener('change', (e) => { state.people = Number(e.target.value); state.time = null; isDesk() ? showDayInfo() : loadSlots(); renderSummary(); });
  $('#b-voucher', p)?.addEventListener('change', (e) => { state.voucherId = Number(e.target.value); renderSummary(); });
  $('[data-next]', p).addEventListener('click', () => { if (canContinueWhen()) go('details'); });
  await renderCalendar();
  if (state.date) { isDesk() ? showDayInfo() : loadSlots(); }
  if (prefill.time && isTimed()) state.time = prefill.time;
  updateNext();
}

function canContinueWhen() {
  if (!state.date) return false;
  if (isDesk()) return state.dayFree >= state.people && (svc().id !== 'voucher' || state.voucherId);
  if (isTimed()) return Boolean(state.time);
  return true;
}
function updateNext() {
  const b = $('[data-panel="when"] [data-next]', root);
  if (!b) return;
  const ok = canContinueWhen();
  b.disabled = !ok;
  b.setAttribute('aria-disabled', String(!ok));
}

let monthCache = {};
async function renderCalendar() {
  const box = $('[data-cal]', root);
  const [y, m] = state.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const startWd = (first.getUTCDay() + 6) % 7;
  const maxDate = addDays(CAT.today, CAT.horizonDays);
  let info = {};
  if (isDesk()) {
    if (!monthCache[state.month]) {
      try { monthCache[state.month] = (await api('GET', `/api/availability/desks?month=${state.month}`)).days; } catch { monthCache[state.month] = []; }
    }
    for (const d of monthCache[state.month]) info[d.date] = d;
  }
  const title = first.toLocaleDateString(es ? 'es-ES' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const wd = es ? ['L', 'M', 'X', 'J', 'V', 'S', 'D'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const prevMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  let cells = '';
  for (let i = 0; i < startWd; i++) cells += '<span class="cal__pad" aria-hidden="true"></span>';
  for (let d = 1; d <= days; d++) {
    const ds = `${state.month}-${String(d).padStart(2, '0')}`;
    const past = ds < CAT.today || ds > maxDate;
    const di = info[ds];
    let cls = '';
    let sub = '';
    let disabled = past;
    if (isDesk() && di && !past) {
      if (!di.open) { disabled = true; cls = 'is-closed'; sub = di.reason === 'holiday' ? (es ? 'festivo' : 'holiday') : '—'; }
      else if (di.free <= 0) { disabled = true; cls = 'is-full'; sub = UI.booking.full; }
      else { sub = String(di.free); cls = di.free <= 5 ? 'is-low' : ''; }
      if (svc().id === 'trial' && !(svc().weekdays || []).includes(new Date(`${ds}T12:00`).getDay())) { disabled = true; cls = 'is-closed'; }
    }
    const label = `${fmtDate(ds)}${isDesk() && di && !past ? ` · ${di.open ? (di.free > 0 ? fmtStr(UI.booking.desks_left, { n: di.free }) : UI.booking.full) : UI.booking.closed}` : ''}`;
    cells += `<button type="button" class="cal__day ${cls}${ds === state.date ? ' is-selected' : ''}${ds === CAT.today ? ' is-today' : ''}" data-date="${ds}" ${disabled ? 'disabled' : ''} aria-pressed="${ds === state.date}" aria-label="${esc(label)}"><span>${d}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  }
  box.innerHTML = `<div class="cal__head"><button type="button" class="cal__nav" data-month="${prevMonth}" ${prevMonth < CAT.today.slice(0, 7) ? 'disabled' : ''} aria-label="${es ? 'Mes anterior' : 'Previous month'}">←</button>
    <strong class="cal__title">${esc(title)}</strong>
    <button type="button" class="cal__nav" data-month="${nextMonth}" ${nextMonth > maxDate.slice(0, 7) ? 'disabled' : ''} aria-label="${es ? 'Mes siguiente' : 'Next month'}">→</button></div>
    <div class="cal__grid" role="group" aria-label="${esc(title)}">${wd.map((w) => `<span class="cal__wd" aria-hidden="true">${w}</span>`).join('')}${cells}</div>
    ${isDesk() ? `<p class="cal__legend small muted">${es ? 'El número indica puestos libres.' : 'The number shows free desks.'}</p>` : ''}`;
  $$('[data-month]', box).forEach((b) => b.addEventListener('click', () => { state.month = b.dataset.month; renderCalendar(); }));
  $$('[data-date]', box).forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date; state.time = null;
    $$('[data-date]', box).forEach((x) => { x.classList.toggle('is-selected', x === b); x.setAttribute('aria-pressed', String(x === b)); });
    isDesk() ? showDayInfo() : loadSlots();
    renderSummary();
  }));
}

async function showDayInfo() {
  const out = $('[data-day-info]', root);
  if (!out || !state.date) return;
  out.innerHTML = `<p class="small muted">${esc(UI.booking.loading)}</p>`;
  try {
    const r = await api('GET', `/api/availability/desk?date=${state.date}`);
    state.dayFree = r.open ? r.free : 0;
    const enough = r.open && r.free >= state.people;
    out.innerHTML = `<div class="day-info ${enough ? 'is-ok' : 'is-ko'}"><strong>${esc(fmtDate(state.date))}</strong><br>${r.open ? esc(fmtStr(UI.booking.desks_left, { n: r.free })) : esc(r.reason === 'holiday' ? UI.errors.CLOSED_HOLIDAY : UI.errors.CLOSED)}${r.open && !enough ? `<br>${esc(fmtStr(UI.errors.NOT_ENOUGH_DESKS, { free: r.free }))}` : ''}</div>`;
  } catch (e) { out.innerHTML = `<p class="alert alert--error">${esc(e.message)}</p>`; state.dayFree = 0; }
  updateNext();
}

async function loadSlots() {
  const out = $('[data-slots]', root);
  if (!out || !state.date) return;
  const s = svc();
  out.innerHTML = `<p class="small muted">${esc(UI.booking.loading)}</p>`;
  const q = s.groupSlug ? `group=${s.groupSlug}` : `resource=${state.resource}`;
  try {
    const r = await api('GET', `/api/availability/slots?${q}&date=${state.date}&duration=${state.duration}&people=${state.people}`);
    if (!r.slots.length) { out.innerHTML = `<p class="day-info is-ko">${esc(r.reason ? UI.errors[r.reason] || UI.booking.none_slots : UI.booking.none_slots)}</p>`; state.time = null; updateNext(); return; }
    const free = r.slots.filter((x) => x.available).length;
    out.innerHTML = `<p class="field__label" id="slots-l">${esc(UI.booking.time)} <span class="muted small">· ${free} ${esc(UI.booking.available.toLowerCase())}</span></p>
      <div class="slots" role="group" aria-labelledby="slots-l">${r.slots.map((x) => `<button type="button" class="chip" data-time="${x.time}" ${x.available ? '' : 'disabled'} aria-pressed="${x.time === state.time}" aria-label="${x.time}–${x.end} ${esc(x.available ? UI.booking.available : UI.booking.unavailable)}">${x.time}</button>`).join('')}</div>`;
    if (state.time && !r.slots.find((x) => x.time === state.time && x.available)) state.time = null;
    $$('[data-time]', out).forEach((b) => b.addEventListener('click', () => {
      state.time = b.dataset.time;
      $$('[data-time]', out).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      updateNext(); renderSummary();
    }));
  } catch (e) { out.innerHTML = `<p class="alert alert--error">${esc(e.message)}</p>`; }
  updateNext();
}

// ---------------------------------------------------------- iniciar sesión
function renderLogin(p, s) {
  p.innerHTML = `<button type="button" class="textbtn small" data-back="service">← ${esc(UI.booking.back)}</button>
    <h2 class="display-3 mt-2">${es ? 'Inicia sesión para usar tu ' : 'Sign in to use your '}${s.id === 'voucher' ? (es ? 'bono' : 'pass') : (es ? 'plan' : 'plan')}</h2>
    <p class="muted">${es ? 'Te enviamos un enlace de acceso a tu correo. No necesitas contraseña.' : 'We email you a sign-in link. No password needed.'}</p>
    <form class="form mt-3" data-login novalidate style="max-width:440px">
      <div class="field"><label for="l-email">${esc(UI.booking.email)}</label><input id="l-email" type="email" autocomplete="email" required></div>
      <div>${btn(es ? 'Enviar enlace' : 'Send link', 'type="submit"')}</div>
      <div data-login-out aria-live="polite"></div>
    </form>`;
  bindBack(p);
  $('[data-login]', p).addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('[data-login-out]', p);
    try {
      const r = await api('POST', '/api/account/login', { email: $('#l-email', p).value, next: `${root.dataset.bookUrl}?servicio=${s.id}`, lang });
      out.innerHTML = `<p class="alert alert--ok">${esc(r.message)}</p>${r.mailbox ? `<p class="small mt-1"><a href="${esc(r.mailbox)}" target="_blank" rel="noopener">${es ? 'Abrir la bandeja de pruebas (modo prueba)' : 'Open the test mailbox (test mode)'}</a></p>` : ''}`;
    } catch (err) { out.innerHTML = `<p class="alert alert--error">${esc(err.message)}</p>`; }
  });
}

// ------------------------------------------------------------------ datos
function renderDetails() {
  const p = $('[data-panel="details"]', root);
  const c = CAT.customer;
  const v = state.contact;
  const s = svc();
  p.innerHTML = `<button type="button" class="textbtn small" data-back="${isPurchase() ? 'service' : 'when'}">← ${esc(UI.booking.back)}</button>
    <h2 class="display-3 mt-2">${es ? 'Tus datos' : 'Your details'}</h2>
    <p class="muted small">${es ? 'Solo lo necesario para gestionar tu reserva. No hace falta crear una cuenta.' : 'Only what we need to manage your booking. No account needed.'}</p>
    <form class="form mt-3" data-details novalidate>
      ${c ? `<p class="note small">${es ? 'Reservas con tu cuenta' : 'Booking with your account'}: <strong>${esc(c.email)}</strong></p>` : `
      <div class="form-row">
        <div class="field"><label for="d-name">${esc(UI.booking.name)} <span aria-hidden="true">*</span></label><input id="d-name" name="name" autocomplete="name" required minlength="2" value="${esc(v.name)}"></div>
        <div class="field"><label for="d-email">${esc(UI.booking.email)} <span aria-hidden="true">*</span></label><input id="d-email" name="email" type="email" autocomplete="email" required value="${esc(v.email)}"></div>
      </div>`}
      <div class="form-row">
        <div class="field"><label for="d-phone">${esc(UI.booking.phone)}${s.id === 'trial' || isPlan() ? ' <span aria-hidden="true">*</span>' : ` <span class="muted small">(${es ? 'opcional' : 'optional'})</span>`}</label><input id="d-phone" name="phone" type="tel" autocomplete="tel" ${s.id === 'trial' || isPlan() ? 'required' : ''} value="${esc(v.phone ?? c?.phone ?? '')}"></div>
        <div class="field"><label for="d-company">${esc(UI.booking.company)}</label><input id="d-company" name="company" autocomplete="organization" value="${esc(v.company)}"></div>
      </div>
      ${isPlan() || isPurchase() || (svc().price && /\d/.test(svc().price)) ? `<div class="field"><label for="d-tax">${esc(UI.booking.tax_id)}</label><input id="d-tax" name="tax_id" value="${esc(v.tax_id)}"><span class="hint">${es ? 'Solo si necesitas factura a nombre de una empresa o autónomo.' : 'Only if you need an invoice for a company or self-employed person.'}</span></div>` : ''}
      <div class="field"><label for="d-notes">${esc(UI.booking.notes)}</label><textarea id="d-notes" name="notes" maxlength="800" rows="3">${esc(v.notes)}</textarea></div>
      <div>${btn(UI.booking.next, 'type="submit"')}</div>
    </form>`;
  bindBack(p);
  $('[data-details]', p).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const data = Object.fromEntries(new FormData(f).entries());
    const errs = {};
    if (!c) {
      if (!data.name || data.name.trim().length < 2) errs.name = UI.booking.min_name;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email || '')) errs.email = UI.booking.invalid_email;
    }
    if ((s.id === 'trial' || isPlan()) && !(data.phone || '').trim()) errs.phone = UI.booking.required;
    showErrors(f, errs);
    if (Object.keys(errs).length) return;
    state.contact = data;
    go('review');
  });
}

function showErrors(form, errs) {
  $$('.error', form).forEach((x) => x.remove());
  $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
  let first = null;
  for (const [name, msg] of Object.entries(errs)) {
    const el = form.elements[name];
    if (!el) continue;
    el.setAttribute('aria-invalid', 'true');
    const m = document.createElement('span'); m.className = 'error'; m.id = `${el.id}-err`; m.textContent = msg;
    el.setAttribute('aria-describedby', m.id);
    el.closest('.field').appendChild(m);
    first ||= el;
  }
  first?.focus();
}

// --------------------------------------------------------------- revisión
async function renderReview() {
  const p = $('[data-panel="review"]', root);
  p.innerHTML = `<button type="button" class="textbtn small" data-back="details">← ${esc(UI.booking.back)}</button>
    <h2 class="display-3 mt-2">${es ? 'Revisa y confirma' : 'Review and confirm'}</h2><p class="small muted">${esc(UI.booking.loading)}</p>`;
  bindBack(p);
  let q;
  try { q = await refreshQuote(); } catch (e) { p.insertAdjacentHTML('beforeend', `<p class="alert alert--error">${esc(e.message)}</p>`); return; }
  const s = svc();
  p.innerHTML = `<button type="button" class="textbtn small" data-back="details">← ${esc(UI.booking.back)}</button>
    <h2 class="display-3 mt-2">${es ? 'Revisa y confirma' : 'Review and confirm'}</h2>
    <dl class="review mt-3">${summaryRows().map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}
      <div><dt>${es ? 'Contacto' : 'Contact'}</dt><dd>${esc(CAT.customer ? CAT.customer.email : `${state.contact.name} · ${state.contact.email}`)}</dd></div></dl>
    <div class="panel mt-3"><h3 class="label">${esc(UI.booking.conditions)}</h3><ul class="list-dash small mt-1">${q.conditions.split('\n').map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
    ${q.testMode ? `<p class="test-banner mt-3">${es ? 'MODO PRUEBA · Pasarela de prueba: no se realizará ningún cargo real.' : 'TEST MODE · Test gateway: no real charge will be made.'}</p>` : ''}
    <form class="form mt-3" data-confirm novalidate>
      <label class="check"><input type="checkbox" name="accept" required><span>${es ? 'He leído y acepto las ' : 'I have read and accept the '}<a href="${root.dataset.termsUrl}" target="_blank" rel="noopener">${es ? 'condiciones de contratación' : 'terms of purchase'}</a> ${es ? 'y la' : 'and the'} <a href="${root.dataset.privacyUrl}" target="_blank" rel="noopener">${es ? 'información de privacidad' : 'privacy information'}</a>.</span></label>
      <label class="check"><input type="checkbox" name="marketing"><span>${esc(UI.booking.marketing)}</span></label>
      <div class="total-box"><span>${esc(UI.booking.total)}</span><strong>${esc(q.total)}</strong></div>
      <p class="small muted">${esc(q.totalNote)}</p>
      <div>${btn(q.button, `type="submit"${q.mode === 'pay' ? ' data-pay' : ''}`, q.mode === 'pay' ? 'rec' : '')}</div>
      <div data-confirm-out aria-live="assertive"></div>
    </form>`;
  bindBack(p);
  $('[data-confirm]', p).addEventListener('submit', submit);
}

async function submit(e) {
  e.preventDefault();
  if (state.busy) return;
  const f = e.target;
  const out = $('[data-confirm-out]', f);
  if (!f.elements.accept.checked) { out.innerHTML = `<p class="alert alert--error">${esc(UI.errors.TERMS_REQUIRED)}</p>`; f.elements.accept.focus(); return; }
  state.busy = true;
  const b = $('button[type=submit]', f);
  b.disabled = true;
  out.innerHTML = `<p class="small muted">${esc(UI.booking.processing)}</p>`;
  const s = svc();
  const person = { ...state.contact, accept: true, marketing: f.elements.marketing.checked, lang };
  try {
    let r;
    if (isPurchase() || isPlan()) r = await api('POST', '/api/purchases', { product: s.product, start_date: state.startDate || undefined, ...person });
    else r = await api('POST', '/api/bookings', { service: s.id, resource: state.resource || undefined, date: state.date, time: state.time || undefined, duration: state.duration || undefined, people: state.people, voucherId: state.voucherId || undefined, ...person });
    if (r.redirect && (r.mode === 'pay' || isTimed() || isDesk())) { location.href = r.redirect; return; }
    showDone(r);
  } catch (err) {
    state.busy = false;
    b.disabled = false;
    out.innerHTML = `<p class="alert alert--error">${esc(err.message)}</p>`;
    if (['SLOT_TAKEN', 'NO_AVAILABILITY', 'NOT_ENOUGH_DESKS'].includes(err.code)) {
      out.insertAdjacentHTML('beforeend', `<p class="mt-1"><button type="button" class="textbtn" data-again>${es ? 'Elegir otro horario' : 'Choose another time'}</button></p>`);
      $('[data-again]', out).addEventListener('click', () => { state.time = null; monthCache = {}; go('when'); });
    }
  }
}

function showDone(r) {
  const p = $('[data-panel="done"]', root);
  const s = svc();
  p.innerHTML = `<h2 class="display-3" tabindex="-1">${es ? 'Solicitud recibida' : 'Request received'}</h2>
    <p class="lead mt-2">${esc(UI.booking.reference)}: <strong class="mono" style="font-size:1.1em">${esc(r.ref)}</strong></p>
    <p>${isPlan() ? (es ? 'Hemos registrado tu solicitud de alta. Te contactaremos para confirmar fecha, precio final y forma de pago. No se ha realizado ningún cargo.' : 'We have registered your membership request. We will contact you to confirm the date, final price and payment. Nothing has been charged.')
      : (es ? 'Hemos registrado tu solicitud de bono. Te escribiremos para confirmar el precio final y el pago. No se ha realizado ningún cargo.' : 'We have registered your pass request. We will write to confirm the final price and payment. Nothing has been charged.')}</p>
    <p class="small muted">${es ? 'Te hemos enviado un correo con esta información.' : 'We have sent you an email with this information.'} ${esc(s.title)}.</p>
    <div class="btn-row mt-3">${btn(es ? 'Ir a Mi cuenta' : 'Go to My account', `data-href="${esc(root.dataset.accountUrl)}"`)}</div>`;
  $$('[data-href]', p).forEach((x) => x.addEventListener('click', () => { location.href = x.dataset.href; }));
  go('done');
}

// ---------------------------------------------------------------- resumen
function summaryRows() {
  const s = svc();
  if (!s) return [];
  const rows = [[es ? 'Servicio' : 'Service', s.title]];
  if (s.resources && s.resources.length > 1 && state.resource) rows.push([es ? 'Sala' : 'Room', s.resources.find((r) => r.slug === state.resource)?.name || '']);
  if (isPlan() && state.startDate) rows.push([es ? 'Inicio' : 'Start', fmtDate(state.startDate)]);
  if (state.date && !isPlan() && !isPurchase()) rows.push([UI.booking.date, fmtDate(state.date)]);
  if (state.time) {
    const [h, m] = state.time.split(':').map(Number);
    const end = h * 60 + m + state.duration;
    rows.push([es ? 'Horario' : 'Time', `${state.time}–${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')} (${es ? 'hora de Madrid' : 'Madrid time'})`]);
  } else if (isDesk() && state.date) rows.push([es ? 'Horario' : 'Hours', es ? 'Horario de coworking' : 'Coworking hours']);
  if (isTimed() && state.duration) rows.push([UI.booking.duration, fmtDur(state.duration)]);
  if (!isPlan() && !isPurchase()) rows.push([UI.booking.people, String(state.people)]);
  return rows;
}

let quoteTimer = null;
async function refreshQuote() {
  const s = svc();
  if (!s) return null;
  const body = { service: s.id, resource: state.resource || undefined, date: state.date || undefined, time: state.time || undefined, duration: state.duration || undefined, people: state.people, lang };
  state.quote = await api('POST', '/api/quote', body);
  renderSummary(false);
  return state.quote;
}

function renderSummary(fetchQuote = true) {
  const box = $('[data-summary]', root);
  const s = svc();
  if (!s) { box.innerHTML = `<span class="label">${esc(es ? 'Resumen' : 'Summary')}</span><p class="muted small mt-2">${esc(es ? 'Elige un servicio para empezar.' : 'Choose a service to start.')}</p>`; return; }
  const q = state.quote;
  box.innerHTML = `<span class="label">${esc(es ? 'Resumen' : 'Summary')}</span>
    <dl class="summary__rows">${summaryRows().map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${q ? `<div class="summary__price">${q.lines.map(([k, v]) => `<div class="flex between small"><span>${esc(k)}</span><span class="tabular">${esc(v)}</span></div>`).join('')}
      <div class="flex between summary__total"><span>${esc(UI.booking.total)}</span><strong class="tabular">${esc(q.total)}</strong></div>
      <p class="small muted mb-0">${esc(q.totalNote)}</p></div>` : `<p class="small muted mt-2">${esc(s.price)}</p>`}`;
  if (fetchQuote) { clearTimeout(quoteTimer); quoteTimer = setTimeout(() => refreshQuote().catch(() => {}), 250); }
}

// ------------------------------------------------------------- utilidades
function btn(label, attrs = '', variant = '') {
  return `<button class="btn${variant ? ` btn--${variant}` : ''}" ${attrs}><span class="btn__roll"><span>${esc(label)}</span><span aria-hidden="true">${esc(label)}</span></span><span class="btn__icon"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h11M9 3.5 13.5 8 9 12.5" stroke="currentColor" stroke-width="1.6"/></svg></span></button>`;
}
function bindBack(p) { $$('[data-back]', p).forEach((b) => b.addEventListener('click', () => go(b.dataset.back))); }
function addDays(d, n) { const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, dd + n)).toISOString().slice(0, 10); }

// --------------------------------------------------------------- arranque
(async () => {
  try {
    CAT = await api('GET', `/api/catalog?lang=${lang}`);
  } catch {
    root.insertAdjacentHTML('afterbegin', `<p class="alert alert--error">${es ? 'No se pudo cargar el catálogo. Recarga la página.' : 'Could not load the catalogue. Please reload.'}</p>`);
    return;
  }
  UI = CAT.ui;
  for (const b of $$('[data-service]', root)) b.addEventListener('click', () => chooseService(b.dataset.service));
  if (prefill.service && CAT.services.find((s) => s.id === prefill.service)) chooseService(prefill.service, { fromModel: false });
  initViewer();
})();

// Maqueta 3D (mejora progresiva: se carga solo si hay WebGL y espacio visible).
async function initViewer() {
  const box = document.querySelector('[data-viewer]');
  if (!box) return;
  const btn360 = box.querySelector('[data-360]');
  const btnExit = box.querySelector('[data-exit360]');
  let viewer = null;
  let zoneSel = null;
  const zoneForService = (service) => ({ pass: 'coworking', trial: 'coworking', voucher: 'coworking', flex: 'coworking', 'plan-flex': 'coworking', 'plan-fixed': 'coworking', bundle: 'coworking', room: state.resource || 'sala-salinas', booth: 'cabinas', studio: 'estudio', visit: 'recepcion', 'plan-virtual': 'recepcion' }[service]);
  window.addEventListener('frame:service', (e) => {
    zoneSel = zoneForService(e.detail.service);
    viewer?.select(zoneSel);
    if (btn360) btn360.hidden = !zoneSel;
  });
  const start = async () => {
    try {
      const { createViewer, webglAvailable } = await import('/js/model/viewer.mjs');
      if (!webglAvailable()) return;
      const layout = JSON.parse(box.dataset.layout);
      viewer = createViewer(box, layout, {
        lang,
        onSelect: (service, z) => {
          zoneSel = z.id;
          if (z.resource) state.resource = z.resource;
          if (service === 'room' && z.resource) state.resource = z.resource;
          chooseService(service, { fromModel: true });
          viewer.select(z.id);
          if (btn360) btn360.hidden = false;
        },
      });
      box.classList.add('is-live');
      if (zoneSel) viewer.select(zoneSel);
      if (btn360) btn360.hidden = !zoneSel;
    } catch (err) { console.warn('Visor 3D no disponible', err); }
  };
  btn360?.addEventListener('click', () => { if (!viewer || !zoneSel) return; viewer.enter360(zoneSel); btn360.hidden = true; btnExit.hidden = false; });
  btnExit?.addEventListener('click', () => { viewer?.exit360(); btnExit.hidden = true; btn360.hidden = !zoneSel; });
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); start(); } }, { rootMargin: '200px' });
    io.observe(box);
  } else start();
}
