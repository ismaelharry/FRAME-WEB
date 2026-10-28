// Correo transaccional. Sin SMTP configurado, cada mensaje se guarda en la bandeja
// de pruebas con estado "no enviado (modo prueba)": nunca se simula un envío.
import nodemailer from 'nodemailer';
import * as T from '../lib/time.js';
import { money } from '../lib/util.js';
import { esc } from '../lib/html.js';

export function createMail(ctx) {
  const { db, cfg } = ctx;
  const transport = cfg.smtp ? nodemailer.createTransport({
    host: cfg.smtp.host, port: cfg.smtp.port, secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
  }) : null;

  async function deliver(id) {
    const m = db.get('SELECT * FROM outbox WHERE id = ?', [id]);
    if (!m || !transport) return;
    try {
      await transport.sendMail({ from: cfg.mailFrom, to: m.to_email, subject: m.subject, text: m.body_text, html: m.body_html || undefined });
      db.run("UPDATE outbox SET status = 'sent', sent_at = ?, error = NULL WHERE id = ?", [Date.now(), id]);
    } catch (e) {
      db.run("UPDATE outbox SET status = 'failed', error = ? WHERE id = ?", [String(e.message).slice(0, 500), id]);
    }
  }

  return {
    get configured() { return Boolean(transport); },
    queue({ to, subject, text, html, kind, ref, viewerKey }) {
      const r = db.run(`INSERT INTO outbox (to_email, subject, body_text, body_html, kind, related_ref, status, viewer_key, created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, [to, subject, text, html || null, kind, ref || null, transport ? 'queued' : 'not_sent_test_mode', viewerKey || null, Date.now()]);
      const id = Number(r.lastInsertRowid);
      if (transport) setImmediate(() => deliver(id));
      return id;
    },
    retry: deliver,
  };
}

// --------------------------------------------------------------------------- plantillas
const BRAND = '#B23A12';

export function layoutEmail({ lang, title, intro, rows = [], blocks = [], cta, footerNote }) {
  const es = lang !== 'en';
  const rowsHtml = rows.map(([k, v]) => `<tr><td style="padding:6px 0;color:#5E5A54;font-size:13px;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;font-size:14px;color:#161514">${esc(v)}</td></tr>`).join('');
  const blocksHtml = blocks.map((b) => `<p style="font-size:14px;line-height:1.55;color:#161514;margin:0 0 12px">${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;background:#F4F1EA;font-family:Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F1EA;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #D9D3C7">
<tr><td style="padding:28px 32px 8px;font-size:22px;letter-spacing:.32em;font-weight:700;color:#161514">FRAME<span style="color:${BRAND}">.</span></td></tr>
<tr><td style="padding:8px 32px 0"><h1 style="font-size:22px;line-height:1.25;margin:0 0 12px;color:#161514;font-weight:600">${esc(title)}</h1>
<p style="font-size:15px;line-height:1.55;color:#161514;margin:0 0 18px">${esc(intro)}</p>
${rows.length ? `<table role="presentation" width="100%" style="border-top:1px solid #D9D3C7;border-bottom:1px solid #D9D3C7;margin:0 0 18px">${rowsHtml}</table>` : ''}
${blocksHtml}
${cta ? `<p style="margin:22px 0"><a href="${esc(cta.url)}" style="background:#161514;color:#F4F1EA;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:14px;display:inline-block">${esc(cta.label)}</a></p><p style="font-size:12px;color:#5E5A54;word-break:break-all">${esc(cta.url)}</p>` : ''}
</td></tr>
<tr><td style="padding:18px 32px 28px;font-size:12px;line-height:1.5;color:#5E5A54;border-top:1px solid #EAE5DB">
${footerNote ? `${esc(footerNote)}<br><br>` : ''}FRAME S.L. · Rambla Juan Mateo García, 21 · 03183 Torrevieja (Alicante) · +34 676 676 767 · frame@gmail.com<br>
${es ? 'Este correo es un justificante de tu operación; no es una factura.' : 'This email is a receipt for your operation; it is not an invoice.'}
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    'FRAME', '', title, '', intro, '',
    ...rows.map(([k, v]) => `${k}: ${v}`), rows.length ? '' : null,
    ...blocks, blocks.length ? '' : null,
    cta ? `${cta.label}: ${cta.url}` : null, cta ? '' : null,
    footerNote || null,
    'FRAME S.L. · Rambla Juan Mateo García, 21 · 03183 Torrevieja (Alicante) · +34 676 676 767 · frame@gmail.com',
    es ? 'Este correo es un justificante de tu operación; no es una factura.' : 'This email is a receipt for your operation; it is not an invoice.',
  ].filter((l) => l !== null).join('\n');
  return { html, text };
}

export { money, T };
