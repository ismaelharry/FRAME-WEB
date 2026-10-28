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
    console.log('\n  Base de datos creada con datos de demostración. Accesos al panel /admin:');
    for (const c of ctx.seeded.credentials) console.log(`   · ${c.role.padEnd(5)} ${c.email} / ${c.password}`);
  }
  console.log('');
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { ctx.db.close(); process.exit(0); }); setTimeout(() => process.exit(0), 3000).unref(); });
}
