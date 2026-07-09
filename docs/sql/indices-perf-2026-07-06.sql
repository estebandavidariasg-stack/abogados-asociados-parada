-- ─────────────────────────────────────────────────────────────────────────
-- Índices de rendimiento — auditoría 2026-07-06
--
-- ⚠️ PASO MANUAL: ejecutar en Supabase → SQL Editor (no se aplican solos).
-- Complementan el lote aplicado a mano en 2026-06: chat_messages(room_id,
-- created_at), chat_room_lawyers(lawyer_id,room_id)+(room_id),
-- chat_rooms(status,created_at), profiles(aprobado,rol), mensajes_internos,
-- pqr, forgot_password_attempts.
--
-- Todos usan IF NOT EXISTS: re-ejecutar es inofensivo.
-- ─────────────────────────────────────────────────────────────────────────

-- 1) Lookup por cédula en la ruta pública MÁS caliente: cada cliente que
--    entra al flujo de consulta busca sus salas por client_cedula (paso
--    Identificación + startChat + búsqueda del admin). chat_rooms crece sin
--    cota (las cerradas se conservan) → sin índice es un seq scan por visita.
CREATE INDEX IF NOT EXISTS chat_rooms_client_cedula_created_idx
  ON public.chat_rooms (client_cedula, created_at DESC);

-- 2) OTPs de registro: la tabla nunca se poda por diseño (el rate-limit
--    rueda sobre el histórico). Cubre el conteo de rate-limit (email +
--    created_at), la invalidación (email + used) y el verify (email).
CREATE INDEX IF NOT EXISTS verification_codes_email_created_idx
  ON public.verification_codes (email, created_at DESC);

-- 3) Calificaciones: la agregación del home (/api/professionals, en cada
--    MISS del CDN) filtra por lawyer_id in.(todos los aprobados); los
--    detalles del admin filtran por room_id.
CREATE INDEX IF NOT EXISTS chat_ratings_lawyer_id_idx
  ON public.chat_ratings (lawyer_id);
CREATE INDEX IF NOT EXISTS chat_ratings_room_id_idx
  ON public.chat_ratings (room_id);

-- Opcional (higiene, compatible con el rate-limit de 10 min de los OTP):
-- poda mensual de códigos viejos. Ejecutar a mano de vez en cuando, o crear
-- un job pg_cron si el proyecto lo tiene habilitado.
-- DELETE FROM public.verification_codes WHERE created_at < now() - interval '30 days';
