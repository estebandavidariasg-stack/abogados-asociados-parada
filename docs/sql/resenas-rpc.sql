-- ════════════════════════════════════════════════════════════════════════
--  Reseñas — envío seguro vía RPC (SECURITY DEFINER).
--  Aplicar en Supabase → SQL Editor. Endurece el flujo de /opinar:
--
--  · anon YA NO puede hacer UPDATE directo sobre `resenas` (se revoca).
--  · La reseña entra SOLO por la función enviar_resena(token, rating, texto),
--    que corre como owner (bypass RLS) y devuelve true/false fiable —
--    sin RETURNING filtrado por RLS, sin exponer ninguna fila, y con el
--    token de un solo uso (enviada→recibida) como candado anti-abuso.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.enviar_resena(
  p_token  text,
  p_rating int,
  p_texto  text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_afectadas int;
begin
  -- Validación de rango: 1..5. Fuera de eso → error (400 en PostgREST).
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'rating fuera de rango' using errcode = '22023';
  end if;

  -- Transición de un solo uso: solo aplica si el token existe y sigue en 'enviada'.
  update public.resenas
     set rating = p_rating,
         texto  = nullif(btrim(coalesce(p_texto, '')), ''),
         estado = 'recibida'
   where token  = p_token
     and estado = 'enviada';

  get diagnostics v_afectadas = row_count;
  return v_afectadas > 0;   -- true = guardada; false = token inválido/ya usado/expirado
end;
$$;

-- Solo anon/authenticated pueden ejecutar la función; nadie más.
revoke all    on function public.enviar_resena(text, int, text) from public;
grant  execute on function public.enviar_resena(text, int, text) to anon, authenticated;

-- Cerrar el UPDATE directo de anon: las reseñas SOLO entran por la función.
drop   policy if exists "anon envia su resena" on public.resenas;
revoke update on public.resenas from anon;
