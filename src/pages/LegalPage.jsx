import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import styles from './LegalPage.module.css'

/* ─────────────────────────────────────────────────────────────────────────
   /terminos  y  /privacidad  — páginas legales públicas.

   El contenido es un BORRADOR base para una plataforma de intermediación
   jurídica/contable en Colombia. Debe ser revisado y ajustado por la
   asesoría legal de la firma antes de considerarse vinculante. Se enlaza
   desde los checkboxes de registro, del formulario de consulta y del
   asistente de IA.
   ───────────────────────────────────────────────────────────────────────── */

const HOY = new Date().toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })

const DOCS = {
  terminos: {
    titulo: 'Términos y Condiciones',
    intro:
      'Estos Términos y Condiciones regulan el uso de la plataforma Parada Bridge, un servicio de intermediación que conecta a personas que buscan orientación jurídica o contable con profesionales independientes.',
    secciones: [
      {
        h: '1. Naturaleza del servicio',
        p: [
          'Parada Bridge es una plataforma de intermediación tecnológica. No prestamos directamente servicios jurídicos ni contables: facilitamos el contacto entre usuarios y profesionales independientes (abogados y contadores) que ofrecen sus servicios de forma autónoma.',
          'La relación profesional, sus honorarios y el alcance de cada gestión se acuerdan directamente entre el usuario y el profesional. Parada Bridge no es parte de esa relación ni responde por el resultado de las gestiones.',
        ],
      },
      {
        h: '2. Uso de la plataforma',
        p: [
          'Al usar la plataforma, el usuario declara que la información que suministra es veraz y que es mayor de edad o cuenta con la representación necesaria para actuar.',
          'Está prohibido usar la plataforma para fines ilícitos, suplantar la identidad de terceros o compartir datos de contacto directos dentro del chat con el fin de evadir el canal oficial de la plataforma.',
        ],
      },
      {
        h: '3. Orientación y valores de referencia',
        p: [
          'La información y los rangos de valores que muestra el asistente automatizado tienen carácter meramente orientativo. No constituyen asesoría jurídica ni contable definitiva ni una oferta vinculante.',
          'En Colombia los honorarios profesionales son de libre acuerdo entre las partes; no existe una tarifa oficial obligatoria. El valor final de cualquier servicio lo confirma el profesional antes de iniciar la gestión.',
        ],
      },
      {
        h: '4. Asistente de inteligencia artificial',
        p: [
          'La plataforma ofrece herramientas asistidas por inteligencia artificial como apoyo a los profesionales y a la clasificación de consultas. Sus respuestas son borradores de apoyo y siempre requieren la revisión de un profesional habilitado.',
          'La IA puede cometer errores u omisiones. Ninguna respuesta generada automáticamente debe presentarse ante autoridades ni tomarse como concepto profesional sin revisión humana.',
        ],
      },
      {
        h: '5. Responsabilidad',
        p: [
          'Parada Bridge no garantiza resultados de las gestiones profesionales ni responde por la actuación de los profesionales registrados, quienes son responsables de sus propios servicios conforme a la ley y a sus códigos deontológicos (entre otros, la Ley 1123 de 2007 para los abogados).',
          'Hacemos esfuerzos razonables para mantener la plataforma disponible y segura, pero no garantizamos una operación libre de interrupciones o errores.',
        ],
      },
      {
        h: '6. Propiedad intelectual',
        p: [
          'La marca, el diseño, los textos y el software de la plataforma pertenecen a Parada Bridge o a sus licenciantes. No se permite su reproducción sin autorización.',
        ],
      },
      {
        h: '7. Cambios y contacto',
        p: [
          'Podemos actualizar estos Términos en cualquier momento. La versión vigente será siempre la publicada en esta página.',
          'Para dudas sobre estos Términos, escríbenos a gerencia@abogadosparada.com.',
        ],
      },
    ],
  },
  privacidad: {
    titulo: 'Política de Privacidad y Tratamiento de Datos',
    intro:
      'Esta Política describe cómo Parada Bridge trata los datos personales de sus usuarios, en cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013 de Colombia.',
    secciones: [
      {
        h: '1. Responsable del tratamiento',
        p: [
          'El responsable del tratamiento de los datos es Parada Bridge, con contacto en gerencia@abogadosparada.com y oficina en Carrera 66 #19-72, Bogotá D.C., Colombia.',
        ],
      },
      {
        h: '2. Datos que recolectamos',
        p: [
          'Recolectamos los datos que el usuario suministra al usar la plataforma: nombre, número de identificación (cédula), correo, teléfono y la descripción de su consulta.',
          'Con fines de seguridad y prevención de abuso podemos registrar datos técnicos como la dirección IP (de forma anonimizada mediante técnicas de hash) y la fecha de las interacciones.',
        ],
      },
      {
        h: '3. Finalidad del tratamiento',
        p: [
          'Usamos los datos para: conectar al usuario con el profesional adecuado, gestionar la consulta y el chat, enviar notificaciones sobre el servicio, moderar el contenido y mejorar la plataforma.',
          'El número de cédula se almacena de forma protegida (con técnicas de anonimización) y se usa únicamente para identificar y retomar consultas.',
        ],
      },
      {
        h: '4. Autorización',
        p: [
          'Al aceptar esta Política y suministrar sus datos, el usuario autoriza su tratamiento para las finalidades aquí descritas. Esta autorización es libre, previa, expresa e informada.',
        ],
      },
      {
        h: '5. Derechos del titular',
        p: [
          'El titular puede conocer, actualizar, rectificar y suprimir sus datos, así como revocar la autorización, escribiendo a gerencia@abogadosparada.com.',
          'Atenderemos las solicitudes en los plazos que establece la Ley 1581 de 2012.',
        ],
      },
      {
        h: '6. Seguridad y conservación',
        p: [
          'Aplicamos medidas técnicas y administrativas razonables para proteger los datos. Los conservamos mientras exista la relación con el usuario y durante los plazos legales aplicables.',
        ],
      },
      {
        h: '7. Terceros',
        p: [
          'Compartimos con el profesional seleccionado únicamente los datos necesarios para atender la consulta. Podemos usar proveedores de infraestructura (por ejemplo, servicios de correo y bases de datos) que actúan como encargados bajo nuestras instrucciones.',
        ],
      },
    ],
  },
}

