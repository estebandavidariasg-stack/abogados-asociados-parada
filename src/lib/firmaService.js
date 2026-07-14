/* ─────────────────────────────────────────────────────────────────────────
   firmaService — persistencia de firmas por Supabase REST (sin funciones
   serverless nuevas: respeta el límite de 12 de Vercel).

   Tablas: firmas_solicitudes, firmas_firmantes.  Bucket: documentos-firma.
   Ver docs/sql/firmas.sql y el spec.
   ───────────────────────────────────────────────────────────────────────── */
import { getAuthHeaders } from './supabase'
import { hashDocumento, generarCertificadoPdf } from './firmaPdf'

const URL = import.meta.env.VITE_SUPABASE_URL
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY
const BUCKET = 'documentos-firma'

/* Headers para el cliente ANÓNIMO del chat (sin sesión). */
export function anonHeaders() {
  return { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' }
}

/* Sube bytes PDF al bucket privado. `headers` autenticados o anónimos. */
export async function subirDoc(path, bytes, headers, contentType = 'application/pdf') {
  const h = { ...headers }
  delete h['Content-Type']
  const res = await fetch(`${URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: new Blob([bytes], { type: contentType }),
  })
  if (!res.ok) throw new Error('No se pudo subir el documento firmado')
  return path
}

/* URL firmada fresca (7 días) para descargar/ver un documento del bucket. */
export async function urlFirmada(path, headers) {
  const res = await fetch(`${URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: 'POST', headers, body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
  })
  const data = await res.json()
  return data?.signedURL ? `${URL}/storage/v1${data.signedURL}` : ''
}

export async function bytesDeDoc(path, headers) {
  const url = await urlFirmada(path, headers)
  if (!url) throw new Error('No se pudo obtener el documento')
  const r = await fetch(url)
  if (!r.ok) throw new Error('No se pudo descargar el documento')
  return new Uint8Array(await r.arrayBuffer())
}

/* Crea la solicitud + sus firmantes. Devuelve { solicitud, firmantes }. */
export async function crearSolicitud({ origen, roomId, contratoId, creadorId, docOriginalPath, firmantes }, headers) {
  const solRes = await fetch(`${URL}/rest/v1/firmas_solicitudes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      origen, room_id: roomId || null, contrato_id: contratoId || null,
      creador_id: creadorId, doc_original_path: docOriginalPath, estado: 'pendiente',
    }),
  })
  if (!solRes.ok) throw new Error('No se pudo crear la solicitud de firma')
  const solicitud = (await solRes.json())[0]

  const filas = firmantes.map((f, i) => ({
    solicitud_id: solicitud.id, orden: i, rol_firma: f.rol,
    nombre: f.nombre || null, cedula: f.cedula || null, telefono: f.telefono || null,
    correo: f.correo, ciudad: f.ciudad || null, estado: 'pendiente', otp_verificado: false,
  }))
  const firRes = await fetch(`${URL}/rest/v1/firmas_firmantes`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(filas),
  })
  if (!firRes.ok) throw new Error('No se pudieron registrar los firmantes')
  return { solicitud, firmantes: await firRes.json() }
}

/* Marca una fila de firmante como firmada (traza + hash). */
export async function registrarFirmaFirmante(firmanteId, { pie, docHash }, headers) {
  const res = await fetch(`${URL}/rest/v1/firmas_firmantes?id=eq.${firmanteId}`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      estado: 'firmado', otp_verificado: true,
      nombre: pie.nombre, cedula: pie.cedula, telefono: pie.telefono,
      correo: pie.correo, ciudad: pie.ciudad,
      firmado_at: new Date().toISOString(),
      ip: null, // la IP la registra idealmente un endpoint; aquí queda null
      user_agent: (navigator?.userAgent || '').slice(0, 300),
      doc_hash: docHash || null,
    }),
  })
  if (!res.ok) throw new Error('No se pudo registrar la firma')
  return (await res.json())[0]
}

/* Cierra la solicitud: guarda el PDF firmado final y estado='firmado'. */
export async function cerrarSolicitud(solicitudId, docFirmadoPath, headers) {
  const res = await fetch(`${URL}/rest/v1/firmas_solicitudes?id=eq.${solicitudId}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({ doc_firmado_path: docFirmadoPath, estado: 'firmado' }),
  })
  if (!res.ok) throw new Error('No se pudo cerrar la solicitud')
  return (await res.json())[0]
}

