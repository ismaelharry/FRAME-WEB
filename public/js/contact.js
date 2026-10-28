/* Contacto: calendario de visitas y campos de presupuesto. */
(() => {
  const box = document.querySelector('[data-visit]');
  if (box) {
    const es = box.dataset.lang !== 'en';
    const input = box.querySelector('input[type=date]');
    const out = box.querySelector('[data-visit-slots]');
    const load = async () => {
      out.textContent = es ? 'Buscando horarios…' : 'Looking for times…';
      try {
        const r = await fetch(`/api/availability/slots?resource=${box.dataset.resource}&date=${input.value}&duration=${box.dataset.duration}`).then((x) => x.json());
        out.textContent = '';
        const free = (r.slots || []).filter((s) => s.available);
        if (!free.length) { out.textContent = es ? 'No hay visitas disponibles ese día. Prueba otro.' : 'No tours available that day. Try another.'; return; }
        for (const s of free) {
          const a = document.createElement('a');
          a.className = 'chip';
          a.href = `${box.dataset.book}?servicio=visit&fecha=${input.value}&hora=${s.time}`;
          a.textContent = s.time;
          a.setAttribute('aria-label', `${es ? 'Visita a las' : 'Tour at'} ${s.time}`);
          out.appendChild(a);
        }
      } catch { out.textContent = es ? 'No se pudo cargar.' : 'Could not load.'; }
    };
    input.addEventListener('change', load);
    load();
  }
  const form = document.querySelector('#presupuesto form');
  if (form) {
    const sync = () => {
      const quote = form.elements.type.value === 'quote';
      form.querySelectorAll('[data-quote-only]').forEach((el) => { el.hidden = !quote; });
    };
    form.addEventListener('change', (e) => {
      if (e.target.name === 'topic' && ['despacho', 'estudio'].includes(e.target.value)) { form.querySelector('input[name=type][value=quote]').checked = true; }
      sync();
    });
    sync();
  }
})();
