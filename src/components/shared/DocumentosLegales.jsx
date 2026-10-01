import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PdfVisor } from '../../lib/chatFiles'
import styles from './DocumentosLegales.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   Documentos legales de la plataforma: UN catálogo y UN visor.

   Antes cada pantalla resolvía esto a su manera: el footer abría un <iframe>
   (en blanco en Android), el registro y el chat mandaban a /terminos, una
   página con un BORRADOR escrito a mano que ya no coincidía con los PDF que
   revisó la abogada. Aquí queda una sola verdad:

     · DOCS_LEGALES  — clave → { titulo, sub, pdf, archivo }. Los PDF viven en
                       public/legal con nombre corto; los originales con nombre
                       largo están en docs/ (ignorados por git).
     · VisorLegal    — modal con el PDF rasterizado (PdfVisor: se ve igual en
                       escritorio y celular) + descarga. Portado a <body> y por
                       encima de cualquier modal (--z-visor), porque se abre
                       desde dentro del registro.
     · EnlaceLegal   — el "términos de uso" subrayado de una frase: abre el
                       visor ahí mismo, sin pestaña nueva ni perder el
                       formulario que se estaba llenando.

   Quién ve qué:
     · Footer     → DOCS_FOOTER (los generales, en Title Case).
     · Registro   → contratoDeRol(rol): el Contrato del Profesional para
                    abogado/contador, el de Corretaje Comercial para el gestor.
     · IA         → `ia`: los términos de la herramienta de inteligencia
                    artificial, en el aviso de primer uso del asistente.
     · /terminos, /privacidad… → LegalPage monta el mismo PdfVisor a página
                    completa (enlaces que llegan por correo o por fuera).
   ───────────────────────────────────────────────────────────────────────── */
export const DOCS_LEGALES = {
  terminos: {
    titulo: 'Términos de Uso',
    sub: 'Contrato de adhesión para el uso de la plataforma',
    pdf: '/legal/terminos-de-uso.pdf',
    archivo: 'Parada Bridge - Terminos de Uso.pdf',
    ruta: '/terminos',
  },
  eula: {
    titulo: 'Licencia de Usuario Final (EULA)',
    sub: 'Derechos de uso del software y la plataforma',
    pdf: '/legal/eula.pdf',
    archivo: 'Parada Bridge - EULA.pdf',
    ruta: '/eula',
  },
  // Fuera del footer desde 2026-09-30 (no está entre los 8 documentos de
  // docs/); se conserva para los enlaces que ya circulan.
  autorizacion: {
    titulo: 'Autorización de Tratamiento de Datos',
    sub: 'Contrato y autorización para el tratamiento de datos personales',
    pdf: '/legal/autorizacion-datos.pdf',
    archivo: 'Parada Bridge - Autorizacion de Datos.pdf',
    ruta: '/autorizacion-datos',
  },
  privacidad: {
    titulo: 'Política de Privacidad',
    sub: 'Cómo se recoge, usa y protege tu información',
    pdf: '/legal/politica-privacidad.pdf',
    archivo: 'Parada Bridge - Politica de Privacidad.pdf',
    ruta: '/privacidad',
  },
  datos: {
    titulo: 'Política de Tratamiento de Datos',
    sub: 'Datos personales · Ley 1581 de 2012',
    pdf: '/legal/politica-tratamiento-datos.pdf',
    archivo: 'Parada Bridge - Politica de Tratamiento de Datos.pdf',
    ruta: '/tratamiento-datos',
  },
  cookies: {
    titulo: 'Política de Cookies',
    sub: 'Tecnologías de navegación y preferencias',
    pdf: '/legal/politica-cookies.pdf',
    archivo: 'Parada Bridge - Politica de Cookies.pdf',
    ruta: '/cookies',
  },
  devoluciones: {
    titulo: 'Política de Devoluciones',
    sub: 'Cancelaciones, devoluciones y reembolsos',
    pdf: '/legal/politica-devoluciones.pdf',
    archivo: 'Parada Bridge - Politica de Devoluciones.pdf',
    ruta: '/devoluciones',
  },
  // `resumen`: la línea corta para el registro, donde el rol ya se eligió y
  // "abogados y contadores" sobra.
  profesional: {
    titulo: 'Contrato del Profesional',
    sub: 'Intermediación comercial y comisión · abogados y contadores',
    resumen: 'Intermediación comercial y comisión',
    pdf: '/legal/contrato-profesional.pdf',
    archivo: 'Parada Bridge - Contrato del Profesional.pdf',
    ruta: '/contrato-profesional',
  },
  corretaje: {
    titulo: 'Contrato de Corretaje Comercial',
    sub: 'Corretaje comercial y acuerdo de confidencialidad · gestores',
    resumen: 'Corretaje comercial y acuerdo de confidencialidad',
    pdf: '/legal/contrato-corretaje-comercial.pdf',
    archivo: 'Parada Bridge - Contrato de Corretaje Comercial.pdf',
    ruta: '/contrato-gestor',
  },
  // Lo acepta el abogado o contador la primera vez que abre "IA Parada
  // Precise" (aviso de primer uso en chat/AsistenteIA).
  ia: {
    titulo: 'Términos de Uso de la Herramienta de Inteligencia Artificial',
    sub: 'Condiciones de uso de la IA de apoyo · abogados y contadores',
    resumen: 'Condiciones de uso de la IA de apoyo',
    pdf: '/legal/terminos-ia-profesionales.pdf',
    archivo: 'Parada Bridge - Terminos de Uso de la Herramienta de IA.pdf',
    ruta: '/terminos-ia',
  },
}

