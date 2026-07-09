-- docs/sql/ai_sesiones.sql
-- Estado server-authoritative de las sesiones de triage de IA del cliente.
-- Aplicar a mano en Supabase (igual que la tabla `notificaciones`).
-- El navegador NUNCA lee/escribe esto: todo pasa por api/ai.js con service-role.

create table if not exists public.ai_sesiones (
  id               uuid primary key default gen_random_uuid(),
  ip_hash          text,
  mensajes_count   int  not null default 0,
  area_detectada   text,
  resumen          text,
  recomendados     jsonb not null default '[]'::jsonb,
  costo_rango      text,
  tipo_profesional text not null default 'abogado',
  created_at       timestamptz not null default now()
);

-- Para el rate-limit por IP/hora.
create index if not exists ai_sesiones_ip_created_idx
  on public.ai_sesiones (ip_hash, created_at desc);

alter table public.ai_sesiones enable row level security;

-- Sin policies para anon/authenticated => acceso directo bloqueado.
-- La service-role key (usada por api/ai.js) bypassa RLS.
revoke all on public.ai_sesiones from anon, authenticated;
