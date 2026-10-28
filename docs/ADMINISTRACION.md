# Manual del panel de administración

El panel está en **`/admin`**. Funciona en el ordenador y en el móvil (menú en la parte superior).

## Accesos y roles

| Rol | Puede |
|---|---|
| **Recepción** | Panel diario, calendario, reservas (crear, confirmar, cambiar, cancelar), solicitudes, bloqueos, clientes (datos y notas), ver bonos y planes, eventos (inscritos) y correos |
| **Administración** | Todo lo anterior y además tarifas e IVA, ajustes, recursos e inventario, textos de la web, fichas, preguntas, eventos, fotos, informes, pagos y reembolsos, registro de actividad y usuarios. También las acciones con dinero: marcar como cobrado, emitir bonos, activar planes |

- Los permisos se comprueban en el servidor: aunque alguien conozca la dirección de una página, si su rol no la permite recibe un error.
- Tras **5 intentos fallidos** la cuenta se bloquea 15 minutos.
- Los usuarios nuevos reciben una **contraseña temporal** (se muestra una sola vez) y deben cambiarla al entrar. **Mi cuenta** (abajo en el menú) permite cambiar la contraseña; al hacerlo se cierran las demás sesiones.
- El primer usuario de producción se define con `ADMIN_EMAIL` y `ADMIN_PASSWORD`.

## Operativa diaria

### Panel
Resumen de hoy: puestos ocupados (reservas + mesas fijas + bloqueados), reservas del día, pendientes de confirmar y lo cobrado en el mes. Arriba aparecen los **avisos**: venta online desactivada (y qué falta), horario sin confirmar, reembolsos pendientes y planes con pago pendiente.

### Calendario
- Día a día con flechas o selector de fecha. La tira superior muestra los puestos ocupados de la semana.
- **Salas, cabinas, estudio y visitas** en una línea de tiempo: en negro las confirmadas, en amarillo las solicitudes o pagos pendientes, rayado los bloqueos. Pulsa una reserva para abrirla.
- **Despachos**: quién ocupa cada despacho ese día.

### Reservas
- Filtros por texto (referencia, nombre, correo, teléfono), estado, tipo, espacio y fechas. **Exportar CSV** descarga lo filtrado (abre bien en Excel).
- **Nueva reserva**: puesto (día), sala/cabina/estudio/visita (por horas) o despacho (por fechas). Se respeta siempre la disponibilidad real: no se pueden solapar reservas ni superar los puestos. Puedes dejarla confirmada o como solicitud, indicar el cobro (sin cobro, pendiente, cobrado en recepción, incluido en el plan) y enviar el correo al cliente.
- **Ficha de la reserva**:
  - *Confirmar y avisar* / *Rechazar* (solicitudes).
  - *Cambiar fecha u hora* (comprueba disponibilidad).
  - *Cancelar* con devolución «según la política», «devolver» o «no devolver». Si estaba pagada online y se devuelve, se pide el reembolso a la pasarela; si era con bono, los días vuelven al bono.
  - *Marcar como cobrado en recepción* (administración).
  - *Reenviar correo*, notas internas, **enlace de gestión** del cliente (para copiarlo) e historial de cambios y correos.
  - El importe que se muestra es el que se guardó al reservar: si después cambias una tarifa, las reservas anteriores no cambian.

### Solicitudes
- Reservas pendientes de confirmar (el hueco queda retenido 48 h; si no se confirma, se libera solo).
- Altas de planes solicitadas.
- Mensajes de contacto y peticiones de presupuesto (despachos, estudio…) con estado *Nueva / En curso / Cerrada* y notas.

### Bloqueos
Cierra un espacio o todo el centro durante un intervalo (mantenimiento, festivo, uso interno). En coworking puedes bloquear solo algunos puestos. **No cancela reservas existentes**: si hay coincidencias, el panel te las enumera para que decidas.

## Clientes, bonos y planes

