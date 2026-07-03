/* ────────────────────────────────────────────────────────────────────────
   Prueba de carga (k6) — valida que la plataforma aguanta el tráfico público
   sin reventar y que el CDN está cacheando las lecturas públicas.

   Simula el camino del CLIENTE (la mayoría del tráfico): cargar el home y las
   listas públicas cacheadas (profesionales + carrusel).

   ── Cómo correrlo ────────────────────────────────────────────────────────
   1. Instala k6:  https://k6.io/docs/get-started/installation/
                   (Windows:  winget install k6 --source winget)
   2. Apunta a tu deploy (NO a localhost: el CDN solo cachea en Vercel):
        k6 run -e BASE_URL=https://tu-deploy.vercel.app scripts/loadtest.k6.js
   3. Para subir la carga, sobreescribe el pico:
        k6 run -e BASE_URL=https://... -e PEAK=2000 scripts/loadtest.k6.js

   ⚠️  ADVERTENCIA: esto genera tráfico REAL contra tu backend (Supabase +
   Vercel). En Supabase Free puedes agotar cuota o gatillar rate-limits.
   Corre primero el perfil por defecto (suave) y sube de a poco. Idealmente
   prueba contra un deploy de PREVIEW, no producción en vivo.
──────────────────────────────────────────────────────────────────────── */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

// Tasa de aciertos del CDN (x-vercel-cache: HIT). Debe tender a ~1.0: si está
// bajo, el cache no está funcionando y Postgres recibe cada request.
const cdnHit = new Rate('cdn_cache_hit')

const BASE = __ENV.BASE_URL || 'http://localhost:3000'
const PEAK = parseInt(__ENV.PEAK || '300', 10)   // VUs en el pico (sube con -e PEAK=)

export const options = {
  stages: [
    { duration: '1m', target: Math.round(PEAK * 0.25) },
    { duration: '2m', target: PEAK },
    { duration: '2m', target: PEAK },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_failed:   ['rate<0.01'],   // <1% de errores
    http_req_duration: ['p(95)<800'],   // p95 < 800 ms
    cdn_cache_hit:     ['rate>0.80'],   // >80% servido desde el CDN
  },
}

function recordCache(res) {
  const h = (res.headers['X-Vercel-Cache'] || res.headers['x-vercel-cache'] || '').toUpperCase()
  // STALE también cuenta como servido desde el borde (no pegó a Postgres).
  cdnHit.add(h === 'HIT' || h === 'STALE')
}

export default function () {
  // 1) Home (estático en CDN)
  const home = http.get(`${BASE}/`)
  check(home, { 'home 200': r => r.status === 200 })

  // 2) Lista de profesionales — endpoint cacheado. 70% abogado / 30% contador.
  const rol = Math.random() < 0.7 ? 'abogado' : 'contador'
  const pros = http.get(`${BASE}/api/professionals?rol=${rol}`)
  check(pros, { 'professionals 200': r => r.status === 200 })
  recordCache(pros)

  // 3) Carrusel — endpoint cacheado.
  const carousel = http.get(`${BASE}/api/carousel`)
  check(carousel, { 'carousel 200': r => r.status === 200 })
  recordCache(carousel)

  // Pausa "humana" entre 1 y 4 s para no martillar de forma irreal.
  sleep(Math.random() * 3 + 1)
}
