# FRAME · Coworking y estudio de pódcast en Torrevieja

Web completa de **FRAME** (Rambla Juan Mateo García, 21 · 03183 Torrevieja): página pública en español e inglés, reservas con disponibilidad real, pagos preparados para Stripe, área de clientes, gestión de reservas por enlace y panel de administración.

> **Todo arranca en modo prueba.** Sin claves configuradas, la web **no cobra nada** (usa una pasarela de pago simulada) y **no envía correos** (los guarda en una bandeja de pruebas). Las tarifas son orientativas y la venta online está desactivada hasta que la administración confirme tarifas, IVA y condiciones.

---

## 1. Probarla en 2 minutos desde la nube (GitHub Codespaces)

No necesitas instalar nada:

1. En GitHub, abre el repositorio y cambia a la rama `claude/busy-planck-d9epqj`.
2. Pulsa **Code → Codespaces → Create codespace on claude/busy-planck-d9epqj**.
3. Espera a que termine `npm install`. El servidor se arranca solo (terminal «servidor») y se abre la vista previa del puerto **3000**. Si no se abre, ve a la pestaña **Ports** y pulsa el globo del puerto 3000.

El contenedor ya está configurado en `.devcontainer/devcontainer.json` (Node 22).

## 2. Probarla en tu ordenador

Necesitas **Node.js 22.13 o superior** (incluye SQLite, no hace falta instalar base de datos).

```bash
npm install
```

```bash
npm start
```

Abre <http://localhost:3000>. Para empezar de cero con los datos de demostración:

```bash
npm run reset
```

## 3. Accesos de demostración

| Dónde | Usuario | Contraseña | Puede |
|---|---|---|---|
| Panel `/admin` | `admin@frame.test` | `frame-admin-demo` | Todo: reservas, tarifas, IVA, ajustes, contenidos, pagos, usuarios |
| Panel `/admin` | `recepcion@frame.test` | `frame-staff-demo` | Reservas, solicitudes, calendario, clientes, bloqueos |
| Clientes | cualquier correo con una reserva | — | Entran en **Mi cuenta** con un enlace que llega por correo |

Los correos de prueba se ven en **`/correo-prueba`** (solo los generados desde tu navegador) y en **Panel → Correos**.

## 4. Guion de prueba (15 minutos)

**Web pública**
1. **Inicio** (`/`): titular grande, buscador de disponibilidad, espacios, tarifas, preguntas frecuentes y mapa (el mapa solo carga si aceptas las cookies).
2. **Inglés**: botón `EN` arriba a la derecha o `/en`.
3. **Cookies**: «Rechazar» y «Aceptar» tienen el mismo peso; «Configurar» permite elegir. Sin aceptar no se carga analítica ni el mapa.
4. **Móvil**: abre la web en el teléfono o con el modo responsive del navegador. El botón «Reservar» está siempre accesible.

**Reserva sin venta online (estado inicial)**
5. Ve a **Reservar** (`/reservar`). Arriba verás la **maqueta 3D de cristal** del local: toca una zona (sala, estudio, cabinas…) para elegir ese servicio, o usa el modo 360°.
6. Elige **Sala de reuniones** → fecha → hora → tus datos → revisa y acepta. Como la venta está desactivada, se guarda como **solicitud sin ningún cargo** y te lleva a la página de gestión de la reserva.
7. Prueba a reservar el **mismo hueco** desde otra ventana privada: la web no lo permite.

**Panel de administración**
8. Entra en `/admin` con la cuenta de administración. En **Solicitudes** confirma la reserva: el cliente recibe el correo (míralo en **Correos**).
9. Ve a **Tarifas e impuestos**, marca las casillas, escribe **21** en el IVA y activa la venta online. *(El 21 % es solo para probar; el tipo real lo decide FRAME.)*

**Reserva con pago (pasarela de prueba)**
10. Reserva un **Pase de día**. En la revisión verás el **precio final con IVA** (15 € + 21 % = 18,15 €) antes de pagar.
11. Llegas a la **pasarela de prueba**. Prueba sus botones: *pago correcto*, *rechazado*, *sesión caducada*, *volver sin pagar* y *reenviar la última notificación* (comprueba que una notificación repetida no duplica nada).
12. Con el pago correcto, la reserva queda **confirmada y pagada**. Abre el **justificante** (no es una factura) y prueba a **imprimirlo o guardarlo en PDF**.
13. Desde la página de gestión prueba **cambiar la fecha** y **cancelar** (se aplica la política: cancelación gratuita hasta 24 h antes).

**Área de clientes y bonos**
14. En **Mi cuenta** (`/cuenta`) escribe el correo usado y abre el enlace desde `/correo-prueba`. Verás reservas, bonos, planes, justificantes y tus datos.
15. Compra el **Bono 10 días**, págalo en la pasarela de prueba y reserva un día con el bono: el saldo baja y, si cancelas a tiempo, el día vuelve al bono (con historial de movimientos).

