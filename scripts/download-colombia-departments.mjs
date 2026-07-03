/**
 * Descarga el archivo de provincias/estados de Natural Earth (15 MB, mundo entero),
 * filtra solo Colombia y guarda el resultado (~200 KB) en public/colombia-departamentos.json
 *
 * Ejecutar una sola vez:  node scripts/download-colombia-departments.mjs
 */
import { writeFileSync } from 'fs'

const URL = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

console.log('Descargando Natural Earth provinces (puede tardar ~10s)...')

const res  = await fetch(URL)
if (!res.ok) throw new Error(`HTTP ${res.status}`)
const data = await res.json()

const colombia = {
  type: 'FeatureCollection',
  features: data.features.filter(f =>
    f.properties?.admin === 'Colombia' ||
    f.properties?.iso_a2 === 'CO'
  ),
}

if (!colombia.features.length) throw new Error('No se encontraron features de Colombia')

writeFileSync('public/colombia-departamentos.json', JSON.stringify(colombia))
console.log(`✓ ${colombia.features.length} departamentos guardados en public/colombia-departamentos.json`)
