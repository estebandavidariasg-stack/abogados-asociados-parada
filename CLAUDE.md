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

`BrowserRouter` and `AuthProvider` are mounted in [src/main.jsx](src/main.jsx).

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
| `shared/` | `Icons` (only) |

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

Five Vercel serverless functions live under [api/](api/). All of them share the same navy + gold AAP-branded HTML email card (matching the verification-code email).

| File | Purpose |
|------|---------|
| [api/notify.js](api/notify.js) | Transactional emails via Nodemailer (Gmail SMTP). Dispatches by `type`: `new_consultation` (notify lawyer when a client opens a consultation) and `lawyer_joined` (notify client when professional joins). CTA link points to `https://abogadosyasociadosparada.com`. ⚠️ The frontend ([ChatSection.jsx](src/components/chat/ChatSection.jsx)) still calls `notificarSuperAdminContacto` with `type: 'contact_blocked'` for messages containing phone/email regex matches, but the endpoint no longer handles that branch — the call silently no-ops. |
| [api/forgot-password.js](api/forgot-password.js) | Custom password-reset flow. Uses `auth/v1/admin/generate_link` (requires `SUPABASE_SERVICE_ROLE_KEY`) to mint the recovery link, then sends a branded email. Always responds 200 to avoid user enumeration. The link points to `/nueva-contrasena`. |
| [api/send-contact-card.js](api/send-contact-card.js) | Sends a lawyer's contact card to a client by email. |
| [api/send-verification-code.js](api/send-verification-code.js) | Issues a 6-digit OTP for new lawyer/contador registration. Rate-limited 3/10min per email, 10-min TTL. Previous unused codes are marked `used=true` (NOT deleted) so the rolling rate-limit count remains accurate. Requires `SUPABASE_SERVICE_ROLE_KEY` (admin user lookup + writes to `verification_codes`). |
| [api/verify-code.js](api/verify-code.js) | Validates `(email, code)`. A single PostgREST PATCH with `used=false` + `expires_at>now()` filters → atomic update, no TOCTOU window. Returns generic "Código inválido o expirado" on any failure (no enumeration). On success returns `tipoRegistro` so the caller can route to the correct signup path. Requires `SUPABASE_SERVICE_ROLE_KEY`. |

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

**Sidebar unread badge (lawyer/contador dashboards):** counts client messages since the professional's last response OR last opening of that room (whichever is more recent). "Last opened" is persisted in `localStorage` under `chat_seen_${userId}` so the badge stays at 0 across switches between rooms (WhatsApp-style — opening a chat marks it seen even without replying). No `seen_at` column exists in the BD; state is per-browser, not synced cross-device.

Client cédulas are stored as **SHA-256 hashes** for anonymity. Outgoing messages are scanned for phone/email regexes; matches don't block the message but trigger a `contact_blocked` notification call (currently a no-op endpoint — see Serverless Functions note).

**2. Internal staff chat (polling, NOT Realtime)** — backed by `mensajes_internos` table. Professional ↔ superadmin DM:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/chat/LawyerInternalChat.jsx](src/components/chat/LawyerInternalChat.jsx) | Lawyer / Contador | DM thread with the (single) superadmin; resolves admin id by `rol=eq.superadmin`. Reused by `ProfileContadorPage`. |
| [src/components/chat/AdminInternalChat.jsx](src/components/chat/AdminInternalChat.jsx) | Superadmin | Sidebar of approved professionals + DM thread |

Both poll `mensajes_internos` every 3s via `setInterval` and `getAuthHeaders()`-authenticated `fetch`. Messages have `from_id`, `to_id`, `leido` (read flag); unread counts drive badges. **Don't reach for Realtime here** — the polling design is intentional and matches the rest of this feature.

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

Both let the user edit personal data, social links, profile photo, intro video, and a tarjeta-profesional file; both mount `LawyerInternalChat`, `MisContratos` (`isSuperAdmin={false}`), and a chat dashboard (`LawyerChatDashboard` vs `ContadorChatDashboard`).

⚠️ **Column reuse:** `profiles.area_derecho` stores the comma-joined list of specialties for both roles — for contadores it actually means *especialidades contables* (Auditoría, Tributaria, etc.). The column was kept rather than adding a new one. When reading or filtering by specialty, treat its meaning as role-dependent.

Storage paths: photos → `profile-photos`, videos → `profile-videos`, contracts → `contratos`, tarjeta profesional file → `tarjetas-profesionales`.

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
| `profiles` | Lawyer / contador / superadmin accounts — `id`, `rol`, `aprobado`, personal/professional fields, social links, `foto_url`, `video_url`, `tarjeta_archivo_url`, `area_derecho` (comma-joined specialties; meaning depends on `rol`) |
| `chat_rooms` / `chat_messages` | Client consultation sessions with status (`waiting` / `active` / `closed`) and `tipo_profesional` (`abogado`/`contador`). ⚠️ `chat_rooms.codigo_referencia` should NOT be UNIQUE — the AAP-XXXXXX referral code can be reused. The frontend has a 23505-fallback that retries the insert with `codigo_referencia=null` if the constraint is still in place; the proper fix is `ALTER TABLE chat_rooms DROP CONSTRAINT chat_rooms_codigo_referencia_key`. |
| `chat_room_lawyers` | Many-to-many room↔professional assignment; `lawyer_id` is reused for contadores |
| `chat_ratings` | Star rating + comment a client leaves at the end of a consultation |
| `pqr` | Client petitions / quejas / reclamos submitted after a chat closes. Insert is done with the **anon key** from `ChatSection`, so RLS requires explicit policies: `GRANT INSERT ON public.pqr TO anon, authenticated;` + `CREATE POLICY "Anyone can insert pqr" ON public.pqr FOR INSERT TO public WITH CHECK (true);`. Without these, INSERTs fail with code 42501. |
| `mensajes_internos` | DMs between professionals and the superadmin (`from_id`, `to_id`, `leido`) — polled, not Realtime |
| `contratos` | Per-professional contract files (also a Storage bucket of the same name); rows store `abogado_id`, `storage_path`, `descripcion` |
| `codigos_referencia` | QR reference codes (`AAP-XXXXXX`) managed via [src/components/admin/CodigosReferencia.jsx](src/components/admin/CodigosReferencia.jsx) |
| `videos_carrusel` | Promotional videos — `video_url`, `poster_url` (thumbnail of first frame, generated client-side by [src/utils/extractPoster.js](src/utils/extractPoster.js)), `orden`, `activo`. Managed via [src/components/home/VideoCarousel.jsx](src/components/home/VideoCarousel.jsx) |
| `verification_codes` | Email OTPs for registration (`email`, `code`, `tipo_registro`, `expires_at`, `used`, `created_at`). Written/read **only by the two verification serverless functions** using the service-role key — never queried from the client. |

Storage buckets in use: `profile-photos`, `profile-videos`, `contratos`, `tarjetas-profesionales`.
