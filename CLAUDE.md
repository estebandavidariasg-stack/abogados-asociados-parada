# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server at localhost:5173
npm run build    # Production build
npm run preview  # Preview production build locally
```

No test runner is configured.

## Environment Variables

```
VITE_SUPABASE_URL        # Supabase project URL
VITE_SUPABASE_ANON_KEY   # Supabase anon/public JWT
VITE_RECAPTCHA_SITE_KEY  # Google reCAPTCHA v3 site key
VITE_APP_URL             # Public app URL (used in email templates)
GMAIL_USER               # Nodemailer sender address (server-side only)
GMAIL_PASS               # Gmail app password (server-side only)
```

## Architecture

**Stack:** React 18 + Vite, React Router DOM 6, Supabase (custom client), Vercel (hosting + serverless functions).

### Routing

Three routes defined in [src/App.jsx](src/App.jsx):

| Path | Component | Access |
|------|-----------|--------|
| `/` | `HomePage` | Public |
| `/perfil` | `ProfilePage` | Authenticated lawyer |
| `/admin` | `AdminPage` | `superadmin` role only |

`BrowserRouter` and `AuthProvider` are mounted in [src/main.jsx](src/main.jsx). [src/components/ProtectedRoute.jsx](src/components/ProtectedRoute.jsx) guards private routes; pass `requireAdmin={true}` to restrict to superadmins.

### Auth & Roles

[src/context/AuthContext.jsx](src/context/AuthContext.jsx) is the single source of truth for auth state. It exposes:
- `user` — Supabase auth user object
- `profile` — row from the `profiles` table
- `isSuperAdmin`, `isApproved` — derived booleans
- `signIn(email, password)`, `signUp(data)`, `signOut()`
- Token is auto-refreshed every 50 minutes via `localStorage`

Roles are stored in `profiles.rol` (`"abogado"` or `"superadmin"`). The `aprobado` boolean on `profiles` controls whether a lawyer is visible on the homepage and can access `/perfil`.

### Custom Supabase Client

**Always use [src/lib/supabase.js](src/lib/supabase.js) — do not import from `@supabase/supabase-js`.**

This is a hand-rolled REST + WebSocket client that wraps the Supabase REST API directly. It provides:
- A chainable query builder: `supabase.from('table').select('*').eq('col', val).single()`
- Mutations: `.insert()`, `.update()`, `.delete()`
- Realtime subscriptions over the **Phoenix WebSocket protocol** (not Supabase's JS SDK channels) — only `postgres_changes` events are handled; broadcast events are not implemented in `RealtimeChannel`
- Storage API for file uploads to `profile-photos` and `profile-videos` buckets
- Auth methods: `signInWithPassword`, `signUp`, `signOut`, `getSession`
- `getAuthHeaders()` (exported) — auto-refreshes the token before returning headers; use this for any raw `fetch` calls that require auth

### Serverless Function

[api/notify.js](api/notify.js) runs as a Vercel serverless function. It sends transactional emails via Nodemailer (Gmail SMTP). Two event types:
- `new_consultation` — notifies the assigned lawyer of a new client chat
- `lawyer_joined` — notifies the client that their lawyer connected

Call it from the frontend with `fetch('/api/notify', { method: 'POST', body: JSON.stringify({ type, ... }) })`.

### Chat Systems

There are **two independent chat systems** that should not be confused:

**1. Client consultation chats (Realtime via Phoenix WS)** — backed by `chat_rooms` / `chats` tables. Three components cover the lifecycle:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/ChatSection.jsx](src/components/ChatSection.jsx) | Client | 5-step flow: cédula → personal form → lawyer selection → live chat → star rating |
| [src/components/LawyerChatDashboard.jsx](src/components/LawyerChatDashboard.jsx) | Lawyer | Assigned chat rooms sidebar + real-time messaging |
| [src/components/SuperAdminChatViewer.jsx](src/components/SuperAdminChatViewer.jsx) | Superadmin | All rooms with search, moderation, force-close |

These use **Supabase Realtime** (`postgres_changes` over Phoenix WS) for live message updates. Rooms support text, file attachments, audio messages ([src/components/AudioPlayer.jsx](src/components/AudioPlayer.jsx)), and peer-to-peer video calls via WebRTC ([src/components/VideoCallOverlay.jsx](src/components/VideoCallOverlay.jsx) — Google STUN servers, Supabase channel for signaling).

Client cédulas are stored as **SHA-256 hashes** for anonymity.

**2. Internal staff chat (polling, NOT Realtime)** — backed by `mensajes_internos` table. Lawyer ↔ superadmin DM:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/LawyerInternalChat.jsx](src/components/LawyerInternalChat.jsx) | Lawyer | DM thread with the (single) superadmin; resolves admin id by `rol=eq.superadmin` |
| [src/components/AdminInternalChat.jsx](src/components/AdminInternalChat.jsx) | Superadmin | Sidebar of approved lawyers + DM thread with selected one |

Both poll `mensajes_internos` every 3s via `setInterval` and `getAuthHeaders()`-authenticated `fetch`. Messages have `from_id`, `to_id`, `leido` (read flag); unread counts drive badges. **Don't reach for Realtime here** — the polling design is intentional and matches the rest of this feature.

### Admin Panel

[src/pages/admin/AdminPage.jsx](src/pages/admin/AdminPage.jsx) is the superadmin control center. Tabs (declared as a single array around line 155):

- **Solicitudes** (`pending`) — approve/reject new lawyer registrations
- **Aprobados** (`approved`) — manage approved lawyers (edit `especialidad`, revoke approval)
- **Historial chats** (`chats`) — mounts `SuperAdminChatViewer` for all consultation rooms
- **Recuperar chats** (`recuperar`) — list closed `chat_rooms` and re-open them
- **Alertas** (`alertas`) — rooms with no activity for 24h+
- **Chat interno** (`chat_interno`) — mounts `AdminInternalChat`
- **Contratos** (`contratos`) — pick an approved lawyer chip, then mount `MisContratos` with `isSuperAdmin={true}` (admin can view/delete that lawyer's files)
- **Códigos QR** (`codigos`) — mounts `CodigosReferencia` to generate/manage `AAP-XXXXXX` codes

`VideoCarousel` edit mode is exposed inline on the homepage when the logged-in user is superadmin — it is **not** an admin-page tab.

### Lawyer Profile

[src/pages/ProfilePage.jsx](src/pages/ProfilePage.jsx) lets authenticated lawyers edit their public profile (personal data, specialties, social links, profile photo, intro video), DM the superadmin via `LawyerInternalChat`, manage their contract files via `MisContratos` (`isSuperAdmin={false}` — upload + view/download own only), and view their assigned chat rooms via `LawyerChatDashboard`. Photo uploads go to `profile-photos`, videos to `profile-videos`, contracts to the `contratos` bucket.

### Homepage Sections

The public homepage (`/`) composes these key sections:
- `Hero` — landing banner
- `VideoCarousel` — promotional videos from the `videos_carrusel` table; superadmins can add/remove/reorder videos inline
- `LawyersSection` / `LawyerCard` — grid of approved lawyers
- `ChatSection` — client consultation flow
- `MapSection` — interactive Colombia map rendered with **d3** + **topojson-client** (these deps exist solely for this component)
- `CTASection` / `WhatsAppButton` — call-to-action and WhatsApp link

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Lawyer accounts — `id`, `rol`, `aprobado`, personal/professional fields, social links, `foto_url`, `video_url` |
| `chat_rooms` / `chats` | Client consultation sessions with status (`waiting` / `active` / `closed`) — used by the Realtime chat system |
| `mensajes_internos` | DMs between lawyers and the superadmin (`from_id`, `to_id`, `leido`) — polled, not Realtime |
| `contratos` | Per-lawyer contract files (also a Storage bucket of the same name); rows store `abogado_id`, `storage_path`, descripcion |
| `codigos_referencia` | QR reference codes (`AAP-XXXXXX`) managed via [src/components/CodigosReferencia.jsx](src/components/CodigosReferencia.jsx) |
| `videos_carrusel` | Promotional videos shown on homepage, managed via [src/components/VideoCarousel.jsx](src/components/VideoCarousel.jsx) |

Storage buckets in use: `profile-photos`, `profile-videos`, `contratos`.
