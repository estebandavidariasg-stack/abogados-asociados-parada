-- ════════════════════════════════════════════════════════════════════════
--  Reseñas de la página web — tabla + RLS + job pg_cron (envío a los 5 min).
--  Aplicar en Supabase → SQL Editor. Ver la sección "AI System"/spec del repo.
--
--  Flujo:
--    1. Al cerrar una consulta, el dashboard inserta una fila `pendiente` con
--       enviar_despues = now() + 5 min y un token único.
--    2. pg_cron (cada 5 min) llama al endpoint /api/cron/gen-inactividad, que
--       envía el correo de las pendientes vencidas y las marca `enviada`.
--    3. El cliente abre /opinar?token=..&rating=.., escribe y envía → `recibida`.
--    4. El superadmin aprueba (aprobado=true) → aparece en el home.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabla ────────────────────────────────────────────────────────────
create table if not exists public.resenas (
  id             uuid primary key default gen_random_uuid(),
  room_id        uuid references public.chat_rooms(id) on delete set null,
  token          text unique not null,
  nombre         text,
  correo         text not null,
  rol            text,                       -- etiqueta para el home (ej. "Cliente")
  rating         int check (rating between 1 and 5),
  texto          text,
  estado         text not null default 'pendiente'
                    check (estado in ('pendiente','enviada','recibida','aprobada')),
  aprobado       boolean not null default false,   -- visible en el home
  enviar_despues timestamptz not null default now() + interval '5 minutes',
  created_at     timestamptz not null default now()
);

create index if not exists idx_resenas_cola     on public.resenas(estado, enviar_despues);
create index if not exists idx_resenas_aprobado on public.resenas(aprobado, created_at desc);
create index if not exists idx_resenas_token     on public.resenas(token);

-- ── 2. RLS ──────────────────────────────────────────────────────────────
alter table public.resenas enable row level security;

-- Home (anon): ver SOLO reseñas aprobadas. Columnas públicas por GRANT (abajo).
create policy "anon ve resenas aprobadas" on public.resenas
  for select to anon using (aprobado = true);

-- El cliente (anon) sube su opinión: transición enviada → recibida, por token.
-- El token (en la URL del correo) es el secreto; PATCH filtra por ?token=eq.X.
create policy "anon envia su resena" on public.resenas
  for update to anon
  using (estado = 'enviada')
  with check (estado = 'recibida');

-- Profesionales autenticados: crear la fila pendiente al cerrar la consulta.
create policy "prof crea resena pendiente" on public.resenas
  for insert to authenticated with check (true);

-- Superadmin: ver todo, aprobar/editar, eliminar.
create policy "superadmin ve resenas" on public.resenas
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'superadmin'));
create policy "superadmin edita resenas" on public.resenas
  for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'superadmin'));
create policy "superadmin borra resenas" on public.resenas
  for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'superadmin'));

-- ── 3. Privilegios de columna (evita exponer `correo` al home anónimo) ────
revoke all on public.resenas from anon;
grant select (id, nombre, rol, rating, texto, created_at) on public.resenas to anon;
grant update (texto, rating, estado) on public.resenas to anon;

-- ════════════════════════════════════════════════════════════════════════
--  4. pg_cron + pg_net  — envío del correo a los 5 minutos
--  (independiente del cron de Vercel; funciona en el plan gratuito de Supabase)
--
--  a) Habilitar extensiones (Dashboard → Database → Extensions, o aquí):
create extension if not exists pg_cron;
create extension if not exists pg_net;

--  b) Agendar el job cada 5 minutos. REEMPLAZA:
--       · TU-DOMINIO           por tu dominio real (ej. abogadosyasociadosparada.com)
--       · TU_CRON_SECRET       por el valor de CRON_SECRET configurado en Vercel
--
--     (Para re-agendar: primero `select cron.unschedule('resenas-5min');`)
--
--  select cron.schedule('resenas-5min', '*/5 * * * *', $$
--    select net.http_post(
--      url     := 'https://TU-DOMINIO/api/cron/gen-inactividad',
--      headers := jsonb_build_object('Authorization', 'Bearer TU_CRON_SECRET')
--    );
--  $$);
-- ════════════════════════════════════════════════════════════════════════
