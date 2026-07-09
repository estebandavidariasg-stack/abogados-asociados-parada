-- docs/sql/ai_uso_salas.sql
-- Conteo de usos de IA (resumir/analizar) por sala de consulta y día,
-- para el tope de costo del profesional (máx. 2 por sala/día).
-- Escrita solo por api/ai.js con service-role. RLS bloquea acceso directo.
-- Si NO se aplica esta tabla, el endpoint simplemente no aplica el tope
-- (no se rompe nada); el conteo empieza cuando exista.

create table if not exists public.ai_uso_salas (
  room_id        uuid not null,
  fecha          date not null,
  usos           int  not null default 0,
  profesional_id uuid,
  primary key (room_id, fecha)
);

alter table public.ai_uso_salas enable row level security;
revoke all on public.ai_uso_salas from anon, authenticated;
