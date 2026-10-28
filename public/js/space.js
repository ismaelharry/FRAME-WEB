/* Mini calendario de disponibilidad en las fichas de espacio. */
(() => {
  const box = document.querySelector('[data-avail]');
  if (!box) return;
  const lang = box.dataset.lang;
  const es = lang !== 'en';
  const days = box.querySelector('[data-avail-days]');
  const book = box.dataset.book;
  const slug = box.dataset.avail;
  const fmtDay = (d) => new Date(`${d}T12:00`).toLocaleDateString(es ? 'es-ES' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const link = (d, extra = '') => `${book}${book.includes('?') ? '&' : '?'}fecha=${d}${extra}`;
  const render = (items) => {
    days.textContent = '';
    const ul = document.createElement('ul');
    ul.className = 'list-dash small';
    for (const it of items) {
      const li = document.createElement('li');
      const a = document.createElement(it.ok ? 'a' : 'span');
      a.style.flex = '1';
      a.style.display = 'flex';
      a.style.justifyContent = 'space-between';
      if (it.ok) a.href = link(it.date);
      const l = document.createElement('span'); l.textContent = fmtDay(it.date);
      const r = document.createElement('strong'); r.className = 'tabular'; r.textContent = it.text;
      if (!it.ok) r.style.color = 'var(--muted)';
      a.append(l, r); li.appendChild(a); ul.appendChild(li);
    }
    days.appendChild(ul);
  };
  (async () => {
    try {
      if (slug === 'coworking') {
        const now = new Date();
        const m1 = now.toISOString().slice(0, 7);
        const m2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
        const [a, b] = await Promise.all([m1, m2].map((m) => fetch(`/api/availability/desks?month=${m}`).then((r) => r.json())));
        const items = [...a.days, ...b.days].filter((d) => d.open).slice(0, 7)
          .map((d) => ({ date: d.date, ok: d.free > 0, text: d.free > 0 ? `${d.free} ${es ? 'libres' : 'free'}` : (es ? 'Completo' : 'Full') }));
        render(items);
      } else {
        const res = box.dataset.resource;
        const out = [];
        const base = new Date();
        for (let i = 0; i < 12 && out.length < 6; i++) {
          const d = new Date(base.getTime() + i * 86400000);
          const ds = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(d);
          const r = await fetch(`/api/availability/slots?resource=${res}&date=${ds}&duration=60`).then((x) => x.json());
          if (!r.slots || !r.slots.length) continue;
          const free = r.slots.filter((s) => s.available).length;
          out.push({ date: ds, ok: free > 0, text: free > 0 ? `${free} ${es ? 'horas libres' : 'free hours'}` : (es ? 'Completo' : 'Full') });
        }
        render(out);
      }
    } catch {
      days.textContent = es ? 'No se pudo cargar la disponibilidad.' : 'Could not load availability.';
    }
  })();
})();
