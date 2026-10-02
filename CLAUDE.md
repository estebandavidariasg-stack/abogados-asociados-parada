# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev            # Vite dev server at localhost:5173
npm run build          # Production build
npm run preview        # Preview production build locally
npm run optimize:hero  # Regenerate /public/hero-N-{480,800,1200}.{avif,webp,jpg}
                       # from PNG sources in /assets-source/hero/ (uses sharp)
```

No test runner, linter, or typechecker is configured.

## Environment Variables

```
VITE_SUPABASE_URL            # Supabase project URL
VITE_SUPABASE_ANON_KEY       # Supabase anon/public JWT
VITE_RECAPTCHA_SITE_KEY      # Google reCAPTCHA v3 site key
VITE_APP_URL                 # Public app URL (used in email templates)
GMAIL_USER                   # Nodemailer sender address (server-side only)
GMAIL_PASS                   # Gmail app password (server-side only)
SUPABASE_SERVICE_ROLE_KEY    # Service-role JWT — required by api/forgot-password.js (admin/generate_link)
                             # AND by api/send-verification-code.js / api/verify-code.js
                             # (admin user lookup + writes to verification_codes table)
                             # AND by the notification endpoints (verify-request, reassign, cron)
CRON_SECRET                  # Protects api/cron/gen-inactividad (Vercel sends it as Bearer token)
ADMIN_NOTIFY_EMAIL           # Recipient of verification emails (default: abogadosyasociados.parada@gmail.com)
ANTHROPIC_API_KEY            # Anthropic key — used ONLY by api/ai.js (server-side); never exposed to the browser
AI_CLIENTE_MAX_MSGS          # Message cap per client triage session (default 6)
AI_MAX_SESIONES_IP_HORA      # Max triage sessions per IP per hour (default 10)
AI_IP_SALT                   # Salt used to hash client IPs stored in ai_sesiones
AI_MAX_USOS_SALA_DIA         # Professional-assistant analyses per chat room per day (default 2)
                             # — caps cost of the "summarize/analyze a room" action in api/ai.js