export default function LegalPage({ doc = 'terminos' }) {
  const data = DOCS[doc] || DOCS.terminos

  useEffect(() => {
    document.title = `${data.titulo} · Parada Bridge`
    window.scrollTo(0, 0)
  }, [data.titulo])

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          <Link to="/" className={styles.back}>← Volver al inicio</Link>
          <p className={styles.brand}>Parada <span>Bridge</span></p>
          <h1 className={styles.title}>{data.titulo}</h1>
          <p className={styles.updated}>Última actualización: {HOY}</p>
        </div>
      </header>

      <main className={styles.content}>
        <p className={styles.aviso}>
          Documento de referencia. Su firma debe revisarlo y ajustarlo con asesoría legal
          antes de considerarlo definitivo.
        </p>

        <p className={styles.intro}>{data.intro}</p>

        {data.secciones.map((s) => (
          <section key={s.h} className={styles.seccion}>
            <h2 className={styles.h2}>{s.h}</h2>
            {s.p.map((par, i) => (
              <p key={i} className={styles.par}>{par}</p>
            ))}
          </section>
        ))}

        <div className={styles.footerNav}>
          {doc === 'terminos'
            ? <Link to="/privacidad" className={styles.crossLink}>Ver Política de Privacidad →</Link>
            : <Link to="/terminos" className={styles.crossLink}>Ver Términos y Condiciones →</Link>}
        </div>
      </main>
    </div>
  )
}
