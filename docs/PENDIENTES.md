# Pendiente antes de abrir la web al público

La web funciona de principio a fin en **modo prueba**. Para usarla con clientes reales faltan credenciales que solo puede aportar FRAME y algunas decisiones de negocio. Nada de esto se ha inventado: donde faltaba un dato, la web lo marca como pendiente o no lo publica.

## 1. Credenciales y servicios (variables del servidor, nunca en el código)

| Qué | Dónde se configura | Mientras falte |
|---|---|---|
| **Dominio y HTTPS** (p. ej. `https://frame…`) | `BASE_URL`, DNS del dominio | Enlaces de correos y SEO apuntan a la dirección de pruebas |
| **Secreto de la aplicación** | `APP_SECRET` (≥ 32 caracteres aleatorios) | Obligatorio en producción: el servidor no arranca sin él |
| **Primer usuario del panel** | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Se crea `admin@frame.local` con contraseña aleatoria mostrada una vez |
| **Stripe** (cuenta verificada de FRAME S.L.) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` y webhook en `{BASE_URL}/webhooks/stripe` (eventos en `.env.example`) | No hay cobro online: las reservas con tarifa se guardan como solicitudes |
| **Servidor de correo** (SMTP del dominio o un servicio como Brevo, Postmark, SES) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | Los correos no se envían: se ven en Panel → Correos. Configura también SPF, DKIM y DMARC del dominio |
| **Buzón de avisos** | `NOTIFY_TO` | Los avisos van a `frame@gmail.com` |
| **Alojamiento con disco persistente y copias de seguridad** | Docker / `render.yaml` | — |
| **Analítica** (opcional) | Panel → Ajustes → Analítica | Sin analítica (y nunca sin consentimiento) |

## 2. Decisiones de negocio (desde el panel)

- [ ] **IVA**: tipo que aplica FRAME a cada servicio, confirmado con su asesoría (Panel → Tarifas e impuestos). La web no presupone ninguno.
- [ ] **Tarifas definitivas**: confirmar pase de día (15 €), bono 10 días (120 €), mesa flexible (160 €/mes), mesa fija 24/7 (190 €/mes), oficina virtual (20 €/mes) y sala (20 €/h) como importes **sin IVA**.
- [ ] **Precios de cabinas y estudio** (ahora «Solicitar presupuesto»). Los despachos funcionan por presupuesto.
- [ ] **Condiciones de contratación**: cancelación gratuita (ahora 24 h antes), cambios (24 h), antelación mínima (60 min), reserva máxima (90 días), devolución fuera de plazo (no). Marcar como aprobadas en Tarifas e impuestos.
- [ ] **Permanencia** de los planes: configurada como «sin permanencia» en los tres, según la presentación de FRAME. Confirmar.
- [ ] **Renovaciones de planes**: con la venta activada, la web envía un enlace de pago 7 días antes de cada renovación. Si se prefiere domiciliación automática (Stripe Billing), es una ampliación.
- [ ] **Horario real** de recepción y del coworking (Panel → Ajustes) y marcar «Horario confirmado» (hasta entonces no se publica en los datos para Google).
- [ ] **Acceso 24/7** de la mesa fija: cómo se entrega (llave, tarjeta, código). Fines de semana para el resto de planes: ahora cerrado.
- [ ] **Inventario real** (Panel → Recursos): número de puestos (35 de demostración), máximo de mesas fijas (10), capacidad de cada sala, cabinas y despachos, horarios reservables y margen de limpieza del estudio.
- [ ] **Día de prueba gratuito**: mantener, condiciones y días.
- [ ] **Visitas guiadas**: franjas (ahora 10:00–13:30 y 16:30–18:30 de lunes a viernes) y confirmación automática.
- [ ] **Festivos locales** de Torrevieja (están cargados los nacionales de diciembre y enero): añadirlos en Bloqueos.

## 3. Textos legales y datos de empresa

- [ ] **Datos registrales** de FRAME S.L. (Registro Mercantil de Alicante: tomo, folio, hoja) para el aviso legal (Panel → Ajustes → Datos del negocio).
- [ ] Revisión por un profesional de **aviso legal, privacidad, cookies y condiciones**. Están redactados con los datos comerciales de FRAME, pero deben validarse (responsable del tratamiento, plazos de conservación, encargados como Stripe, el proveedor de correo y el alojamiento).
- [ ] **Facturación**: la web emite justificantes, no facturas. Definir cómo se emiten las facturas (programa de facturación o gestoría) y, si se quiere, conectarlo.
- [ ] Correo de contacto: se usa `frame@gmail.com`; valorar un correo del dominio propio.
- [ ] Redes sociales oficiales (Instagram, LinkedIn) si existen.

## 4. Contenido

- [ ] **Fotografías reales** del local (Panel → Fotos). Las imágenes actuales son renders conceptuales de una maqueta con el reparto de superficies de FRAME y se indican como tales.
- [ ] **Equipamiento real** de salas y estudio (micrófonos, cámaras, iluminación…) en Panel → Fichas de espacios y Recursos. Ahora se describe de forma genérica.
- [ ] **Agenda de comunidad**: publicar solo eventos reales con fecha (Panel → Eventos).
- [ ] Revisar las **preguntas frecuentes** y los textos de la portada (Panel → Textos y Preguntas).

## 5. Antes de publicar

- [ ] `NODE_ENV=production` y **sin** `ALLOW_TEST_GATEWAY` ni `DEMO_MAILBOX`.
- [ ] Hacer una compra real de importe mínimo con Stripe en modo real y reembolsarla.
- [ ] Comprobar que llegan los correos (confirmación, solicitud, acceso a Mi cuenta).
- [ ] Copia de seguridad diaria de `data/frame.db` y de las fotos subidas.
- [ ] Alta en Google Search Console con el `sitemap.xml` y ficha de Google Business Profile con los mismos datos (nombre, dirección y teléfono).