**Más cosas del panel**: calendario por horas, bloqueos (mantenimiento, festivos), clientes con exportación y anonimización (RGPD), bonos con ajustes, planes (mesa flexible, fija con puesto asignado y oficina virtual), recursos e inventario, textos de la web en ES/EN, fichas de espacios, preguntas, eventos con inscripciones, fotos, informes de ocupación e ingresos, pagos y registro de actividad. Detalles en [`docs/ADMINISTRACION.md`](docs/ADMINISTRACION.md).

## 5. Pruebas automáticas

```bash
npm test
```

46 pruebas sobre una base de datos temporal: disponibilidad e inventario compartido, festivos y bloqueos, cambio de hora (Europe/Madrid), **concurrencia** (20 peticiones simultáneas al mismo hueco y 6 procesos distintos sobre el mismo archivo de base de datos: solo una reserva gana), cambios y cancelaciones, bonos sin saldo negativo, pagos (correcto, rechazado, caducado, duplicado, importe alterado, pago tardío, firma inválida), acceso a datos ajenos (IDOR), protección del panel y permisos por rol, CSRF, formularios, inglés, SEO y persistencia tras reiniciar.

Recorrido en un navegador real (necesita Playwright y el servidor arrancado con una base de datos recién creada):

```bash
npm run test:e2e
```

## 6. Configuración

Copia `.env.example` como `.env`. Sin variables, todo funciona en modo prueba. Las más importantes:

| Variable | Para qué |
|---|---|
| `BASE_URL` | Dirección pública con `https` (enlaces de correos, pagos, SEO) |
| `APP_SECRET` | Firma de enlaces y tokens. Obligatoria en producción (≥ 32 caracteres) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer usuario del panel en producción |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Activan Stripe Checkout y sus notificaciones (`/webhooks/stripe`) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Envío real de correos |
| `NOTIFY_TO` | Buzón que recibe los avisos de solicitudes |
| `TRUST_PROXY` | `1` detrás de un proxy (Render, Railway, Nginx) |

Las claves privadas **nunca** van en el código: solo en `.env` (ignorado por git) o en las variables del servidor.

## 7. Publicarla

- **Docker**: `docker build -t frame-web .` y ejecútala con un volumen en `/app/data` (base de datos y fotos subidas).
- **Render**: el archivo `render.yaml` crea un servicio de **demostración** con disco persistente (pasarela simulada y bandeja de pruebas activadas). Para la web real sigue la lista de [`docs/PENDIENTES.md`](docs/PENDIENTES.md).
- Haz copias de seguridad del archivo `data/frame.db` (por ejemplo, una copia diaria del disco).

## 8. Qué hay dentro

```
src/
  app.js, server.js        composición de la aplicación y arranque
  config.js                variables de entorno
  db/                      esquema SQLite, datos iniciales, acceso con transacciones
  services/                reservas, pagos, bonos y planes, precios, correo, avisos
  routes/                  web pública, API, Mi cuenta, gestión por enlace, pagos, panel (admin/)
  views/                   plantillas HTML (escapado automático), panel (admin/)
  i18n/                    rutas y textos ES/EN
  config/layout.js         distribución del local para la maqueta 3D
public/
  css/, js/                estilos y scripts (maqueta 3D en js/model/)
  brand/                   logotipo original de FRAME en SVG
  img/renders/             imágenes conceptuales generadas desde la maqueta
scripts/                   generación de renders y del logotipo
tests/                     pruebas automáticas y recorrido en navegador
docs/                      administración, estructura de datos y pendientes
```

- Estructura de datos y reglas de integridad: [`docs/DATOS.md`](docs/DATOS.md).
- Manual del panel: [`docs/ADMINISTRACION.md`](docs/ADMINISTRACION.md).
- Credenciales y decisiones pendientes antes de abrir: [`docs/PENDIENTES.md`](docs/PENDIENTES.md).

### Imágenes y marca

- Las imágenes de la web son **renders conceptuales** de la maqueta 3D (llevan un aviso y no se presentan como fotos reales). Se sustituyen desde **Panel → Fotos** cuando haya fotografías del local.
- La distribución sigue el reparto de superficies de FRAME (coworking 180 m², despachos 60, aseos y pasillos 50, salas 40, cocina y café 30, estudio 25, cabinas 15). Es una maqueta: no hay planos reales.
- Regenerar los renders (necesita Chromium y Playwright): `npm run render:images`.
- El logotipo original está vectorizado en `public/brand/`. Para regenerarlo: `npm run brand` (necesita Python con `fonttools` y `brotli`).
