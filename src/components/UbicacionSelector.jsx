import { UBICACIONES, DEPARTAMENTOS } from '../data/colombia-ubicaciones'

/**
 * Selector de ubicación en cascada de 3 niveles:
 *  1) Departamento  ─ siempre visible
 *  2) Municipio o Localidad  ─ visible al elegir depto
 *  3) Barrio / Comuna  ─ visible solo si el municipio tiene lista
 *
 * Controlado: el padre mantiene { departamento, municipio, barrio } y recibe
 * el set completo en cada onChange. Nivel superior resetea los inferiores.
 *
 * Estilos: hereda los del formulario que lo embebe vía la prop `classes`,
 * con shape `{ field, label, select }`. Si una clase no se pasa, el select
 * queda sin estilo (no asume nada).
 */
export default function UbicacionSelector({
  departamento = '',
  municipio = '',
  barrio = '',
  onChange,
  required = false,
  classes = {},
}) {
  const dep = UBICACIONES[departamento]
  const isBogota = dep?.esBogota === true

  const opcionesNivel2 = isBogota
    ? (dep.localidades || [])
    : (dep ? Object.keys(dep.municipios || {}).sort((a, b) => a.localeCompare(b, 'es')) : [])

  const opcionesNivel3 = (!isBogota && dep && municipio)
    ? (dep.municipios?.[municipio] || [])
    : []

  const star = required ? <span style={{ color: 'var(--gold)' }}> *</span> : null

  return (
    <>
      {/* Nivel 1 — Departamento */}
      <div className={classes.field}>
        <label className={classes.label}>Departamento{star}</label>
        <select
          className={classes.select}
          value={departamento}
          onChange={e =>
            onChange({ departamento: e.target.value, municipio: '', barrio: '' })
          }
        >
          <option value="">Seleccionar…</option>
          {DEPARTAMENTOS.map(d => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>

      {/* Nivel 2 — Municipio / Localidad */}
      {departamento && (
        <div className={classes.field}>
          <label className={classes.label}>
            {isBogota ? 'Localidad' : 'Municipio'}{star}
          </label>
          <select
            className={classes.select}
            value={municipio}
            onChange={e =>
              onChange({ departamento, municipio: e.target.value, barrio: '' })
            }
          >
            <option value="">Seleccionar…</option>
            {opcionesNivel2.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      )}

      {/* Nivel 3 — Barrio / Comuna (sólo si hay opciones) */}
      {opcionesNivel3.length > 0 && (
        <div className={classes.field}>
          <label className={classes.label}>Barrio / Comuna</label>
          <select
            className={classes.select}
            value={barrio}
            onChange={e =>
              onChange({ departamento, municipio, barrio: e.target.value })
            }
          >
            <option value="">Seleccionar…</option>
            {opcionesNivel3.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
          </select>
        </div>
      )}
    </>
  )
}