```

## Architecture

**Stack:** React 18 + Vite, React Router DOM 6, Supabase (custom client), Vercel (hosting + serverless functions). Vercel SPA fallback is in [vercel.json](vercel.json).

### Routing

Routes are declared in [src/App.jsx](src/App.jsx):

| Path | Component | Intended access |
|------|-----------|-----------------|
| `/` | `HomePage` | Public |
| `/perfil` | `ProfilePage` | Authenticated lawyer (`rol = 'abogado'`) |
| `/perfil-contador` | `ProfileContadorPage` | Authenticated accountant (`rol = 'contador'`) |
| `/admin` | `AdminPage` | `superadmin` only |
| `/nueva-contrasena` | `ResetPasswordPage` | Public — landing for the recovery email link |
| `/terminos`, `/privacidad`, `/tratamiento-datos`, `/cookies`, `/eula`, `/devoluciones`, `/autorizacion-datos`, `/contrato-profesional`, `/contrato-gestor`, `/terminos-ia` | `LegalPage` | Public — full-page view of one official legal PDF (see **Legal documents** below) |

`BrowserRouter` and `AuthProvider` are mounted in [src/main.jsx](src/main.jsx).

**Legal documents:** the official PDFs live in `public/legal/` (short names; the long-named originals in `docs/*.pdf` are gitignored). The single catalogue is `DOCS_LEGALES` in [src/components/shared/DocumentosLegales.jsx](src/components/shared/DocumentosLegales.jsx), which also exports `VisorLegal` (modal viewer, rasterised via `PdfVisor` so it renders on Android where `<iframe>` PDFs go blank; sits at `--z-visor` above any modal) and `EnlaceLegal` (inline "términos de uso" link-button that opens the viewer in place — used by `RegisterModal`, `AuthModal`, `ChatSection`, `AsistenteIA`). `DOCS_FOOTER` lists the six general documents shown in the footer (Title Case): Términos de Uso, EULA, Política de Privacidad, Política de Tratamiento de Datos, Política de Cookies, Política de Devoluciones — the same set the contracts cite (Autorización de datos stays reachable at `/autorizacion-datos` but is out of the footer). `contratoDeRol(rol)` returns the contract each role accepts at registration (`profesional` for abogado/contador, `corretaje` for gestor) — shown in the "condiciones" step as a tappable file row that opens the viewer, and named in the final terms checkbox. The `ia` entry (`/terminos-ia`, `public/legal/terminos-ia-profesionales.pdf`) is the *Términos de Uso de la Herramienta de Inteligencia Artificial*: it is linked from the first-use notice of [AsistenteIA.jsx](src/components/chat/AsistenteIA.jsx), whose acceptance is stored per user as `ia_terms_<uid> = VERSION_TERMINOS_IA` (the PDF's version) — bump that constant when the PDF changes and everyone is asked again. To replace a document, overwrite the PDF in `public/legal/` (keep the file name); to add one, add a catalogue entry + a route in `App.jsx`.

**Code-splitting:** every route EXCEPT `/` (HomePage) is `React.lazy`-loaded behind a `<Suspense>` in `App.jsx` — public visitors don't download the Profile/Admin/Reset bundles up front. `MapSection` (d3 + topojson) is likewise lazy-loaded inside `HomePage`. If you add a new heavy/private page, lazy-load it the same way.

⚠️ **`<ProtectedRoute>` exists ([src/components/auth/ProtectedRoute.jsx](src/components/auth/ProtectedRoute.jsx)) but is currently NOT wired into `App.jsx`.** Each protected page enforces auth itself with a `useEffect` that calls `navigate('/')` when `!user` (or when `requireAdmin` and the role doesn't match). If you add new private pages, follow the same pattern OR wire them through `<ProtectedRoute>` in `App.jsx`.

### Components Folder Structure

Components live in [src/components/](src/components/) organized **by domain, not by file type** — each component's `.jsx` and `.module.css` sit together inside the same folder:

| Folder | Components |
|--------|------------|
| `admin/` | `CodigosReferencia` (QR code management), `ProfileDetailModal` (review pending lawyer/contador profiles) |
| `auth/` | `AuthModal`, `RegisterContadorModal`, `PasswordField`, `VerificationStep` (6-digit OTP), `ProtectedRoute` |
| `chat/` | `ChatSection`, `LawyerChatDashboard`, `ContadorChatDashboard`, `SuperAdminChatViewer`, `LawyerInternalChat`, `AdminInternalChat`, `AudioPlayer` |
| `home/` | `Hero`, `VideoCarousel`, `LawyersSection`, `LawyerCard`, `MapSection`, `ModelosContractualesSection`, `CTASection`, `WhatsAppButton` |
| `layout/` | `Navbar`, `Footer` |
| `profile/` | `MisContratos`, `SocialLinks`, `UbicacionSelector` |
| `shared/` | `Icons`, `Markdown`, `DocumentosLegales` (legal PDF catalogue + `VisorLegal` + `EnlaceLegal`) |

When you add a new component, place it in the folder that matches its primary domain. Cross-folder imports are fine — e.g. `chat/ChatSection.jsx` imports `profile/UbicacionSelector` and `shared/Icons`.

### Auth & Roles

[src/context/AuthContext.jsx](src/context/AuthContext.jsx) is the single source of truth for auth state. It exposes:
- `user` — Supabase auth user object
- `profile` — row from the `profiles` table
- `isSuperAdmin`, `isApproved` — derived booleans
- `signIn({email,password})`, `signUp({...})`, `signOut()`
- A 50-minute interval refreshes the token by calling `supabase.auth.getSession()`

`profiles.rol` takes one of three values: `'abogado'`, `'contador'`, or `'superadmin'`. The `aprobado` boolean controls whether a professional shows up on the homepage and can use their profile page.

**Registration is gated by an email-OTP step.** Both [AuthModal.jsx](src/components/auth/AuthModal.jsx) and [RegisterContadorModal.jsx](src/components/auth/RegisterContadorModal.jsx) run a 3-state flow `'form' → 'verify' → 'done'`: they POST to `/api/send-verification-code`, mount [VerificationStep.jsx](src/components/auth/VerificationStep.jsx) (6-input OTP, 60s resend countdown, paste support), call `/api/verify-code`, and only then proceed to `supabase.auth.signUp`. Email is verified BEFORE the auth user is created.

### Custom Supabase Client

**Always use [src/lib/supabase.js](src/lib/supabase.js) — do not import from `@supabase/supabase-js`.** (The package is in `node_modules` but only used transitively / for typing; the runtime client is hand-rolled.)

This is a hand-rolled REST + WebSocket client that wraps the Supabase REST API directly. It provides:
- A chainable query builder: `supabase.from('table').select('*').eq('col', val).single()`
- Mutations: `.insert()`, `.update()`, `.delete()`
- Realtime subscriptions over the **Phoenix WebSocket protocol** (not Supabase's JS SDK channels) — only `postgres_changes` events are handled; broadcast events are not implemented in `RealtimeChannel`
- Storage API for file uploads to `profile-photos`, `profile-videos`, `contratos`, and `tarjetas-profesionales` buckets
- Auth methods: `signInWithPassword`, `signUp`, `signOut`, `getSession`
- `getAuthHeaders()` (named export) — auto-refreshes the token (5-min skew) before returning headers; use this for any raw `fetch` calls that require auth. Tokens persist in `localStorage` under `sb_token`, `sb_refresh_token`, `sb_token_exp`.

### Media Optimization

Two distinct paths, both client-side:

**Hero images (build-time):** [scripts/optimize-hero.js](scripts/optimize-hero.js) reads PNG sources from `assets-source/hero/` and emits 9 variants per image into `public/` (3 widths × 3 formats: AVIF / WebP / JPG). [Hero.jsx](src/components/home/Hero.jsx) renders them with `<picture>` + `srcset`/`sizes` so the browser picks the most efficient format/size combo it can render. Originals are NOT shipped — they live outside `public/` to keep the deploy slim.

**Admin uploads (runtime):**
- Images: [compressImage()](src/utils/compressMedia.js) downscales to 1200 px max and re-encodes via canvas. Picks AVIF if the canvas can encode it, else WebP, else JPEG. Returns the original if re-encoding would make it bigger.
- Video poster: [extractPosterFromVideo()](src/utils/extractPoster.js) seeks to t=0.5s and rasterizes the frame to WebP — used as `<video poster=...>`. The poster appears instantly without touching the MP4.
- Video transcoding: [transcodeVideo()](src/utils/transcodeVideo.js) runs `ffmpeg.wasm` (lazy-loaded from unpkg CDN — ~30 MB core, only fetched when the admin uploads) to convert anything to MP4/H.264 720p with `+faststart`. Falls back to the original on failure or when the file is already <8 MB. Reports `(stage, progress)` so the UI can show "Cargando optimizador" / "Optimizando video" / "Subiendo".

### Shared Validations

[src/lib/validaciones.js](src/lib/validaciones.js) holds reusable validators used by `AuthModal`, profile pages, and `ChatSection`:
- `PASSWORD_RULES`, `getPasswordStrength`, `isPasswordValid`
- `validarCelular`, `normalizarCelular` (Colombian mobile, must start with `3`, 10 digits, optional `+57` prefix stripped)
- `validarCorreo`

### Serverless Functions

Vercel serverless functions live under [api/](api/). The email functions share the same navy + gold AAP-branded HTML email card; the two read endpoints (`professionals`, `carousel`) are cached at the Vercel CDN; the notification endpoints (`verify-request`, `reassign`, `cron/gen-inactividad`) write with the service-role key and validate the caller's role server-side (shared helpers in [api/_lib/](api/_lib/) — `_`-prefixed files are not published as routes).

| File | Purpose |
|------|---------|
| [api/notify.js](api/notify.js) | Transactional emails via Nodemailer (Gmail SMTP). Dispatches by `type`: `new_consultation` (notify lawyer — requires `lawyerId`, email resolved server-side), `chat_inactivity` (admin-triggered reminder), and `gestor_trazabilidad` (gestor referral-lifecycle emails, 4 events: `inicio` = someone used the QR (anonymous, dedup via `chat_rooms.traza_gestor`), `en_curso` = professional took the case (requires assigned professional), `cierre` = admin defined the cobro → commission available, `pago` = admin paid with comprobante (both require superadmin); template in [api/_lib/emailTrazabilidad.js](api/_lib/emailTrazabilidad.js), all data resolved server-side from the room/cobro). The legacy `lawyer_joined` branch and `lawyerEmail` fallback were REMOVED 2026-07 (unauthenticated mail-relay risk). User-provided names/areas are HTML-escaped with `esc()`. CTA link points to `https://abogadosyasociadosparada.com`. |
| [api/forgot-password.js](api/forgot-password.js) | Custom password-reset flow. Uses `auth/v1/admin/generate_link` (requires `SUPABASE_SERVICE_ROLE_KEY`) to mint the recovery link, then sends a branded email. Always responds 200 to avoid user enumeration. The link points to `/nueva-contrasena`. |
| [api/send-contact-card.js](api/send-contact-card.js) | Sends a lawyer's contact card to a client by email. |
| [api/send-verification-code.js](api/send-verification-code.js) | Issues a 6-digit OTP for new lawyer/contador registration. Rate-limited 3/10min per email, 10-min TTL. Previous unused codes are marked `used=true` (NOT deleted) so the rolling rate-limit count remains accurate. Requires `SUPABASE_SERVICE_ROLE_KEY` (admin user lookup + writes to `verification_codes`). |
| [api/verify-code.js](api/verify-code.js) | Validates `(email, code)`. A single PostgREST PATCH with `used=false` + `expires_at>now()` filters → atomic update, no TOCTOU window. Returns generic "Código inválido o expirado" on any failure (no enumeration). On success returns `tipoRegistro` so the caller can route to the correct signup path. Requires `SUPABASE_SERVICE_ROLE_KEY`. |
| [api/professionals.js](api/professionals.js) | **Cached** public list of approved professionals (`GET ?rol=abogado\|contador`). Reads `profiles` with the anon key, returns ONLY public columns (whitelist enforced server-side — must mirror `LawyersSection`'s `PUBLIC_COLS`). Sets `Cache-Control: public, s-maxage=300, stale-while-revalidate=600` so the Vercel CDN absorbs repeated home loads instead of hitting Postgres per-visitor. Consumed by [LawyersSection.jsx](src/components/home/LawyersSection.jsx) (filters by area/ciudad happen client-side). Also aggregates, with the service-role key, each professional's rating (`rating_promedio`/`rating_total`) and `consultas_exitosas` = rooms with `chat_rooms.resultado='exito'` that the professional attended (`chat_room_lawyers.status='active'`); two flat paginated reads crossed in memory, no PostgREST embed (no FK assumed). `LawyerCard` shows the count on the card and in the modal header, only when > 0: a large Cinzel numeral in ink brown, a gold hairline and a two-line small-caps label (no pill, no green — the owner rejected the green badge as generic). |
| [api/carousel.js](api/carousel.js) | **Cached** active carousel videos (`GET`). Same `Cache-Control` strategy. Consumed by [VideoCarousel.jsx](src/components/home/VideoCarousel.jsx) on public load; after a superadmin edit the component re-fetches **directly** from Supabase (`fetchVideos(true)`) to bypass the cache and see the change immediately. |
| [api/verify-request.js](api/verify-request.js) | Lawyer/contador "Verificar" → inserts a `verificacion` row in `notificaciones`, posts to `mensajes_internos`, and emails the admin. Validates (via `_lib/adminAuth`) that the caller is a professional **assigned to that room**. |
| [api/reassign.js](api/reassign.js) | Admin confirms reassigning an inactive room: removes the inactive lawyer, assigns the chosen one (`status='invited'`, room → `waiting`), posts a system message (with the new professional's name), marks the notification `atendida`, and emails BOTH the new professional AND the client (`sendClientReassignEmail` in [api/_lib/mailer.js](api/_lib/mailer.js), best-effort, uses `chat_rooms.client_email`). Validates **superadmin** + that the chosen lawyer is approved. |
| [api/cron/gen-inactividad.js](api/cron/gen-inactividad.js) | Scans `waiting`/`active` rooms with no message in 24h and inserts `inactividad` notifications (dedup by room). Protected by `CRON_SECRET`. Also drains the review-email queue on every call. Two triggers: **Vercel Cron** once a day (`0 13 * * *` in [vercel.json](vercel.json) — Hobby only allows daily) and **pg_cron job 2** every 5 min via `net.http_post` (the review queue needs that cadence; see [docs/sql/cron-inactividad-2026-09-28.sql](docs/sql/cron-inactividad-2026-09-28.sql)). ⚠️ The job must call the FINAL domain (`https://paradabridge.com`): on a redirect libcurl drops the `Authorization` header when the host changes, so the old `www.abogadosparada.com` URL got 401 on every call and silently did nothing. |
| [api/ai.js](api/ai.js) | **Single Claude proxy** for both AI assistants — dispatches by `modo` (`cliente` triage / `abogado` professional assistant). Holds `ANTHROPIC_API_KEY`. See **AI System** above for the full design (sessions, rate limits, JSON contract, attachments, per-room cost cap). |
| [api/solicitudes.js](api/solicitudes.js) | **Open-request / claim model** (one function, 3 actions): `GET` lists open requests for the caller's `tipo_profesional`; `POST {accion:'publicar'}` (client publishes a consultation with no area match); `POST {accion:'tomar', roomId}` (professional claims it — atomic, first wins). Validates approved-professional on writes. |

**Gestor money model (since 2026-08-29, [docs/sql/gestor-flujo-2026-08-29.sql](docs/sql/gestor-flujo-2026-08-29.sql)):** the company keeps `pct_empresa` (default **20%**) of the consultation total; the gestor's commission is `pct_gestor` (default **5%**) **of the company's cut** (NOT of the total) and comes out of the company's share — the professional pays only `monto_empresa`. A case counts as **exitoso** the moment the admin defines the cobro (`generar_cobro` sets `chat_rooms.resultado='exito'` AND creates the `gestor_cobros` coupon), which keeps the gestor's Estadísticas and Mis Cobros counters aligned. Paying a gestor commission requires attaching a comprobante (PNG/JPG/PDF) uploaded to the private `comprobantes` bucket (`<gestor_id>/<cobro_id>.<ext>`; gestor can read only their own folder); the path lands in `gestor_cobros.comprobante_path` via `pagar_comision_gestor(p_cobro_id, p_comprobante_path)`.

**The admin confirms the price before the professional is charged (2026-10-01, [docs/sql/cobros-2026-10-01.sql](docs/sql/cobros-2026-10-01.sql) — `docs/sql/` is gitignored, the file is local):** `confirmar_pago_asesoria` (professional confirms the client paid) no longer creates the platform charge; it leaves the `pagos_asesoria` row `pagado` and notifies the admin. The charge (`pagos_profesional`) is born when the ADMIN confirms or corrects that value with `generar_cobro` — from Pagos y cobros → Asesorías ("Por confirmar" chip + "Confirmar precio" modal in [PagosCobrosAdmin.jsx](src/components/admin/PagosCobrosAdmin.jsx)) or from the chat's "Definir cobro" modal, now pre-filled with the reported price. Until that SQL is applied the old behaviour remains (charge auto-created) and the UI simply shows nothing to confirm. **Same SQL fixes the duplicated gestor commission:** `fichas-contacto-2026-09-17.sql` had rewritten `pagar_pago` / `confirmar_pago_wompi` / `confirmar_pago_profesional` from a pre-v2 version that inserted the `gestor_cobros` row on PAYMENT without checking it already existed (v2 creates it when the cobro is defined) → two commissions per consultation. The SQL deletes the repeated rows, adds a unique index per `room_id` and restores the `not exists` guard; `unaComisionPorConsulta()` in [cobroAsesoria.js](src/lib/cobroAsesoria.js) is the screen-side safety net (admin + gestor lists) while it is not applied. These RPCs still check `rol = 'superadmin'` only (not the newer `admin` role).

Call from the frontend with `fetch('/api/<endpoint>', { method: 'POST', body: JSON.stringify(...) })`.

### Chat Systems

There are **two independent chat systems** that should not be confused:

**1. Client consultation chats (Realtime via Phoenix WS)** — backed by `chat_rooms` / `chat_messages` / `chat_room_lawyers` / `chat_ratings` / `pqr` tables. Components by user role:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/chat/ChatSection.jsx](src/components/chat/ChatSection.jsx) | Client | Multi-step flow: tipo (abogado/contador) → cédula → personal form → professional selection → live chat → star rating → optional PQR (petición/queja/reclamo) |
| [src/components/chat/LawyerChatDashboard.jsx](src/components/chat/LawyerChatDashboard.jsx) | Lawyer | Sidebar sorted by latest activity (no status grouping) + WhatsApp-style unread badge + inline chat |
| [src/components/chat/ContadorChatDashboard.jsx](src/components/chat/ContadorChatDashboard.jsx) | Contador | Clone of the lawyer dashboard, filtered with `tipo_profesional=eq.contador` so contadores never see lawyer rooms |
| [src/components/chat/SuperAdminChatViewer.jsx](src/components/chat/SuperAdminChatViewer.jsx) | Superadmin | All rooms with search, moderation, force-close |

`chat_rooms.tipo_profesional` (`'abogado' | 'contador'`) partitions rooms between the two professional dashboards. `chat_room_lawyers.lawyer_id` is reused for both — for contador rooms it stores the contador's profile id.

These use **Supabase Realtime** (`postgres_changes` over Phoenix WS) for live message updates. Rooms support text, file attachments, and audio messages ([src/components/chat/AudioPlayer.jsx](src/components/chat/AudioPlayer.jsx)).

**Message delivery speed (2026-09-30):** text messages are sent **optimistically** — the id is generated in the browser (`nuevoIdMensaje`) and sent in the insert, so the bubble shows instantly with ✓ and the server row / Realtime event / poll is the SAME row; `fusionarMensajes` merges server rows into the list (updates `leido_en`, drops `_enviando`, adds new rows with `_nuevo` → `.aapMsgIn` entry animation) and returns the same reference when nothing changed. Client poll is adaptive (1.2 s during a live conversation, 3 s quiet, 5 s after 2 min idle, paused when hidden) and fetches room status + messages in parallel. Dashboards keep Realtime but add a 5 s merge poll of the last 40 messages as a safety net when the WS drops. Both dashboards have a status filter (`FiltroEstadoSalas`: Todas / Activas / En espera / Cerradas, remembered per browser in `chat_filtro_estado_<uid>`).

**Read receipts + presence (client chat + lawyer/contador dashboards):** `chat_messages.leido_en` marks when the OTHER party read a message (✓ sending / ✓✓ grey delivered / ✓✓ gold read — `Visto` in [chatFiles.jsx](src/lib/chatFiles.jsx)); `chat_presencia(room_id, actor, visto_en)` holds a per-room heartbeat (`usePresencia` → "Conectado" if the counterpart beat < 75 s ago, else "Ausente · hace X min"; `Presencia` renders it in the chat header). Both go through SECURITY DEFINER RPCs `chat_marcar_leidos` / `chat_latido` (professional = `auth.uid()` assigned in `chat_room_lawyers`; client = `p_client_token` hash, like `mis_mensajes`). Marking and beating only happen with the tab visible; the client's 3 s poll now also merges `leido_en` into existing messages, and the dashboards subscribe to `chat_messages` UPDATE events. If the SQL ([docs/sql/visto-presencia-2026-09-29.sql](docs/sql/visto-presencia-2026-09-29.sql)) is not applied the RPCs 404 and everything degrades silently (no ticks, old status labels).

**Service contract before advising (2026-09-30):** both dashboards have a "Contrato de servicios" button in the chat action strip that opens [EnviarAFirmar.jsx](src/components/firma/EnviarAFirmar.jsx) on its `tipoDoc='contrato'` path. The professional downloads the official Word template (`public/legal/modelos/contrato-servicios-{abogacia,contables}.docx`, chosen by `tipoProfesional`), fills the UPPERCASE parenthesised blanks — `(NOMBRE DEL CLIENTE)` — exports to PDF and uploads it. [src/lib/contratoServicios.js](src/lib/contratoServicios.js) then compares it against the template **read at runtime** (no copy of the text in code): the template is split into fixed stretches and blanks; every fixed stretch must appear in order (whitespace/case-insensitive, accents and punctuation count), no required blank may be left unfilled, and a blank may not contain a new "cláusula" or more than ~250 words. The verdict names the clause, what it must say and what the file says. Only a **verified PDF** enables sending; a Word upload is checked too but must be re-uploaded as PDF (the letterhead is Word shapes that the in-browser docx→PDF conversion cannot draw). The `firma` chat message carries `doc: 'contrato_servicios'` + `titulo`, so the client sees "Contrato de prestación de servicios… para firmar" and the strip button turns into "Contrato enviado" / "Contrato firmado". The "Otro documento" path (any PDF, no check) is unchanged. Validation is client-side only.

**Signature state comes from the DB, not from a chat message (2026-10-01):** `useFirmasEstado(mensajes, { anonimo })` in [chatFiles.jsx](src/lib/chatFiles.jsx) reads `firmas_solicitudes.estado` for the thread's `firma` messages (one fetch on open, then every 8 s only while a request sent in the last 3 days is still pending). The dashboards render a signed `firma` bubble as "… firmado por el cliente" with "Ubicar firma y descargar PDF" + certificate; the client sees the signing card (`.firmaCard` in ChatSection) turn into "Documento firmado". Reason: the client's direct INSERT into `chat_messages` is rejected by the hand-applied "Enviar mensajes" policy, so the old `firma_ok` notice was silently lost (fetch does not throw on 4xx) — signed in the DB, nothing in the professional's chat. `FirmaClienteChat` still tries the `firma_ok` insert, checks the result, and falls back to a plain text message through the `enviar_mensaje_cliente` RPC. When the professional pre-signs ("firmar yo"), a copy with only their signature is stored at `<solicitud>/profesional.pdf` and used as the base for "ubicar firma" (the client overwrites `<solicitud>/firmado.pdf`). ⚠️ The professional can read `chat_rooms.client_cedula` / `client_token` (the hash the client RPCs accept as credential) — open security item.

**Where the signature lands in the PDF (2026-10-01):** `estamparFirma` in [firmaPdf.js](src/lib/firmaPdf.js) no longer stamps a fixed block on the last page (in the firm's templates the last page is the dark back cover, and both signers used the same spot → black-on-brown, one on top of the other). With no explicit `posicion` it calls `analizarParaFirma` in [firmaCampos.js](src/lib/firmaCampos.js), which reads the PDF text WITH positions (pdf.js) and looks for the signing party's own block: an uppercase label matched by role (`EL ABOGADO` / `EL CONTADOR` / `EL CLIENTE`, also CONTRATISTA/CONTRATANTE, APODERADO/PODERDANTE…) followed by `Nombre:` / `C.C.:` / `Cel.:` / `Correo:` / `Fecha:` lines, a `Firma: ____` line or a signature rule. The drawing (trimmed to its ink) goes next to/under the label or on the rule; a `(NOMBRE COMPLETO)`-style placeholder is covered with the sampled paper colour and the value is written in the document's ink/size/font family; over `____` it is written without covering; a value the professional already typed is left alone. Search runs from the last page backwards and stops at the first page with running text, so a parties header at the top of a contract is never mistaken for the signature block. No block found → classic block (signature + 7-line footer) right below the text of the last page with real content, or on a new page inserted before the back cover; each signer takes a slot (left, right, next row) recorded in the PDF keywords (`pbfirma:<page>:<yTop>:<n>`) so the next one lands beside it. An explicit `posicion` (scripts/test-firma.mjs) or `soloFirma` (UbicarFirma) keeps the old exact-position behaviour. The dashboards' signed bubble now offers **Documento firmado (PDF)** (downloads `<solicitud>/firmado.pdf` as signed), **Ubicar firma a mano** (the old drag tool, for documents without a block or signed before this) and the certificate. The phone/e-mail/city of the footer stay in the certificate.

**Sidebar unread badge (lawyer/contador dashboards):** counts client messages since the professional's last response OR last opening of that room (whichever is more recent). "Last opened" is persisted in `localStorage` under `chat_seen_${userId}` so the badge stays at 0 across switches between rooms (WhatsApp-style — opening a chat marks it seen even without replying). No `seen_at` column exists in the BD; state is per-browser, not synced cross-device.

Client cédulas are stored as **SHA-256 hashes** for anonymity. Outgoing messages are scanned for phone/email (incl. obfuscated `juan arroba gmail punto com`) by `contieneContacto` in [src/lib/validaciones.js](src/lib/validaciones.js); a match **blocks** the send and shows a modal (client, lawyer AND contador dashboards). No notification is sent. The 10-digit threshold for bare digit runs is deliberate — it catches phones/accounts/cédulas while letting monetary amounts (`1.500.000`) through. Note this is text-only: contact data inside audio/images/PDFs is not detected.

**Voice notes (2026-10-01):** the note is transcribed in the browser while recording (`crearTranscriptor`, Web Speech API) and the text goes through `contieneContactoHablado` ([validaciones.js](src/lib/validaciones.js)): `contieneContacto` on the transcript AND on a copy with spoken numbers turned into digits (`numerosHablados`: "tres uno cero…", "cincuenta y seis", "doble cero"). The transcript is rebuilt from ALL result segments on every event (keeping only the last interim segment used to drop half a phone number). On a COMPUTER with a recognition engine an empty transcript blocks the send (`transcriptor.exigeTexto` → `AVISO_AUDIO_SIN_REVISAR`); on phones (exclusive microphone) and Firefox (no engine) the note is still sent and flagged "sin revisar". Not testable without a real microphone: the logic was verified with a mocked `SpeechRecognition`.

**Lists that follow activity:** the admin's internal chat sidebar ([AdminInternalChat.jsx](src/components/chat/AdminInternalChat.jsx)) sorts professionals by their latest message in either direction (`ultimos`, refreshed with the 6 s unread poll); the lawyer/contador consultation sidebars re-sort every 10 s. `SuperAdminChatViewer` (history) is still ordered by creation date. PQRS cards ([PqrsAdmin.jsx](src/components/admin/PqrsAdmin.jsx)) show the professional of the consultation, resolved from `pqr.room_id` → `chat_room_lawyers` → `profiles` (no new column). The public contract-templates list shows 6 and grows with "Ver más" / collapses with "Ver menos" (`MODELOS_INICIO`).

**Chat media URLs ([src/lib/chatFiles.jsx](src/lib/chatFiles.jsx)):** `chat_messages.file_url` stores a **signed URL that expires after 7 days** — stale links 400 even though the file lives on in the `chat-files` bucket. The shared `resolveSignedUrl(srcOrPath)` re-signs a **fresh** URL on demand from either a stored path or an old (expired) signed URL. This module also exports `openChatFile` (popup-safe new-tab open) and the shared `ChatImage` (inline thumbnail) / `ChatLightbox` (fullscreen, portaled to `<body>`) components used by every chat surface.

**Zoom on every file (2026-10-01):** it lives ONLY in the two shared viewers of [chatFiles.jsx](src/lib/chatFiles.jsx), so no screen has to remember it: `PdfVisor` (50–300 %) and `ImagenZoom` (100–500 %; used by `ChatLightbox`, `VisorArchivo`, `TarjetaPreview` and the client's read-only viewer). Both use `useZoom` + `ZoomControles` (− / % / + pill; the % resets): Ctrl+wheel on PDFs and plain wheel on images, two-finger pinch (touch events + `preventDefault`, not `touch-action`), double click, mouse drag to pan, and the point under the cursor stays put. `PdfVisor` re-rasterises once at 2× the first time zoom reaches 150 % (≤ 25 pages, cap 2400 px) so text stays sharp. The pill is `position: sticky` at zero height, so it sits at the bottom of the visible document whether the scroller is the viewer, a modal body or the page. A new viewer should render one of these two instead of a bare `<img>`/`<iframe>`. The Office Online `<iframe>` of the contract templates brings its own zoom.

**Fast document preview (2026-10-01):** the wait between click and first page was mostly preparation (download pdf.js ≈530 KB + boot its 1.3 MB worker, then the file). Now [pdfARaster.js](src/lib/pdfARaster.js) keeps ONE shared `PDFWorker` for the session (every `getDocument` goes through `abrir`), and chatFiles exports `precalentarPdf()` (loads pdf.js + boots the worker in idle time) and `precargarArchivo(url, esImagen)` (downloads the file into a small per-URL cache that `PdfVisor` reuses; ≤ 6 entries, nothing over 8 MB kept). [TarjetaPreview.jsx](src/components/profile/TarjetaPreview.jsx) warms up when a PDF row is rendered, pre-signs + prefetches on pointerenter/focus/touchstart, and prefetches right away in `variant="row"` (the two documents of a professional's profile). Nothing is prefetched with `navigator.connection.saveData`. A new list of documents should call `precalentarPdf()` when it renders.

**Bill debate — voting article by article in several visits (2026-10-01):** the DB always kept one vote per person and SCOPE (whole bill, or each article); it was the page that closed the whole card after any vote. [ProyectosLeyPage.jsx](src/pages/ProyectosLeyPage.jsx) now records WHAT was voted in `localStorage.pl_votos` (`{hash: {proyectoId: {completo, arts: {articuloId: postura|true}}}}`; the old `pl_voted` array is read as `legado`). After voting some articles the tab becomes "Seguir votando (n)": voted articles are locked showing "Tu voto: …", the rest stay open; a whole-bill vote still closes the card. If the batch RPC answers `duplicado` (voted from another device) the rows are re-sent one by one so only the repeated article is skipped. Long lists show 5 articles + "Ver más artículos / Ver menos" (`ARTS_INICIO`/`ARTS_TANDA`) and each article body is clamped to 4 lines with its own "Ver más / Ver menos" (same pattern as `Descripcion` in LawyerCard's modal). The results PDF ([proyectosPdf.js](src/lib/proyectosPdf.js)) prints each article's text under its title, sanitised to WinAnsi (`limpio`). Test with `/proyectos-ley?demo=1` (demo bill 1 has 12 articles).

**Consultation fee range:** `COBRO_MINIMO`/`COBRO_MAXIMO` ($50.000–$150.000) in [cobroAsesoria.js](src/lib/cobroAsesoria.js) apply to lawyers AND contadores since 2026-10-01 (`validarMontoCobro` in both dashboards; client notices, registration conditions and the admin's welcome message `ACUERDO_COBRO_BIENVENIDA` read the same constants). [api/notify.js](api/notify.js) mirrors the two numbers for the approval e-mail — change both. Validation is client-side only.

**"Verificar" (lawyer & contador dashboards):** a header button that posts a "🔔 Solicitud de revisión de proceso" message into `mensajes_internos` addressed to the superadmin, so the admin sees it in `AdminInternalChat`. "Already requested" is per-browser session state (`verifiedRooms` Set), not persisted.

**Per-professional download permission:** `profiles.puede_descargar_archivos` (boolean) gates whether a lawyer/contador can download non-image chat files. Toggled per professional in AdminPage → Aprobados; dashboards poll it every 60s so changes apply without reload. Images always open in the lightbox regardless.

**2. Internal staff chat (polling, NOT Realtime)** — backed by `mensajes_internos` table. Professional ↔ superadmin DM:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/chat/LawyerInternalChat.jsx](src/components/chat/LawyerInternalChat.jsx) | Lawyer / Contador | DM thread with the (single) superadmin; resolves admin id by `rol=eq.superadmin`. Reused by `ProfileContadorPage`. |
| [src/components/chat/AdminInternalChat.jsx](src/components/chat/AdminInternalChat.jsx) | Superadmin | Sidebar of approved professionals + DM thread |

Both poll `mensajes_internos` every 3s via `setInterval` and `getAuthHeaders()`-authenticated `fetch`. Messages have `from_id`, `to_id`, `leido` (read flag); unread counts drive badges. Own messages show the same ticks as the consultation chat (`Visto` from chatFiles: ✓ sending / ✓✓ grey delivered / ✓✓ gold when `leido` is true — a boolean, so no read time) and text is sent optimistically with a browser-generated id; `fetchMessages` keeps still-sending local messages when it replaces the list. **Don't reach for Realtime here** — the polling design is intentional and matches the rest of this feature.

### AI System (Claude)

All model calls go through a **single serverless proxy** ([api/ai.js](api/ai.js)) — `ANTHROPIC_API_KEY` is never exposed to the browser. The proxy dispatches by `req.body.modo` into two **completely separate** assistants. The frontend never calls Anthropic directly: it POSTs to `/api/ai` via the thin [src/lib/aiClient.js](src/lib/aiClient.js) `pedirIA(body, {authHeader})`, which never throws (returns `{ok, status, data}` so each caller picks its own fallback). Server-side helpers live in [api/_lib/](api/_lib/): `anthropic.js` (lazy SDK client + `completar()`), `aiPrompts.js` (the two system prompts), `aiLogic.js` (IP hashing, JSON parsing, candidate block). **Model choice is per-mode** in `api/_lib/anthropic.js` `MODELOS`: triage → Haiku, professional assistant → Sonnet. The system prompt is sent with `cache_control: ephemeral` (prompt caching).

**1. Client triage (`modo: 'cliente'`)** — the **public, unauthenticated** admission assistant, embedded in the consultation flow ([ChatSection.jsx](src/components/chat/ChatSection.jsx)). It asks one question at a time, then classifies the case into an area and recommends 1–3 professionals **by id from a server-injected candidate list** (built from the cached `/api/professionals` list — it can only recommend real, approved people). Key mechanics:
- **Strict JSON contract.** `SYSTEM_CLIENTE` forces a single JSON object (`mensaje`, `listo_para_recomendar`, `area_detectada`, `recomendados[]`, `costo_rango`, `resumen_para_profesional`, `sugerir_publicar`). `completar()` is called with `prefill: '{'` to force JSON out of Haiku; `parseTriageReply()` extracts the first `{...}` and falls back to a safe object on any parse failure.
- **Sessions + rate limits** persist in the `ai_sesiones` table (service-role only). Client IPs are SHA-256-hashed (`AI_IP_SALT`). Caps: `AI_CLIENTE_MAX_MSGS` messages/session, `AI_MAX_SESIONES_IP_HORA` new sessions/IP/hour. On the cap the proxy returns `{error:'limite'}` and the UI falls back to manual professional selection.
- **`sugerir_publicar`** drives the **open-request ("publicar") flow**: when no professional matches the detected area, the client publishes the consultation instead of picking someone — see the claim model below.

**2. Professional assistant — "IA Parada Precise" (`modo: 'abogado'`)** — an **authenticated** drafting/analysis tool for lawyers AND contadores ([AsistenteIA.jsx](src/components/chat/AsistenteIA.jsx), mounted in both `ProfilePage` and `ProfileContadorPage`). `getCallerProfile` enforces `rol ∈ {abogado, contador}`. Unlike the triage it returns **free markdown** (rendered via the shared [Markdown.jsx](src/components/shared/Markdown.jsx)), not JSON. Features:
- Drafts petitions/tutelas/contracts/concepts, summarizes/analyzes cases. `SYSTEM_ABOGADO` mandates a "Borrador generado por IA — requiere revisión profesional" banner and `[bracket]` placeholders for missing data.
- **Attachments**: PDF + images (≤4 MB each, 5 max) are sent base64 as Claude content blocks (`bloquesAdjuntos`).
- **Per-room cost cap**: when invoked with `{accion, roomId}` (summarize/analyze a specific consultation), usage is metered in the `ai_uso_salas` table — `AI_MAX_USOS_SALA_DIA` analyses per room per day, then `429 {error:'limite'}`. ⚠️ If that table doesn't exist the cap is silently skipped (won't break the flow).
- **Chat history is per-user `localStorage`** (`ia_chats_${uid}`, capped 50) — there is NO server-side store of professional conversations. Responses can be exported to Word/PDF (client-side, reusing the rendered HTML).

**Open-request / "claim" model ([api/solicitudes.js](api/solicitudes.js))** — a single endpoint (consolidated to stay under Vercel Hobby's 12-function limit) backing an Uber/DiDi-style flow for cases with no area match: `POST {accion:'publicar'}` creates an `open` room, `GET` lists open requests of the caller's `tipo_profesional`, `POST {accion:'tomar', roomId}` is an **atomic claim — first professional wins**. Both writes validate the caller is an approved professional.

### Admin Panel

[src/pages/AdminPage.jsx](src/pages/AdminPage.jsx) is the superadmin control center. Tabs (declared in a single `TABS` array):

- **Solicitudes** (`pending`) — approve/reject new registrations
- **Aprobados** (`approved`) — manage approved professionals; revoke approval
- **Historial chats** (`chats`) — mounts `SuperAdminChatViewer` for all consultation rooms
- **Recuperar chats** (`recuperar`) — list closed `chat_rooms` and re-open them
- **Alertas** (`alertas`) — rooms with no activity for 24h+
- **Chat interno** (`chat_interno`) — mounts `AdminInternalChat`
- **Contratos** (`contratos`) — pick an approved professional chip, then mount `MisContratos` with `isSuperAdmin={true}` (admin can view/delete that user's files)
- **Códigos QR** (`codigos`) — mounts `CodigosReferencia` to generate/manage `AAP-XXXXXX` codes

Inside Solicitudes / Aprobados / Contratos a `RolChips` row filters between **Todos / Abogados / Contadores** (state: `rolFilter`). Use this when adding new role-aware features so they integrate with the existing filter.

`VideoCarousel` edit mode is exposed inline on the homepage when the logged-in user is superadmin — it is **not** an admin-page tab.

### Professional Profile Pages

Two profile pages share the same CSS module ([ProfilePage.module.css](src/pages/ProfilePage.module.css)) and similar shape:

- [src/pages/ProfilePage.jsx](src/pages/ProfilePage.jsx) — lawyers (`rol = 'abogado'`)
- [src/pages/ProfileContadorPage.jsx](src/pages/ProfileContadorPage.jsx) — accountants (`rol = 'contador'`)

Both let the user edit personal data, social links, profile photo, intro video, and a tarjeta-profesional file; both mount `LawyerInternalChat`, `MisContratos` (`isSuperAdmin={false}`), a chat dashboard (`LawyerChatDashboard` vs `ContadorChatDashboard`), and the `AsistenteIA` panel (the "IA Parada Precise" professional assistant — see **AI System** above).

**Professional notification center ([src/components/profile/NotificacionesPro.jsx](src/components/profile/NotificacionesPro.jsx)):** both profile pages mount `useProBadges` + `CampanaPro` (approved professionals only). Numeric badges on the sidebar rail (Consultas = unread client messages using the same `chat_seen_${uid}`/last-response semantics as the dashboards; Chat interno = `mensajes_internos.leido=false`; Pagos = `pagos_profesional` pendientes) + a floating bell whose panel shows count-based shortcuts to those sections and the professional's own `notificaciones` rows (pago/inactividad/etc.). Polls every 30s, paused when the tab is hidden. The bell's "read" state is LOCAL (`noti_seen_${uid}` in localStorage) — professionals deliberately have NO UPDATE policy on `notificaciones` (they could hide alerts from the admin). Reading their own rows requires the SELECT policy in [docs/sql/notificaciones-profesional-2026-08-31.sql](docs/sql/notificaciones-profesional-2026-08-31.sql); without it the bell degrades to the local counters only.

⚠️ **Column reuse:** `profiles.area_derecho` stores the comma-joined list of specialties for both roles — for contadores it actually means *especialidades contables* (Auditoría, Tributaria, etc.). The column was kept rather than adding a new one. When reading or filtering by specialty, treat its meaning as role-dependent.

Storage paths: photos → `profile-photos`, videos → `profile-videos`, contracts → `contratos`, tarjeta profesional file → `tarjetas-profesionales`. ⚠️ In the `contratos` bucket a professional can INSERT into their own folder but cannot overwrite (`x-upsert`/PUT → "new row violates row-level security policy") nor delete — always upload under a new unique name. That is why the modelo contractual is stored as `<uid>/modelo-contractual-<timestamp>.pdf` and `profiles.modelo_contrato_path` is repointed ([DocumentosConfianza.jsx](src/components/profile/DocumentosConfianza.jsx), `RegisterModal`); the previous file stays in the bucket.

### Homepage Sections

The public homepage (`/`) composes these key sections (all in [src/components/home/](src/components/home/) unless noted):
- `Hero` — landing banner
- `VideoCarousel` — promotional videos from the `videos_carrusel` table; superadmins can add/remove/reorder videos inline
- `LawyersSection` / `LawyerCard` — grid of approved professionals; toggle between `abogado` and `contador` plus filters by area, departamento, ciudad
- `ChatSection` (in `chat/`) — client consultation flow (tipo abogado/contador, then specialty)
- `ModelosContractualesSection` — contract templates section
- `MapSection` — interactive Colombia map rendered with **d3** + **topojson-client** (these deps exist solely for this component)
- `CTASection` / `WhatsAppButton` — call-to-action and WhatsApp link
- `AuthModal` / `RegisterContadorModal` (in `auth/`) — launched from the navbar

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Lawyer / contador / superadmin accounts — `id`, `rol`, `aprobado`, personal/professional fields, social links, `foto_url`, `video_url`, `tarjeta_archivo_url`, `area_derecho` (comma-joined specialties; meaning depends on `rol`), `puede_descargar_archivos` (boolean — lets that professional download non-image chat files; defaults false) |
| `chat_rooms` / `chat_messages` | Client consultation sessions with status (`waiting` / `active` / `closed`) and `tipo_profesional` (`abogado`/`contador`). ⚠️ `chat_rooms.codigo_referencia` should NOT be UNIQUE — the AAP-XXXXXX referral code can be reused. The frontend has a 23505-fallback that retries the insert with `codigo_referencia=null` if the constraint is still in place; the proper fix is `ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_codigo_referencia_key`. |
| `chat_room_lawyers` | Many-to-many room↔professional assignment; `lawyer_id` is reused for contadores |
| `chat_ratings` | Star rating + comment a client leaves at the end of a consultation |
| `pqr` | Client petitions / quejas / reclamos submitted after a chat closes. Insert is done with the **anon key** from `ChatSection`, so RLS requires explicit policies: `GRANT INSERT ON public.pqr TO anon, authenticated;` + `CREATE POLICY "Anyone can insert pqr" ON public.pqr FOR INSERT TO public WITH CHECK (true);`. Without these, INSERTs fail with code 42501. |
| `mensajes_internos` | DMs between professionals and the superadmin (`from_id`, `to_id`, `leido`) — polled, not Realtime |
| `contratos` | Per-professional contract files (also a Storage bucket of the same name); rows store `abogado_id`, `storage_path`, `descripcion` |
| `codigos_referencia` | QR reference codes (`AAP-XXXXXX`) managed via [src/components/admin/CodigosReferencia.jsx](src/components/admin/CodigosReferencia.jsx) |
| `videos_carrusel` | Promotional videos — `video_url`, `poster_url` (thumbnail of first frame, generated client-side by [src/utils/extractPoster.js](src/utils/extractPoster.js)), `orden`, `activo`. Managed via [src/components/home/VideoCarousel.jsx](src/components/home/VideoCarousel.jsx) |
| `verification_codes` | Email OTPs for registration (`email`, `code`, `tipo_registro`, `expires_at`, `used`, `created_at`). Written/read **only by the two verification serverless functions** using the service-role key — never queried from the client. |
| `ai_sesiones` | Client-triage sessions (`ip_hash`, `tipo_profesional`, `mensajes_count`, plus the recommendation snapshot `area_detectada`/`resumen`/`recomendados`/`costo_rango`). Written/read **only by api/ai.js** with the service-role key; IPs are SHA-256-hashed (`AI_IP_SALT`). Drives the per-session/per-IP triage rate limits. DDL in [docs/sql/ai_sesiones.sql](docs/sql/ai_sesiones.sql). |
| `ai_uso_salas` | Per-room/day counter (`room_id`, `fecha`, `usos`, `profesional_id`) capping the professional assistant's summarize/analyze action at `AI_MAX_USOS_SALA_DIA`. Service-role only (RLS-locked). **Optional** — if the table is absent, api/ai.js silently skips the cap. DDL in [docs/sql/ai_uso_salas.sql](docs/sql/ai_uso_salas.sql). |
| `notificaciones` | Admin notification center (`tipo` `inactividad`\|`verificacion`, `room_id`, `lawyer_id`, `client_nombre`, `area`, `mensaje`, `leido`, `atendida`, `created_at`). **RLS-locked: only superadmin SELECT/UPDATE; INSERT/DELETE service-role only.** The bell ([NotificationBell.jsx](src/components/admin/NotificationBell.jsx), mounted in AdminPage header) reads unread rows directly via REST; writes happen in the `verify-request`/`reassign`/`cron` endpoints. Schema (table + indexes + RLS) was applied by hand in Supabase, not tracked in-repo. |

Storage buckets in use: `profile-photos`, `profile-videos`, `contratos`, `tarjetas-profesionales`.