/* Firmantes pendientes de una solicitud. */
export async function firmantesPendientes(solicitudId, headers) {
  const res = await fetch(
    `${URL}/rest/v1/firmas_firmantes?solicitud_id=eq.${solicitudId}&select=*&order=orden`,
    { headers },
  )
  return res.ok ? await res.json() : []
}

/* Evidencia firmada de un profesional, con sus firmantes embebidos.
   Devuelve { clientes: [...], administracion: [...] }. */
export async function listarEvidencia(profesionalId, headers) {
  const url =
    `${URL}/rest/v1/firmas_solicitudes` +
    `?estado=eq.firmado&or=(creador_id.eq.${profesionalId})` +
    `&select=*,firmas_firmantes(*)&order=created_at.desc`
  const res = await fetch(url, { headers })
  const rows = res.ok ? await res.json() : []
  return {
    clientes: rows.filter((r) => r.origen === 'chat'),
    administracion: rows.filter((r) => r.origen === 'contrato'),
  }
}

/* ── Orquestación: persistir la firma de UN firmante ──────────────────────
   Sube el PDF ya estampado, marca la fila del firmante, y si ya no quedan
   firmantes pendientes: anexa el certificado de auditoría, guarda el PDF final
   y cierra la solicitud. Devuelve { completa, docFirmadoPath }.
   `signedBytes` viene de FirmaSigner (ya trae la firma + pie estampados). */
export async function persistirFirma({ solicitud, firmante, signedBytes, pie, headers }) {
  const running = `${solicitud.id}/firmado.pdf`
  const docHash = await hashDocumento(signedBytes)

  await subirDoc(running, signedBytes, headers)
  await registrarFirmaFirmante(firmante.id, { pie, docHash }, headers)

  const filas = await firmantesPendientes(solicitud.id, headers)
  const pendientes = filas.filter((f) => f.estado !== 'firmado')

  if (pendientes.length === 0) {
    // Todos firmaron. El PDF estampado queda como respaldo. Generamos el
    // CERTIFICADO como PDF aparte (ambos flujos lo usan). El documento en Word
    // (firma movible) lo genera el llamador del chat y reescribe doc_firmado_path.
    try {
      const certBytes = await generarCertificadoPdf({
        solicitudId: solicitud.id, docHash,
        firmantes: filas.map((f) => ({
          nombre: f.nombre, cedula: f.cedula, correo: f.correo, rol: f.rol_firma,
          firmado_at: f.firmado_at, ip: f.ip, user_agent: f.user_agent,
        })),
      })
      await subirDoc(`${solicitud.id}/certificado.pdf`, certBytes, headers, 'application/pdf')
    } catch (e) { console.error('[cert]', e?.message || e) }

    await cerrarSolicitud(solicitud.id, running, headers)
    return { completa: true, docFirmadoPath: running, firmantes: filas, docHash }
  }
  // Faltan firmantes: dejamos el PDF parcial como doc_firmado_path (base del
  // siguiente firmante) sin cerrar la solicitud.
  await fetch(`${URL}/rest/v1/firmas_solicitudes?id=eq.${solicitud.id}`, {
    method: 'PATCH', headers: { ...headers, Prefer: 'return=minimal' },
    body: JSON.stringify({ doc_firmado_path: running }),
  })
  return { completa: false, docFirmadoPath: running }
}

export { getAuthHeaders }
