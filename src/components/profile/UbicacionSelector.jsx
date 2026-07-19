import { useState } from 'react'
import { UBICACIONES, DEPARTAMENTOS } from '../../data/colombia-ubicaciones'

const OTRA = 'Otra'

/**
 * Selector de ubicación en cascada de 3 niveles:
 *  1) Departamento  ─ siempre visible
 *  2) Municipio o Localidad  ─ visible al elegir depto
 *  3) Barrio / Comuna  ─ visible si el municipio tiene lista O si el usuario
 *     eligió "Otra" en municipio (para poder describir su barrio manualmente)
 *
 * Controlado: el padre mantiene { departamento, municipio, barrio } y recibe
 * el set completo en cada onChange. Nivel superior resetea los inferiores.
 *
 * Opción "Otra": tanto Municipio como Barrio incluyen una opción "Otra". Al
 * elegirla se revela un input de texto libre y el valor escrito se persiste
 * hacia arriba con el MISMO contrato onChange (no se guarda el literal "Otra",
 * sino el texto que el usuario escribe). En la rehidratación: si el valor
 * guardado no está en la lista de opciones (y no es vacío), se considera un
 * valor personalizado → el <select> muestra "Otra" y el input aparece con el
 * texto. El departamento NO tiene "Otra" (la lista nacional es cerrada y de
 * ella depende toda la cascada).
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
  // Estado local SÓLO para recordar que el usuario eligió "Otra" antes de
  // escribir nada (mientras el texto está vacío el valor guardado no lo delata).
  // No se filtra al padre: el contrato onChange sigue siendo strings puros.
  const [municipioOtraOn, setMunicipioOtraOn] = useState(false)
  const [barrioOtraOn, setBarrioOtraOn]       = useState(false)

  const dep = UBICACIONES[departamento]
  const isBogota = dep?.esBogota === true

  const opcionesNivel2 = isBogota
    ? (dep.localidades || [])
    : (dep ? Object.keys(dep.municipios || {}).sort((a, b) => a.localeCompare(b, 'es')) : [])

  const opcionesNivel3 = (!isBogota && dep && municipio && municipio !== OTRA)
    ? (dep.municipios?.[municipio] || [])
    : []

  // ── Detección de valores personalizados ("Otra") ──
  // Municipio: el usuario lo eligió explícitamente (flag local) o hay un valor
  // guardado que no está entre las opciones del depto (rehidratación en edición).
  const municipioEsOtra =
    !!departamento && (municipioOtraOn || (!!municipio && !opcionesNivel2.includes(municipio)))
  // Barrio: eligió "Otra" explícitamente, o el valor guardado no está en la lista.
  const barrioEsOtra =
    !!municipio && (barrioOtraOn || (!!barrio && !opcionesNivel3.includes(barrio)))

  // El nivel 3 se muestra si el municipio oficial trae barrios, o si municipio
  // es "Otra" (sin lista) para permitir escribir el barrio a mano.
  const mostrarNivel3 = opcionesNivel3.length > 0 || (municipioEsOtra && !!municipio)

  const star = required ? <span style={{ color: 'var(--gold)' }}> *</span> : null

  return (
    <>
      {/* Nivel 1 — Departamento */}
      <div className={classes.field}>
        <label className={classes.label}>Departamento{star}</label>
        <select
          className={classes.select}
          value={departamento}
          onChange={e => {
            setMunicipioOtraOn(false)
            setBarrioOtraOn(false)
            onChange({ departamento: e.target.value, municipio: '', barrio: '' })
          }}
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
            value={municipioEsOtra ? OTRA : municipio}
            onChange={e => {
              const v = e.target.value
              if (v === OTRA) {
                // Entra en modo libre: recuerda el flag y limpia municipio/barrio.
                setMunicipioOtraOn(true)
                setBarrioOtraOn(false)
                onChange({ departamento, municipio: '', barrio: '' })
              } else {
                setMunicipioOtraOn(false)
                setBarrioOtraOn(false)
                onChange({ departamento, municipio: v, barrio: '' })
              }
            }}
          >
            <option value="">Seleccionar…</option>
            {opcionesNivel2.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
            <option value={OTRA}>Otra…</option>
          </select>
          {municipioEsOtra && (
            <input
              type="text"
              className={classes.select}
              style={{ marginTop: '0.5rem' }}
              placeholder={isBogota ? 'Escribe tu localidad' : 'Escribe tu municipio'}
              value={municipio}
              onChange={e =>
                onChange({ departamento, municipio: e.target.value, barrio })
              }
              aria-label={isBogota ? 'Otra localidad' : 'Otro municipio'}
            />
          )}
        </div>
      )}

      {/* Nivel 3 — Barrio / Comuna */}
      {mostrarNivel3 && (
        <div className={classes.field}>
          <label className={classes.label}>Barrio / Comuna</label>
          <select
            className={classes.select}
            value={barrioEsOtra ? OTRA : barrio}
            onChange={e => {
              const v = e.target.value
              if (v === OTRA) {
                setBarrioOtraOn(true)
                onChange({ departamento, municipio, barrio: '' })
              } else {
                setBarrioOtraOn(false)
                onChange({ departamento, municipio, barrio: v })
              }
            }}
          >
            <option value="">Seleccionar…</option>
            {opcionesNivel3.map(b => (
              <option key={b} value={b}>{b}</option>
            ))}
            <option value={OTRA}>Otra…</option>
          </select>
          {barrioEsOtra && (
            <input
              type="text"
              className={classes.select}
              style={{ marginTop: '0.5rem' }}
              placeholder="Escribe tu barrio o comuna"
              value={barrio}
              onChange={e =>
                onChange({ departamento, municipio, barrio: e.target.value })
              }
              aria-label="Otro barrio o comuna"
            />
          )}
        </div>
      )}
    </>
  )
}
