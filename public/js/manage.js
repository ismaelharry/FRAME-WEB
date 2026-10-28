/* Gestión de reserva: refresco del estado de pago, horarios para el cambio y confirmaciones. */
(() => {
  const poll = document.querySelector('[data-poll]');
  if (poll) {
    let n = 0;
    const tick = async () => {
      n++;
      try {
        const r = await fetch(poll.dataset.poll, { credentials: 'same-origin' }).then((x) => x.json());
        if (r.status !== 'pending_payment' || r.payment_status !== 'pending') { location.href = location.href.replace(/([?&])pago=ok&?/, '$1'); return; }
      } catch { /* reintenta */ }
      if (n < 40) setTimeout(tick, 2500);
    };
    setTimeout(tick, 1500);
  }
  document.querySelectorAll('form[data-cancel]').forEach((f) => f.addEventListener('submit', (e) => { if (!confirm(f.dataset.cancel)) e.preventDefault(); }));
  const form = document.querySelector('form[data-change]');
  if (form && form.dataset.kind !== 'desk_day') {
    const es = form.dataset.lang !== 'en';
    const date = form.querySelector('[name=date]');
    const sel = form.querySelector('[name=time]');
    const hint = form.querySelector('[data-change-hint]');
    const original = sel.value;
    const load = async () => {
      const q = form.dataset.group ? `group=${form.dataset.group}` : `resource=${form.dataset.resource}`;
      hint.textContent = es ? 'Buscando horarios…' : 'Looking for times…';
      try {
        const r = await fetch(`/api/availability/slots?${q}&date=${date.value}&duration=${form.dataset.duration}&people=${form.dataset.people}`).then((x) => x.json());
        sel.textContent = '';
        const free = (r.slots || []).filter((s) => s.available);
        for (const s of free) { const o = document.createElement('option'); o.value = s.time; o.textContent = `${s.time}–${s.end}`; sel.appendChild(o); }
        if (!free.length) { const o = document.createElement('option'); o.value = ''; o.textContent = es ? 'Sin horarios libres' : 'No free times'; sel.appendChild(o); }
        if ([...sel.options].some((o) => o.value === original)) sel.value = original;
        hint.textContent = es ? `${free.length} horarios disponibles (además del tuyo)` : `${free.length} times available (besides yours)`;
      } catch { hint.textContent = es ? 'No se pudieron cargar los horarios.' : 'Could not load times.'; }
    };
    date.addEventListener('change', load);
    load();
  }
})();
