# Estructura de datos

Base de datos **SQLite** (`node:sqlite`, un único archivo `data/frame.db`, modo WAL, claves foráneas activas). El esquema completo está en [`src/db/schema.sql`](../src/db/schema.sql).

Convenciones:
- Instantes en **milisegundos UTC** (`*_utc`, `created_at`…). Fechas del calendario local de Madrid como texto `AAAA-MM-DD` (`local_date`).
- Importes en **céntimos** (`*_cents`). Tipos de IVA en **puntos básicos** (`2100` = 21 %).
- Textos bilingües con sufijo `_es` / `_en`. Listas como JSON.

## Tablas

| Tabla | Contenido |
|---|---|
| `settings` | Ajustes editables (negocio, horario, comercio e IVA, políticas, día de prueba, visitas, planes, analítica) en JSON |
| `content` | Textos de la web modificados desde el panel (sobrescriben los originales) |
| `users` | Personas del panel: rol `admin`/`staff`, contraseña con scrypt, bloqueo por intentos |
| `sessions` | Sesiones de panel y de clientes (se guarda el hash del identificador, nunca el valor) y su token CSRF |
| `login_tokens` | Enlaces de acceso a Mi cuenta (hash, caducan en 20 min, un solo uso) |
| `customers` | Clientes: correo único, datos de contacto y facturación, idioma, consentimiento de comunicaciones con fecha, `link_version` |
| `spaces` | Fichas públicas de coworking, salas, despachos y estudio |
| `products` | Tarifas: pase, bono, planes, por horas, visita, prueba, presupuesto. `price_cents` NULL = sin tarifa publicada |
| `resources` | Inventario reservable: puestos (`desk_pool` con capacidad y máximo de fijas), salas, cabinas (grupo), estudio, despachos, visitas. Horario semanal, franjas, márgenes y modo de reserva |
| `bookings` | Reservas: tipo (`desk_day`, `hourly`, `visit`, `office`), uso, estado, estado del cobro, inicio/fin, personas, **copia del precio y de las condiciones aceptadas**, bono/plan/pedido asociados, retención temporal |
| `booking_slots` | Ocupación de cada recurso en franjas de 15 minutos. Clave primaria `(resource_id, slot_start)` |
| `orders` | Pedidos de pago: proveedor (`stripe`, `test`, `manual`), estado, líneas con precios aplicados, impuestos, condiciones, importes devueltos |
| `payment_events` | Notificaciones de la pasarela ya procesadas. Único por `(provider, event_id)` |
| `vouchers` | Bonos: créditos, validez, un bono por pedido (`order_id` único) |
| `voucher_ledger` | Movimientos del bono (compra, uso, devolución, ajuste, caducidad) |
| `plans` | Planes mensuales (flexible, fija con puesto asignado, oficina virtual), periodo actual, renovación y baja |
| `blocks` | Bloqueos de un recurso o de todo el centro (festivos, mantenimiento); en coworking, de algunos puestos |
| `requests` | Mensajes de contacto y peticiones de presupuesto |
| `trials` | Día de prueba: uno por correo |
| `faqs`, `events`, `event_signups`, `media` | Preguntas, agenda de comunidad e inscripciones, imágenes (con marca de imagen conceptual) |
| `outbox` | Correos generados (enviados o guardados en modo prueba) |
| `audit_log` | Registro de actividad |

## Reglas que garantizan la integridad

- **Sin solapes**: al reservar un recurso por horas se insertan sus franjas en `booking_slots` dentro de una transacción `BEGIN IMMEDIATE`. La clave primaria impide en la propia base de datos que dos reservas ocupen la misma franja, aunque lleguen a la vez desde distintos procesos. Los márgenes de limpieza también ocupan franjas.
- **Puestos compartidos**: los puestos del día = capacidad − mesas fijas activas − puestos bloqueados − personas con reserva activa. Se calcula y se vuelve a comprobar dentro de la misma transacción antes de confirmar; nunca puede quedar por debajo de cero.
- **Retenciones**: una reserva pendiente de pago retiene el hueco 35 min y una solicitud 48 h (configurable). Al caducar se libera sola.
- **Bonos**: el saldo es la suma de `voucher_ledger.delta`. Un *trigger* rechaza cualquier movimiento que deje el saldo en negativo, y un índice único impide registrar dos veces el mismo uso o devolución de una reserva.
- **Pagos idempotentes**: cada notificación se registra en `payment_events` dentro de la misma transacción que la aplica; si llega repetida, se ignora. Se comprueba la firma (HMAC con tolerancia de 5 min) y que el importe coincide con el pedido. Si un pago llega cuando el hueco ya se liberó y está ocupado, el pedido queda en «reembolso pendiente».
- **Precios en el servidor**: el navegador nunca envía importes. Cada reserva y pedido guarda el precio, el IVA aplicado y el texto de las condiciones aceptadas.
- **Enlaces de gestión**: firmados con HMAC sobre la referencia y la `link_version` del cliente; cambiar el correo o invalidarlos desde el panel los anula.
- **Zona horaria**: todas las fechas y horas se interpretan en Europe/Madrid, con días de 23 y 25 horas en los cambios de hora.