- **Clientes**: búsqueda, ficha con datos, reservas, pedidos, bonos y planes. Desde la ficha puedes crear una reserva, emitir un bono, dar de alta un plan e **invalidar los enlaces de gestión** enviados. Cambiar el correo de un cliente también los invalida.
  - **RGPD**: *Exportar sus datos (JSON)* y *Anonimizar* (si no tiene reservas futuras ni planes activos; los pedidos se conservan por obligación legal).
  - Si alguien pide la baja de comunicaciones, desmarca la casilla. Solo la propia persona puede darse de alta desde la web.
  - **Exportar contactos con consentimiento**: solo quienes aceptaron recibir comunicaciones.
- **Bonos**: saldo, validez e historial de movimientos (compra, uso, devolución, ajuste). La base de datos **impide que el saldo quede en negativo**. Administración puede ajustar días, cambiar la caducidad o anular un bono, y emitir bonos pagados en recepción.
- **Planes**: mesa flexible, mesa fija 24/7 (con puesto asignado F-01, F-02…) y oficina virtual. Acciones: activar (cobro en recepción), rechazar, registrar el pago de la renovación (+1 mes), baja al final del periodo o baja inmediata. Las mesas fijas descuentan un puesto del coworking todos los días y no se puede superar el máximo configurado.

## Catálogo (administración)

### Recursos
Inventario reservable: puestos de coworking (número total y máximo de mesas fijas), salas, cabinas, estudio, despachos y visitas. Para cada uno: capacidad, modo (reserva inmediata, solicitud o solo presupuesto), franjas y duraciones, margen de limpieza entre reservas, **horario reservable por día** (formato `09:00-14:00, 16:00-19:00`, vacío = cerrado, `24h` = todo el día) y equipamiento. No se puede reducir la capacidad por debajo de lo ya reservado.

### Tarifas e impuestos
- Lista de comprobación para activar la **venta online**: tarifas confirmadas, IVA configurado, condiciones aprobadas, pasarela de pago y activación.
- **IVA**: la web no presupone ningún tipo. Mientras no se configure, muestra importes base orientativos y **no cobra nada**: las reservas con tarifa se guardan como solicitudes.
- Cada tarifa: importe base sin impuestos (vacío = «Solicitar presupuesto»), visible, destacada, máximo por reserva, días y validez del bono, textos ES/EN e incluidos.
- El precio final con impuestos se muestra al cliente **antes** de pagar y queda guardado en cada reserva y pedido.

### Ajustes
Datos del negocio (una sola sede), horario publicado (marca «confirmado» cuando sea el definitivo), políticas de reserva (cancelación, cambios, antelación, retenciones, validez de bonos), día de prueba gratuito, visitas guiadas, planes (máximo de miembros, permanencia) y analítica (solo se carga con consentimiento).

## Web (administración)

- **Textos**: titulares y textos de cada página en español e inglés. Vacío = texto original.
- **Fichas de espacios**: nombre, descripción, incluidos, equipamiento, condiciones, superficie y visibilidad.
- **Preguntas**: preguntas frecuentes (también se publican como datos estructurados para Google).
- **Eventos**: agenda de comunidad con plazas y lista de inscritos en cada ficha. Solo actividades reales con fecha.
- **Fotos**: imágenes por apartado. Solo JPG, PNG o WebP reales (se comprueba el contenido del archivo, máx. 8 MB). Marca «conceptual» en los renders; desmárcalo en las fotos reales. El texto alternativo es obligatorio en los dos idiomas.

## Sistema (administración)

- **Informes**: ocupación de puestos por día, horas reservadas de salas, cabinas y estudio, ingresos por tipo y planes vigentes. Exportación CSV. No sustituye a la contabilidad.
- **Pagos**: pedidos y notificaciones de la pasarela. Un pedido solo pasa a «Pagado» con una notificación firmada; las repetidas se ignoran. Reembolsos pendientes: reintentar en la pasarela o marcar como devuelto.
- **Correos**: todo lo enviado (o guardado en modo prueba) con vista previa.
- **Registro**: quién hizo qué y cuándo (accesos, cambios de reservas, tarifas, ajustes, exportaciones…).
- **Usuarios**: alta de personas de recepción o administración, contraseña temporal, activar o desactivar (siempre queda al menos una persona de administración).
