/* Panel de administración: menú móvil, confirmaciones, copiar enlaces y campos según el tipo de reserva. */
(() => {
  const toggle = document.querySelector('[data-anav]');
  const nav = document.getElementById('anav');
  if (toggle && nav) {
    const set = (open) => { nav.classList.toggle('is-open', open); toggle.setAttribute('aria-expanded', String(open)); };
    toggle.addEventListener('click', () => set(!nav.classList.contains('is-open')));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
    document.addEventListener('click', (e) => { if (nav.classList.contains('is-open') && !nav.contains(e.target) && e.target !== toggle) set(false); });
  }

  document.querySelectorAll('form[data-confirm]').forEach((f) => f.addEventListener('submit', (e) => {
    if (!window.confirm(f.dataset.confirm)) e.preventDefault();
  }));

  // Evita envíos dobles (p. ej. doble clic al confirmar una reserva).
  document.querySelectorAll('form[method="post"]').forEach((f) => f.addEventListener('submit', (e) => {
    if (e.defaultPrevented) return;
    if (f.dataset.sent) { e.preventDefault(); return; }
    f.dataset.sent = '1';
    setTimeout(() => { delete f.dataset.sent; }, 4000);
  }));

  document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const input = b.parentElement.querySelector('input');
    try { await navigator.clipboard.writeText(input.value); b.textContent = 'Copiado'; } catch { input.select(); }
    setTimeout(() => { b.textContent = 'Copiar'; }, 1800);
  }));

  // Nueva reserva: muestra solo los campos del tipo elegido.
  const sw = document.querySelector('[data-kind-switch]');
  if (sw) {
    const form = sw.closest('form');
    const apply = () => {
      form.querySelectorAll('[data-for]').forEach((el) => {
        const wrap = el.closest('.afield') || el;
        const on = el.dataset.for === sw.value;
        wrap.hidden = !on;
        el.disabled = !on;
      });
    };
    sw.addEventListener('change', apply);
    apply();
  }
})();
