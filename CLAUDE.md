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

### Chat System

Three components cover the full consultation lifecycle:

| Component | User | Description |
|-----------|------|-------------|
| [src/components/ChatSection.jsx](src/components/ChatSection.jsx) | Client | 5-step flow: cédula → personal form → lawyer selection → live chat → star rating |
| [src/components/LawyerChatDashboard.jsx](src/components/LawyerChatDashboard.jsx) | Lawyer | Assigned chat rooms sidebar + real-time messaging |
| [src/components/SuperAdminChatViewer.jsx](src/components/SuperAdminChatViewer.jsx) | Superadmin | All rooms with search, moderation, force-close |

All three use **Supabase Realtime** (Phoenix WS) for live message updates. Chat rooms support text, file attachments, audio messages ([src/components/AudioPlayer.jsx](src/components/AudioPlayer.jsx)), and peer-to-peer video calls via WebRTC ([src/components/VideoCallOverlay.jsx](src/components/VideoCallOverlay.jsx) — uses Google STUN servers, Supabase channel for signaling).

Client cédulas are stored as **SHA-256 hashes** for anonymity.

### Admin Panel

[src/pages/admin/AdminPage.jsx](src/pages/admin/AdminPage.jsx) is the superadmin control center with four tabs:
- **Pendientes** — approve/reject new lawyer registrations
- **Aprobados** — manage approved lawyers (edit `especialidad`, revoke approval)
- **Chats** — mounts `SuperAdminChatViewer` for all consultation rooms
- **Códigos** — mounts `CodigosReferencia` to generate/manage `AAP-XXXXXX` QR reference codes
- **Videos** — mounts `VideoCarousel` in edit mode to manage homepage promotional videos

### Lawyer Profile

[src/pages/ProfilePage.jsx](src/pages/ProfilePage.jsx) lets authenticated lawyers edit their public profile (personal data, specialties, social links, profile photo, intro video) and view their assigned chat rooms via `LawyerChatDashboard`. Photo uploads go to the `profile-photos` bucket; video uploads go to `profile-videos`.

### Homepage Sections

The public homepage (`/`) composes these key sections:
- `Hero` — landing banner
- `VideoCarousel` — promotional videos from the `videos_carrusel` table; superadmins can add/remove/reorder videos inline
- `LawyersSection` / `LawyerCard` — grid of approved lawyers
- `ChatSection` — client consultation flow
- `MapSection` — office location embed
- `CTASection` / `WhatsAppButton` — call-to-action and WhatsApp link

### Key Database Tables

| Table | Purpose |
|-------|---------|
| `profiles` | Lawyer accounts — `id`, `rol`, `aprobado`, personal/professional fields, social links, `foto_url`, `video_url` |
| `chat_rooms` / `chats` | Consultation sessions with status (`waiting` / `active` / `closed`) |
| `codigos_referencia` | QR reference codes (`AAP-XXXXXX`) managed by superadmin via [src/components/CodigosReferencia.jsx](src/components/CodigosReferencia.jsx) |
| `videos_carrusel` | Promotional videos shown on homepage, managed by superadmin via [src/components/VideoCarousel.jsx](src/components/VideoCarousel.jsx) |
