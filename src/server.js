// Punto de entrada: crea el contexto, la aplicación y arranca el servidor HTTP.
import { createContext, createApp, startJobs } from './app.js';

const ctx = createContext();
const app = createApp(ctx);
startJobs(ctx);

const server = app.listen(ctx.cfg.port, () => {
  const { cfg } = ctx;
  console.log(`\n  FRAME en ${cfg.baseUrl}  (${cfg.env})`);
  console.log(`  Base de datos: ${cfg.dbFile}`);
  console.log(`  Pagos: ${ctx.payments.provider === 'stripe' ? `Stripe${ctx.payments.testMode ? ' (modo test)' : ''}` : ctx.payments.provider === 'test' ? 'pasarela de PRUEBA local (no cobra)' : 'desactivados'}`);
  console.log(`  Correo: ${ctx.mail.configured ? 'SMTP configurado' : 'modo prueba (no se envía; bandeja en /admin/correos)'}`);
  if (ctx.seeded.seeded) {
    console.log(`\n  Base de datos creada con el inventario y las tarifas iniciales (editables en el panel). Accesos a /admin:`);
    for (const c of ctx.seeded.credentials) {
      // Una contraseña indicada en ADMIN_PASSWORD no se repite en el registro.
      const shown = cfg.adminPassword && c.password === cfg.adminPassword ? '(la de ADMIN_PASSWORD)' : c.password;
      console.log(`   · ${c.role.padEnd(5)} ${c.email} / ${shown}${cfg.isProd ? '  · se pedirá cambiarla al entrar' : ''}`);
    }
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { ctx.db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
