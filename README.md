# Parada Bridge

Plataforma web de asesoría jurídica y contable en línea. Un cliente describe su caso, la plataforma lo pone en contacto con un abogado, un contador o una firma verificada, y la consulta completa ocurre dentro del sitio: chat, documentos, firma electrónica, pago y recibo.

Sitio en producción: [paradabridge.com](https://paradabridge.com)

## Qué hace

**Para el cliente (no necesita cuenta)**

- Inicia una consulta eligiendo al profesional o dejando que un asistente de IA clasifique el caso y recomiende a quién acudir.
- Verifica su correo con un código antes de abrir la sala.
- Conversa en un chat en vivo con texto, archivos y notas de voz, con confirmación de lectura y estado de conexión.
- Firma documentos dentro del chat. La firma se ubica sola en el bloque del firmante y deja un certificado.
- Paga la asesoría, adjunta el comprobante y recibe un recibo en PDF.
- Al cerrar, califica la atención y puede radicar una petición, queja o reclamo (PQRS).

**Para el abogado y el contador**

- Perfil público con foto, video de presentación y documentos de confianza.
- Panel de consultas con filtros por estado, mensajes sin leer y todas las acciones del caso: definir el cobro, confirmar el pago, enviar el contrato de servicios, pedir verificación a la administración y finalizar.
- Contrato de prestación de servicios a partir de la plantilla oficial. Antes de enviarlo a firma, la plataforma compara el archivo contra la plantilla cláusula por cláusula.
- Asistente de IA para redactar y analizar (peticiones, tutelas, contratos, conceptos), con adjuntos y exportación a Word o PDF.
- Solicitudes abiertas: casos sin profesional asignado que toma el primero que los acepta.
- Pago de la comisión de la plataforma, chat interno con la administración y centro de notificaciones.

**Para la firma (bufete o firma contable)**

- Perfil propio con su equipo: un Director y sus aliados o colaboradores, publicados como fichas informativas.
- Las consultas dirigidas a cualquier miembro llegan a la firma, que las atiende y las cobra desde su panel.

**Para el gestor (referidos)**

- Código y QR propios para referir clientes.
- Seguimiento de cada caso referido por correo, estadísticas y comisiones con solicitud de pago.

**Para la administración**

- Revisión y aprobación de registros, con dos roles de panel: `superadmin` y `admin` (el segundo hace todo menos gestionar roles y cuentas de panel).
- Pagos y cobros: porcentajes de la plataforma y del gestor, asesorías cobradas, pagos de profesionales y comisiones de gestores con comprobante.
- Historial y moderación de consultas, alertas de inactividad con reasignación, chat interno, contratos, opiniones, PQRS, noticias y videos del inicio.

**Además, en la parte pública**

- Directorio de profesionales con filtros por área y ubicación, ranking y mapa de Colombia.
- Debate ciudadano de proyectos de ley: voto por proyecto completo o artículo por artículo, comentarios y resultados descargables.
- Modelos contractuales y los documentos legales oficiales de la plataforma.

## Tecnología

| Capa | Herramientas |
|------|--------------|
| Interfaz | React 18, Vite 5, React Router 6, CSS Modules, Framer Motion |
| Datos | Supabase: Postgres, Auth, Storage y Realtime |
| Servidor | Funciones serverless de Vercel (Node), tarea programada diaria |
| IA | Claude (Anthropic), siempre a través de `api/ai.js` |
| Correo | Nodemailer sobre Gmail SMTP |
| Documentos | pdf-lib, pdf.js, docx, docx-preview |
| Gráficos y mapa | Recharts, d3, topojson |
| Medios | ffmpeg.wasm en el navegador, sharp en la compilación |
| Integraciones | reCAPTCHA v3, Wompi, Alegra, WhatsApp Cloud API, Vercel Analytics |

La aplicación no usa el SDK de Supabase. Tiene un cliente propio, [src/lib/supabase.js](src/lib/supabase.js), que habla con la API REST y con Realtime por WebSocket.

## Puesta en marcha

Requisitos: Node 18 o superior, npm, un proyecto de Supabase y, para las funciones de `/api`, la CLI de Vercel.

```bash
git clone https://github.com/estebandavidariasg-stack/abogados-asociados-parada.git
cd abogados-asociados-parada
npm install
```

Crea un archivo `.env.local` en la raíz con las variables de la sección siguiente y arranca el entorno:

```bash
npm run dev      # solo la interfaz, en http://localhost:5173
vercel dev       # interfaz + funciones de /api
```

`npm run dev` no sirve las funciones de `/api`. Todo lo que dependa de ellas (códigos al correo, IA, listado público en caché, notificaciones) necesita `vercel dev`. Los webhooks de Wompi y WhatsApp solo llegan a una URL pública, así que no se pueden recibir en local.

### Comandos

| Comando | Qué hace |
|---------|----------|
| `npm run dev` | Servidor de desarrollo de Vite |
| `npm run build` | Compilación de producción en `dist/` |
| `npm run preview` | Sirve la compilación en local |
| `npm run optimize:hero` | Regenera las imágenes del inicio (AVIF, WebP y JPG en tres anchos) desde `assets-source/hero/` |
| `node --test test/aiLogic.test.mjs` | Pruebas unitarias de la lógica del triage de IA |

No hay linter ni verificador de tipos configurados. Fuera de esa prueba, la verificación es `npm run build` más la revisión en el navegador.

## Variables de entorno

Solo se listan los nombres. Los valores viven en `.env.local` (ignorado por git) y en la configuración del proyecto en Vercel. Las variables `VITE_*` terminan en el código que descarga el navegador, así que solo pueden contener valores públicos.

**Interfaz**

| Variable | Para qué |
|----------|----------|
| `VITE_SUPABASE_URL` | URL del proyecto de Supabase |
| `VITE_SUPABASE_ANON_KEY` | Clave pública (anon) de Supabase |
| `VITE_RECAPTCHA_SITE_KEY` | Clave de sitio de reCAPTCHA v3 |
| `VITE_APP_URL` | URL pública de la aplicación, usada en los correos |

**Servidor (obligatorias)**

| Variable | Para qué |
|----------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Operaciones de administración desde las funciones. Nunca debe llegar al navegador |
| `SUPABASE_JWT_SECRET` | Firma el token de sesión del chat del cliente |
| `RECAPTCHA_SECRET_KEY` | Valida reCAPTCHA en el envío de códigos y en la recuperación de contraseña |
| `GMAIL_USER`, `GMAIL_PASS` | Cuenta remitente y contraseña de aplicación para el correo |
| `ANTHROPIC_API_KEY` | Clave de Anthropic, usada solo por `api/ai.js` |
| `CRON_SECRET` | Protege la tarea programada |

**Servidor (opcionales)**

| Variable | Para qué |
|----------|----------|
| `ADMIN_NOTIFY_EMAIL` | Correo que recibe los avisos de la administración |
| `AI_IP_SALT` | Sal con la que las IP se guardan como hash. Tiene un valor por defecto, en producción conviene definir uno propio |
| `FIRMA_PROOF_SECRET` | Secreto de las pruebas de verificación. Si falta, se usa la clave de servicio |
| `AI_CLIENTE_MAX_MSGS` | Mensajes por sesión de triage (6 por defecto) |
| `AI_MAX_SESIONES_IP_HORA` | Sesiones de triage por IP y hora (10 por defecto) |
| `AI_MAX_USOS_SALA_DIA` | Análisis de IA por sala y día (2 por defecto) |
| `AI_MAX_CENSURAS_SALA_DIA` | Revisiones de adjuntos por sala y día (30 por defecto) |
| `CHAT_TOKEN_MAX_IP_HORA` | Tokens de chat por IP y hora (60 por defecto) |
| `WOMPI_PUBLIC_KEY`, `WOMPI_INTEGRITY_SECRET`, `WOMPI_EVENTS_SECRET` | Pasarela de pago Wompi |
| `ALEGRA_EMAIL`, `ALEGRA_TOKEN` | Factura de la comisión en Alegra |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ENFORCE_TOKEN` | Webhook de WhatsApp Cloud API |

## Estructura del proyecto

```
api/                  Funciones serverless de Vercel
  _lib/               Código compartido (no se publica como ruta)
  cron/               Tarea programada
public/               Estáticos: imágenes del inicio, logos, sitemap
  legal/              PDF legales oficiales y plantillas de contrato en Word
src/
  App.jsx             Rutas
  context/            AuthContext, única fuente del estado de sesión
  pages/              Una página por ruta
  components/         Componentes por dominio, cada uno con su .module.css
    admin/ auth/ chat/ firma/ home/ layout/ profile/ proyectos/ shared/
  lib/                Cliente de Supabase, validaciones, firma, PDF, cobros, IA
  utils/              Compresión de imágenes, video, extracción de texto
  styles/             Estilos globales y variables de diseño
scripts/              Utilidades de mantenimiento y datos de prueba
test/                 Pruebas unitarias
docs/                 Informes y especificaciones
```

### Rutas

| Ruta | Página | Acceso |
|------|--------|--------|
| `/` | Inicio | Público |
| `/proyectos-ley` | Debate de proyectos de ley | Público |
| `/opinar` | Reseña después de una consulta | Público, con enlace del correo |
| `/nueva-contrasena` | Recuperación de contraseña | Público |
| `/perfil` | Panel del abogado | `abogado` |
| `/perfil-contador` | Panel del contador | `contador` |
| `/perfil-firma` | Panel de la firma | `firma` |
| `/perfil-gestor` | Panel del gestor | `gestor` |
| `/admin` | Panel de administración | `admin`, `superadmin` |
| `/terminos`, `/privacidad`, `/tratamiento-datos`, `/cookies`, `/eula`, `/devoluciones`, `/autorizacion-datos`, `/contrato-profesional`, `/contrato-gestor`, `/terminos-ia` | Documentos legales | Público |

Todas las páginas salvo el inicio se cargan bajo demanda. Cada página privada valida la sesión y el rol por su cuenta.

### Funciones serverless

El plan de Vercel en uso admite 12 funciones, y el proyecto las ocupa todas. Por eso varias atienden más de una acción y la distinguen con un campo del cuerpo (`type`, `accion` o `modo`). Antes de crear un archivo nuevo en `api/`, revisa si la acción cabe en una función existente.

| Función | Qué hace |
|---------|----------|
| `api/ai.js` | Único proxy hacia Claude: triage del cliente, asistente del profesional, revisión de adjuntos e importador de proyectos de ley |
| `api/notify.js` | Correos transaccionales y acciones de cuenta, por `type`. También la firma de integridad y el webhook de Wompi, y la factura de Alegra |
| `api/solicitudes.js` | Solicitudes abiertas (publicar, listar, tomar), token del chat del cliente, cierre de firma y documentos del profesional |
| `api/professionals.js` | Listado público de profesionales y firmas aprobados, en caché de CDN |
| `api/carousel.js` | Videos activos del inicio, en caché de CDN |
| `api/send-verification-code.js` | Emite el código de 6 dígitos al correo, con límite de intentos |
| `api/verify-code.js` | Valida el código en una sola operación atómica |
| `api/forgot-password.js` | Recuperación de contraseña. Responde igual exista o no la cuenta |
| `api/verify-request.js` | Solicitud de verificación de un caso a la administración |
| `api/reassign.js` | Reasignación de una consulta inactiva a otro profesional |
| `api/cron/gen-inactividad.js` | Detecta consultas sin actividad y despacha la cola de correos de reseña |
| `api/whatsapp-webhook.js` | Webhook de WhatsApp Cloud API |

## Base de datos

Supabase aporta Postgres, autenticación, almacenamiento y Realtime. La seguridad descansa en las políticas RLS y en funciones `SECURITY DEFINER`. Las funciones serverless validan el rol de quien llama antes de escribir con la clave de servicio.

**El esquema no está versionado en este repositorio.** Las tablas, políticas y funciones se aplican a mano en el editor SQL de Supabase, y los guiones viven en `docs/sql/`, carpeta ignorada por git. Clonar el repositorio no basta para levantar una base desde cero: hay que pedir esos guiones a quien mantiene el proyecto.

Buckets de almacenamiento: `profile-photos`, `profile-videos`, `tarjetas-profesionales`, `contratos`, `contract-templates`, `chat-files`, `documentos-firma`, `comprobantes`, `noticias` y `carousel-images`.

## Despliegue

Vercel publica la rama `main`. La configuración está en [vercel.json](vercel.json): reescritura de SPA, redirección de los dominios `*.vercel.app` al dominio final, cabeceras de seguridad y de caché, la tarea diaria y el tiempo máximo de `api/ai.js`.

Un cambio que toque la base de datos tiene dos partes que se despliegan por separado: el código, al subir a `main`, y el SQL, aplicado a mano en Supabase. Si solo se sube el código, la parte que depende del SQL no funciona hasta que este se aplique.

## Convenciones

- Importa siempre el cliente de [src/lib/supabase.js](src/lib/supabase.js), nunca `@supabase/supabase-js`. Para un `fetch` autenticado usa `getAuthHeaders()`, que renueva el token.
- Los componentes se ubican por dominio y llevan su `.module.css` al lado.
- Una página nueva, si es privada o pesada, se carga con `React.lazy` en [src/App.jsx](src/App.jsx).
- Quién cuenta como profesional se decide en un solo sitio: `esProfesional()` en [api/_lib/adminAuth.js](api/_lib/adminAuth.js), que incluye a la firma. Para el panel, `esPanel()` en el servidor e `isPanelAdmin` en la interfaz.
- Toda vista previa de un archivo usa los visores compartidos de [src/lib/chatFiles.jsx](src/lib/chatFiles.jsx), que ya traen zoom.
- Las claves privadas solo se leen dentro de `api/`.

## Documentación

- [docs/firma-electronica-REPORTE.md](docs/firma-electronica-REPORTE.md): diseño de la firma electrónica.
- [docs/optimizacion-imagenes.md](docs/optimizacion-imagenes.md): tratamiento de imágenes y video.
- [docs/perf/INFORME-RENDIMIENTO-ESCALABILIDAD-2026-07-06.md](docs/perf/INFORME-RENDIMIENTO-ESCALABILIDAD-2026-07-06.md): rendimiento y escalabilidad.

## Licencia

Este repositorio no incluye una licencia de código abierto. El código y los documentos de `public/legal/` no pueden reutilizarse sin autorización de sus titulares.
