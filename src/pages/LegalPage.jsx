import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { DOCS_LEGALES, DOCS_FOOTER } from '../components/shared/DocumentosLegales'
import { PdfVisor } from '../lib/chatFiles'
import styles from './LegalPage.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   /terminos, /privacidad, /cookies, /eula, /devoluciones,
   /autorizacion-datos, /contrato-profesional, /contrato-gestor

   Páginas legales públicas a página completa: el documento OFICIAL (el PDF
   de public/legal, el mismo del footer y del registro), no un texto aparte.
   Antes aquí vivía un borrador escrito a mano que ya no coincidía con lo que
   revisó la abogada; un enlace que llega por correo o por WhatsApp tiene que
   abrir lo mismo que se acepta en la plataforma.

   El PDF se pinta con PdfVisor (páginas como imágenes) para que se lea igual
   en el celular, donde un <iframe> con PDF queda en blanco.
   ───────────────────────────────────────────────────────────────────────── */

// Orden del índice al pie: los generales del footer y, al final, los contratos.
const INDICE = [...DOCS_FOOTER, 'profesional', 'corretaje']

export default function LegalPage({ doc = 'terminos' }) {
  const clave = DOCS_LEGALES[doc] ? doc : 'terminos'
  const d = DOCS_LEGALES[clave]
  const [info, setInfo] = useState(null)

  useEffect(() => {
    document.title = `${d.titulo} · Parada Bridge`
    window.scrollTo(0, 0)
    setInfo(null)
  }, [d.titulo])

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <Link to="/" className={styles.back}>← Volver al inicio</Link>
          <p className={styles.brand}>Parada <span>Bridge</span></p>
          <h1 className={styles.title}>{d.titulo}</h1>
          <p className={styles.sub}>
            {d.sub}
            <span className={styles.subSep} aria-hidden="true">·</span>
            PDF{info?.total ? ` · ${info.total} página${info.total === 1 ? '' : 's'}` : ''}
          </p>
          <a className={styles.descargar} href={d.pdf} download={d.archivo}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12M7 11l5 5 5-5M4 21h16" />
            </svg>
            Descargar PDF
          </a>
        </div>
      </header>

      <main className={styles.content}>
        <div className={styles.visor}>
          <PdfVisor key={d.pdf} url={d.pdf} titulo={d.titulo} fondo="#f1ede9" maxPaginas={60} onInfo={setInfo} />
        </div>

        <nav className={styles.otros} aria-label="Otros documentos legales">
          <h2 className={styles.otrosTitulo}>Otros documentos</h2>
          <ul className={styles.otrosLista}>
            {INDICE.filter(k => k !== clave).map(k => (
              <li key={k}>
                <Link to={DOCS_LEGALES[k].ruta} className={styles.otroLink}>
                  <span className={styles.otroTitulo}>{DOCS_LEGALES[k].titulo}</span>
                  <span className={styles.otroSub}>{DOCS_LEGALES[k].sub}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
    </div>
  )
}
