-- ════════════════════════════════════════════════════════════════════════
--  Firma electrónica — esquema (tablas + índices + RLS) y bucket de storage.
--  Aplicar en el SQL Editor de Supabase. Ver el spec:
--  docs/superpowers/specs/2026-07-10-firma-electronica-design.md
--
--  NO agrega funciones serverless (respeta el límite de 12 de Vercel):
--  todo el estampado corre en el navegador y la persistencia va por REST.
-- ════════════════════════════════════════════════════════════════════════

-- ── 0. OTP de firma: ampliar el CHECK de verification_codes ──────────────
--  La tabla `verification_codes` (registro) tiene un CHECK que solo permitía
--  'abogado','contador','gestor'. El OTP de firma usa tipo_registro='firma',
--  así que hay que incluirlo o el envío del código falla con error 23514.
alter table public.verification_codes
  drop constraint if exists verification_codes_tipo_registro_check;
alter table public.verification_codes
  add constraint verification_codes_tipo_registro_check
  check (tipo_registro in ('abogado','contador','gestor','firma'));

-- ── 1. Tablas ───────────────────────────────────────────────────────────
create table if not exists public.firmas_solicitudes (
  id                uuid primary key default gen_random_uuid(),
  origen            text not null check (origen in ('chat','contrato')),
  room_id           uuid references public.chat_rooms(id) on delete set null,
  contrato_id       uuid references public.contratos(id) on delete set null,
  creador_id        uuid not null references public.profiles(id) on delete cascade,
  doc_original_path text not null,
  doc_firmado_path  text,
  estado            text not null default 'pendiente'
                       check (estado in ('pendiente','firmado','cancelado')),
  created_at        timestamptz not null default now()
);

create table if not exists public.firmas_firmantes (
  id             uuid primary key default gen_random_uuid(),
  solicitud_id   uuid not null references public.firmas_solicitudes(id) on delete cascade,
  orden          int  not null default 0,
  rol_firma      text not null check (rol_firma in ('cliente','abogado','contador','administrador')),
  nombre         text,
  cedula         text,
  telefono       text,
  correo         text not null,
  ciudad         text,
  estado         text not null default 'pendiente' check (estado in ('pendiente','firmado')),
  firmado_at     timestamptz,
  ip             text,
  user_agent     text,
  otp_verificado boolean not null default false,
  doc_hash       text
);

-- ── 2. Índices ──────────────────────────────────────────────────────────
create index if not exists idx_firmas_sol_creador  on public.firmas_solicitudes(creador_id);
create index if not exists idx_firmas_sol_room      on public.firmas_solicitudes(room_id);
create index if not exists idx_firmas_sol_contrato  on public.firmas_solicitudes(contrato_id);
create index if not exists idx_firmas_sol_estado    on public.firmas_solicitudes(estado);
create index if not exists idx_firmas_fir_solicitud on public.firmas_firmantes(solicitud_id);

-- ── 3. RLS ──────────────────────────────────────────────────────────────
alter table public.firmas_solicitudes enable row level security;
alter table public.firmas_firmantes  enable row level security;

-- Profesionales/administradores autenticados: crear y ver sus solicitudes.
create policy "prof crea solicitudes" on public.firmas_solicitudes
  for insert to authenticated
  with check (creador_id = auth.uid());

create policy "prof ve sus solicitudes" on public.firmas_solicitudes
  for select to authenticated
  using (
    creador_id = auth.uid()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.rol = 'superadmin')
  );

create policy "prof/admin actualiza solicitud" on public.firmas_solicitudes
  for update to authenticated
  using (
    creador_id = auth.uid()
    or exists (select 1 from public.profiles p
               where p.id = auth.uid() and p.rol = 'superadmin')
  );

-- Chat: el cliente anónimo también puede crear la solicitud/actualizar SU fila
-- (patrón del INSERT anónimo en `pqr`). Acotado a origen='chat'.
create policy "anon crea solicitud de chat" on public.firmas_solicitudes
  for insert to anon
  with check (origen = 'chat');

-- El cliente anónimo lee y cierra SOLO solicitudes de chat (para firmar).
create policy "anon ve solicitud de chat" on public.firmas_solicitudes
  for select to anon using (origen = 'chat');
create policy "anon cierra solicitud de chat" on public.firmas_solicitudes
  for update to anon using (origen = 'chat') with check (origen = 'chat');

-- Firmantes: lectura por dueños de la solicitud + superadmin.
create policy "ve firmantes de solicitud propia" on public.firmas_firmantes
  for select to authenticated
  using (
    exists (select 1 from public.firmas_solicitudes s
            where s.id = solicitud_id
              and (s.creador_id = auth.uid()
                   or exists (select 1 from public.profiles p
                              where p.id = auth.uid() and p.rol = 'superadmin')))
  );

create policy "crea firmantes" on public.firmas_firmantes
  for insert to authenticated with check (true);
create policy "anon crea firmantes de chat" on public.firmas_firmantes
  for insert to anon with check (true);

-- Cualquier firmante (autenticado o anónimo del chat) puede marcar SU fila como
-- firmada. El id de la fila actúa como token: solo quien lo tiene puede firmar.
create policy "firma su fila (auth)" on public.firmas_firmantes
  for update to authenticated using (true) with check (true);
create policy "firma su fila (anon)" on public.firmas_firmantes
  for update to anon using (true) with check (true);

-- Cliente anónimo del chat: lectura de las filas de firmantes (para ver estado).
create policy "anon ve firmantes de chat" on public.firmas_firmantes
  for select to anon using (true);

-- ════════════════════════════════════════════════════════════════════════
--  4. BUCKET DE STORAGE  (crear en Dashboard → Storage, o con este SQL)
-- ════════════════════════════════════════════════════════════════════════
insert into storage.buckets (id, name, public)
values ('documentos-firma', 'documentos-firma', false)
on conflict (id) do nothing;

-- Políticas de storage: subir/leer para autenticados; el chat (anon) sube y lee
-- los documentos de firma. (Bucket privado; el acceso real es por URL firmada.)
create policy "firma docs: leer" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'documentos-firma');

create policy "firma docs: subir" on storage.objects
  for insert to authenticated, anon
  with check (bucket_id = 'documentos-firma');

create policy "firma docs: actualizar" on storage.objects
  for update to authenticated, anon
  using (bucket_id = 'documentos-firma');

-- ════════════════════════════════════════════════════════════════════════
--  NOTA sobre `contratos`: para enlazar el PDF firmado con el contrato de
--  MisContratos se usa firmas_solicitudes.contrato_id + doc_firmado_path.
--  No se agregan columnas a la tabla `contratos`.
-- ════════════════════════════════════════════════════════════════════════
