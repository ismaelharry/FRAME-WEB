/* FRAME — interacción común: navegación, estado de apertura, animaciones,
   consentimiento de cookies, formularios y buscador de disponibilidad. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const lang = document.body.dataset.lang || 'es';
  const es = lang !== 'en';
  const csrf = () => $('meta[name="csrf-token"]')?.content || '';

  // ------------------------------------------------------------ cabecera
  const onScroll = () => document.body.classList.toggle('is-scrolled', window.scrollY > 20);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---------------------------------------------------------- menú móvil
  const menu = $('#mobile-menu');
  const openBtn = $('[data-menu-open]');
  let lastFocus = null;
  function openMenu() {
    lastFocus = document.activeElement;
    menu.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    openBtn?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-visible')));
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('.mobile-menu__close', menu)?.focus(), 50);
  }
  function closeMenu() {
    menu.classList.remove('is-visible');
    openBtn?.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    setTimeout(() => menu.classList.remove('is-open'), 450);
    lastFocus?.focus();
  }
  openBtn?.addEventListener('click', openMenu);
  $$('[data-menu-close]').forEach((b) => b.addEventListener('click', closeMenu));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu?.classList.contains('is-open')) closeMenu();
    if (e.key === 'Tab' && menu?.classList.contains('is-open')) {
      const f = $$('a, button', menu).filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  // --------------------------------------- hora de Torrevieja y estado de recepción
  const hours = (() => { try { return JSON.parse(document.body.dataset.hours || '{}'); } catch { return {}; } })();
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const keys = { Mon: 'mon', Tue: 'tue', Wed: 'wed', Thu: 'thu', Fri: 'fri', Sat: 'sat', Sun: 'sun' };
  function updateStatus() {
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
    const hhmm = `${parts.hour}:${parts.minute}`;
    const ranges = hours[keys[parts.weekday]] || [];
    const open = ranges.some(([a, b]) => hhmm >= a && hhmm < b);
    const text = `Torrevieja ${hhmm} · ${open ? (es ? 'Recepción abierta' : 'Reception open') : (es ? 'Recepción cerrada' : 'Reception closed')}`;
    $$('[data-status-text]').forEach((el) => { el.textContent = text; });
    $$('[data-status] .rec-dot, .mobile-menu__top .rec-dot').forEach((d) => { d.classList.toggle('rec-dot--live', open); d.style.background = open ? '' : 'var(--line-strong)'; });
  }
  updateStatus();
  setInterval(updateStatus, 30_000);

  // ------------------------------------------------------- aparición al hacer scroll
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.reveal').forEach((el) => io.observe(el));
  } else $$('.reveal').forEach((el) => el.classList.add('is-in'));

  // Botón flotante de reserva: se oculta sobre el pie para no tapar enlaces legales.
  const fab = $('[data-fab]');
  const footer = $('.site-footer');
  if (fab && footer && 'IntersectionObserver' in window) {
    new IntersectionObserver(([e]) => fab.classList.toggle('is-hidden', e.isIntersecting), { threshold: 0.05 }).observe(footer);
  }

  // ---------------------------------------------------------------- cookies
  // Las cookies no necesarias quedan bloqueadas hasta que hay consentimiento.
  const COOKIE = 'frame_consent';
  const readConsent = () => {
    const m = document.cookie.match(/(?:^|;\s*)frame_consent=([^;]+)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1])); } catch { return null; }
  };
  const writeConsent = (c) => {
    const v = encodeURIComponent(JSON.stringify({ v: 1, analytics: !!c.analytics, maps: !!c.maps, ts: Date.now() }));
    document.cookie = `${COOKIE}=${v}; Max-Age=${180 * 86400}; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
  };
  const banner = $('[data-cookie-banner]');
  const dialog = $('[data-cookie-dialog]');
  function applyConsent() {
    const c = readConsent() || {};
    window.dispatchEvent(new CustomEvent('frame:consent', { detail: c }));
    if (c.analytics) loadAnalytics();
  }
  function decide(c) {
    writeConsent(c);
    banner?.classList.remove('is-visible');
    if (dialog?.open) dialog.close();
    applyConsent();
  }
  $$('[data-cookie]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.cookie;
    if (a === 'accept') decide({ analytics: true, maps: true });
    else if (a === 'reject') decide({ analytics: false, maps: false });
    else if (a === 'save') decide({ analytics: $('#ck-analytics').checked, maps: $('#ck-maps').checked });
  }));
  $$('[data-cookie-settings]').forEach((b) => b.addEventListener('click', () => {
    const c = readConsent() || {};
    $('#ck-analytics').checked = !!c.analytics;
    $('#ck-maps').checked = !!c.maps;
    dialog?.showModal ? dialog.showModal() : dialog?.setAttribute('open', '');
  }));
  let analyticsLoaded = false;
  function loadAnalytics() {
    if (analyticsLoaded) return;
    let cfg;
    try { cfg = JSON.parse(document.body.dataset.analytics || 'null'); } catch { cfg = null; }
    if (!cfg || !cfg.site_id) return;
    analyticsLoaded = true;
    const s = document.createElement('script');
    s.defer = true;
    if (cfg.provider === 'plausible') { s.src = 'https://plausible.io/js/script.js'; s.dataset.domain = cfg.site_id; }
    else if (cfg.provider === 'ga4') {
      s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(cfg.site_id)}`;
      window.dataLayer = window.dataLayer || [];
      window.gtag = function gtag() { window.dataLayer.push(arguments); };
      window.gtag('js', new Date()); window.gtag('config', cfg.site_id, { anonymize_ip: true });
    }
    document.head.appendChild(s);
  }
  window.FRAME = { readConsent, writeConsent: decide, csrf, lang };
  applyConsent();

  // Mapa de Google solo con consentimiento.
  function mountMap(box) {
    if (box.querySelector('iframe')) return;
    const f = document.createElement('iframe');
    f.src = box.dataset.mapSrc;
    f.title = box.dataset.mapTitle || 'Mapa';
    f.loading = 'lazy';
    f.referrerPolicy = 'no-referrer-when-downgrade';
    box.appendChild(f);
  }
  $$('[data-map]').forEach((box) => {
    const btn = $('[data-map-load]', box);
    if ((readConsent() || {}).maps) mountMap(box);
    btn?.addEventListener('click', () => { const c = readConsent() || {}; decide({ ...c, maps: true }); mountMap(box); });
    window.addEventListener('frame:consent', (e) => { if (e.detail.maps) mountMap(box); });
  });

  // ----------------------------------------------------------- formularios
  async function postJSON(url, data) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf(), Accept: 'application/json' }, body: JSON.stringify(data), credentials: 'same-origin' });
    let json = {};
    try { json = await res.json(); } catch { /* vacío */ }
    return { ok: res.ok, status: res.status, json };
  }
  window.FRAME.postJSON = postJSON;

  function formData(form) {
    const o = {};
    for (const el of form.elements) {
      if (!el.name || el.disabled) continue;
      if (el.type === 'checkbox') o[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    }
    return o;
  }
  window.FRAME.formData = formData;

  function showFieldErrors(form, fields = {}) {
    $$('[aria-invalid]', form).forEach((el) => el.removeAttribute('aria-invalid'));
    $$('.error', form).forEach((el) => el.remove());
    for (const name of Object.keys(fields)) {
      const el = form.elements[name];
      if (!el || !el.setAttribute) continue;
      el.setAttribute('aria-invalid', 'true');
      const msg = document.createElement('span');
      msg.className = 'error';
      msg.id = `${el.id || name}-err`;
      msg.textContent = name === 'email' ? (es ? 'Introduce un correo válido.' : 'Enter a valid email.') : (es ? 'Revisa este campo.' : 'Please check this field.');
      el.setAttribute('aria-describedby', msg.id);
      (el.closest('.field') || el.parentElement).appendChild(msg);
    }
    const first = form.querySelector('[aria-invalid="true"]');
    first?.focus();
  }
  window.FRAME.showFieldErrors = showFieldErrors;

  $$('form[data-ajax]').forEach((form) => {
    const started = form.querySelector('input[name="started"]');
    if (started) started.value = String(Date.now());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const out = $('[data-form-result]', form);
      const btn = form.querySelector('button[type="submit"]');
      btn?.setAttribute('disabled', '');
      out.className = 'alert';
      out.textContent = es ? 'Enviando…' : 'Sending…';
      out.hidden = false;
      try {
        const r = await postJSON(form.action, { ...formData(form), lang });
        if (r.ok) {
          out.className = 'alert alert--ok';
          out.textContent = (form.dataset.ok || (es ? 'Recibido. Referencia: {ref}' : 'Received. Reference: {ref}')).replace('{ref}', r.json.ref || '');
          form.reset();
          showFieldErrors(form, {});
        } else {
          out.className = 'alert alert--error';
          out.textContent = r.json.message || (es ? 'No se pudo enviar.' : 'Could not send.');
          showFieldErrors(form, r.json.details?.fields || {});
        }
      } catch {
        out.className = 'alert alert--error';
        out.textContent = es ? 'No hay conexión. Inténtalo de nuevo.' : 'No connection. Please try again.';
      } finally { btn?.removeAttribute('disabled'); out.focus?.(); }
    });
  });

  // --------------------------------------------------- buscador de la portada
  const finder = $('[data-finder]');
  if (finder) {
    const form = $('form', finder);
    const result = $('[data-finder-result]', finder);
    const svcSel = form.elements.service;
    const timeSel = form.elements.slot;
    const dateIn = form.elements.date;
    const bookBase = finder.dataset.bookUrl;
    const syncTime = () => {
      const opt = svcSel.selectedOptions[0];
      const timed = opt?.dataset.type === 'timed';
      timeSel.closest('.finder__field').style.opacity = timed ? '1' : '.5';
      timeSel.disabled = !timed;
    };
    svcSel.addEventListener('change', syncTime);
    syncTime();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const opt = svcSel.selectedOptions[0];
      const svc = svcSel.value;
      const date = dateIn.value;
      result.classList.add('is-visible');
      result.innerHTML = `<p class="small muted" role="status">${es ? 'Comprobando disponibilidad…' : 'Checking availability…'}</p>`;
      const url = new URL(bookBase, location.origin);
      url.searchParams.set('servicio', svc);
      if (date) url.searchParams.set('fecha', date);
      try {
        if (opt.dataset.type === 'desk') {
          const r = await fetch(`/api/availability/desk?date=${encodeURIComponent(date)}`).then((x) => x.json());
          const ok = r.open && r.free > 0;
          result.innerHTML = `<div class="flex between center wrap-row gap-2"><p class="mb-0" role="status"><strong>${new Date(date + 'T12:00').toLocaleDateString(es ? 'es-ES' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</strong> · ${ok ? `${r.free} ${es ? 'puestos libres' : 'desks free'}` : (es ? 'Sin puestos disponibles' : 'No desks available')}</p>${ok ? `<a class="link-arrow" href="${url}">${es ? 'Continuar la reserva' : 'Continue booking'}</a>` : ''}</div>`;
        } else {
          const res = opt.dataset.resource ? `resource=${opt.dataset.resource}` : `group=${opt.dataset.group}`;
          const dur = opt.dataset.duration || 60;
          const r = await fetch(`/api/availability/slots?${res}&date=${encodeURIComponent(date)}&duration=${dur}`).then((x) => x.json());
          const window_ = timeSel.value;
          const inWin = (t) => window_ === 'all' || (window_ === 'am' ? t < '14:00' : t >= '14:00');
          const free = (r.slots || []).filter((s) => s.available && inWin(s.time));
          if (!free.length) result.innerHTML = `<p class="mb-0" role="status">${es ? 'No hay horarios libres en esa franja. Prueba otro día.' : 'No free times in that window. Try another day.'}</p>`;
          else {
            result.innerHTML = `<p class="mb-0" role="status">${free.length} ${es ? 'horarios libres (1 h). Elige uno para continuar:' : 'free times (1 h). Pick one to continue:'}</p><div class="chips"></div>`;
            const chips = $('.chips', result);
            for (const s of free.slice(0, 14)) {
              const u = new URL(url); u.searchParams.set('hora', s.time);
              const a = document.createElement('a'); a.className = 'chip'; a.href = u; a.textContent = s.time; chips.appendChild(a);
            }
          }
        }
      } catch { result.innerHTML = `<p class="alert alert--error">${es ? 'No hay conexión.' : 'No connection.'}</p>`; }
    });
  }
})();