// Los generales, en el orden del footer: contratos primero, políticas después.
// Son exactamente los que el Contrato de Corretaje y el EULA citan como marco
// de la plataforma (Términos, EULA, Datos, Privacidad, Cookies, Devoluciones).
export const DOCS_FOOTER = ['terminos', 'eula', 'privacidad', 'datos', 'cookies', 'devoluciones']

// El contrato que firma cada rol al registrarse.
export const contratoDeRol = (rol) => (rol === 'gestor' ? 'corretaje' : 'profesional')

// Acepta la clave o el objeto; devuelve el objeto (o null si no existe).
const resolver = (doc) => (typeof doc === 'string' ? DOCS_LEGALES[doc] || null : doc || null)

/* Visor. `doc` = clave o entrada del catálogo; null = cerrado. */
export function VisorLegal({ doc, onClose }) {
  const d = resolver(doc)
  const pdf = d?.pdf || null
  const [info, setInfo] = useState(null)
  const cerrarRef = useRef(null)
  const tituloId = useId()
  // `onClose` suele ser una flecha nueva en cada render: si el efecto
  // dependiera de ella, se rearmaría a cada pintado y devolvería el foco a
  // un botón ya desmontado. Depende solo del PDF abierto.
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Esc cierra SOLO el visor. Se escucha en captura sobre window para ganarle
  // al modal que lo abrió (registro, login): ese escucha en document y, si le
  // llegara la tecla, cerraría el formulario entero con el contrato encima.
  useEffect(() => {
    if (!pdf) return
    setInfo(null)
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onCloseRef.current?.()
    }
    window.addEventListener('keydown', onKey, true)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const previo = document.activeElement
    cerrarRef.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prev
      if (previo && typeof previo.focus === 'function') previo.focus()
    }
  }, [pdf])

  if (!d) return null

  return createPortal(
    <div
      className={styles.overlay}
      role="dialog" aria-modal="true" aria-labelledby={tituloId}
      onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose?.() }}
    >
      <div className={styles.card}>
        <div className={styles.head}>
          <div className={styles.headInfo}>
            <h2 id={tituloId} className={styles.title}>{d.titulo}</h2>
            <p className={styles.meta}>
              {d.sub}
              <span className={styles.metaSep} aria-hidden="true">·</span>
              PDF{info?.total ? ` · ${info.total} página${info.total === 1 ? '' : 's'}` : ''}
            </p>
          </div>
          <button
            ref={cerrarRef}
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label="Cerrar documento"
            title="Cerrar"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          <PdfVisor url={d.pdf} titulo={d.titulo} fondo="#f1ede9" maxPaginas={60} onInfo={setInfo} />
        </div>

        <div className={styles.foot}>
          <p className={styles.note}>Documento oficial de Parada Bridge. Puedes guardarlo para leerlo con calma.</p>
          <a className={styles.download} href={d.pdf} download={d.archivo}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
            </svg>
            Descargar PDF
          </a>
        </div>
      </div>
    </div>,
    document.body
  )
}

/* Enlace dentro de una frase ("Acepto los <términos de uso>"). Es un botón
   con pinta de enlace: abre el visor en el sitio, no una pestaña. Hereda la
   tipografía y el color de la frase; `className`/`style` los pone quien lo
   usa para respetar su propio estilo de enlace. */
export function EnlaceLegal({ doc, children, className = '', style }) {
  const [abierto, setAbierto] = useState(false)
  const d = resolver(doc)
  if (!d) return children ?? null
  return (
    <>
      {/* <a>, no <button>: un botón es una caja que no se parte entre líneas,
          así que "política de tratamiento de datos" saltaba entero a la línea
          siguiente y dejaba media fila vacía. El enlace fluye como texto. El
          clic abre el visor aquí mismo; con clic central o "abrir en pestaña
          nueva" lleva a la página completa del documento (d.ruta). */}
      <a
        href={d.ruta}
        className={`${styles.enlace} ${className}`.trim()}
        style={style}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return   // pestaña nueva: se deja pasar
          e.preventDefault(); e.stopPropagation(); setAbierto(true)
        }}
      >
        {children ?? d.titulo}
      </a>
      {abierto && <VisorLegal doc={d} onClose={() => setAbierto(false)} />}
    </>
  )
}
