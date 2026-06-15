// Genera previsualizaciones HTML de TODOS los correos (tema claro compartido)
// para inspección visual. No envía nada. Uso: node scripts/preview-email.mjs
import { writeFileSync } from 'node:fs'
import {
  renderEmailHtml, renderShell, emailButton, infoBox, codeBox, em, C, FONT_SERIF,
} from '../api/_lib/emailTemplate.js'

// 1. Notificación a profesional (nueva consulta)
const abogado = renderEmailHtml({
  subjectLine: 'Nueva consulta pendiente: Derecho Comercial',
  greetingHtml: `Estimado/a ${em('Esteban Arias')},`,
  bodyHtml: `Tienes una nueva consulta pendiente por parte de ${em('Juan Molina')} en el área de ${em('Derecho Comercial, Derecho Administrativo, Derecho Migratorio')}. Ingresa a la plataforma para atenderla a la brevedad posible.`,
  ctaLabel: 'Ver consulta',
  ctaUrl: 'https://abogadosparada.com/?loginModal=true',
})

// 1b. Notificación de inactividad (al profesional)
const inactividad = renderEmailHtml({
  subjectLine: 'Consulta sin atender: acción requerida',
  greetingHtml: `Estimado/a ${em('Esteban Arias')},`,
  bodyHtml: `Tienes una consulta de ${em('Juan Molina')} en el área de ${em('Derecho Comercial')} (abierta el 12 de junio de 2026) sin actividad por más de 24 horas. El equipo administrativo te solicita ingresar a la plataforma y dar respuesta lo antes posible. Si la consulta ya no requiere tu atención, márcala como cerrada.`,
  ctaLabel: 'Atender consulta',
  ctaUrl: 'https://abogadosparada.com/?loginModal=true',
})

// 1c. Cuenta aprobada (al profesional)
const aprobado = renderEmailHtml({
  subjectLine: 'Tu cuenta fue aprobada',
  greetingHtml: `Estimado/a ${em('Esteban Arias')},`,
  bodyHtml: `Tu cuenta como ${em('abogado')} en Abogados y Asociados Parada ya fue aprobada. Desde ahora apareces en la plataforma y los clientes pueden encontrarte y escribirte. Ingresa para completar tu perfil y empezar a atender consultas.`,
  ctaLabel: 'Ingresar a mi cuenta',
  ctaUrl: 'https://abogadosparada.com/?loginModal=true',
})

// 1d. Solicitud no aprobada (al profesional)
const rechazado = renderEmailHtml({
  subjectLine: 'Sobre tu solicitud de registro',
  greetingHtml: `Estimado/a ${em('Esteban Arias')},`,
  bodyHtml: `Revisamos tu solicitud de registro como ${em('abogado')} en Abogados y Asociados Parada y, por ahora, no fue aprobada. Si consideras que se trata de un error o deseas enviar información adicional, puedes escribirnos por los canales oficiales que encuentras en nuestro sitio.`,
  ctaLabel: 'Visitar el sitio',
  ctaUrl: 'https://abogadosparada.com',
})

// 1e. Reasignación (al abogado nuevo)
const reasignado = renderShell({
  subjectLine: 'Te asignaron una consulta',
  innerHtml:
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${C.navy};">Estimado/a ${em('Esteban Arias')},</p>
     <p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">El equipo administrativo te asignó una consulta que estaba pendiente para que la atiendas. Ingresa a tu panel para revisarla y darle respuesta lo antes posible.</p>
     <div style="text-align:center;">${emailButton('Ver la consulta', 'https://abogadosparada.com/?loginModal=true')}</div>`,
})

// 1f. PQR (al admin)
const campoP = (label, value) =>
  `<p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${label}</p>
   <p style="margin:0 0 12px;font-size:14px;color:${C.navy};font-weight:600;">${value}</p>`
const pqr = renderShell({
  subjectLine: 'Nueva PQR: Reclamo',
  innerHtml:
    `<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">Un cliente envió un <strong style="color:#0d2d5e;font-weight:700;">reclamo</strong> desde la plataforma.</p>
     ${infoBox(`${campoP('Cliente', 'María Gómez')}${campoP('Correo', 'maria@example.com')}${campoP('Referencia', 'AAP-7F3K9Q')}<p style="margin:6px 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">Mensaje</p><p style="margin:0;font-size:14px;line-height:1.6;color:${C.body};white-space:pre-wrap;">El abogado no respondió mi consulta en el tiempo prometido y necesito una solución pronto.</p>`)}
     <div style="text-align:center;margin:26px 0 0;">${emailButton('Ver en el panel', 'https://abogadosparada.com/admin')}</div>`,
})

// 2. Verificación de cuenta (OTP)
const otp = renderShell({
  subjectLine: 'Verificación de cuenta',
  innerHtml:
    `<p style="margin:0;font-size:16px;line-height:1.6;color:${C.navy};text-align:center;">Para completar tu registro como ${em('Abogado')}, ingresa este código:</p>
     ${codeBox('428913')}
     <p style="margin:0;text-align:center;font-size:13px;color:${C.body};">Este código expira en 10 minutos.</p>
     <p style="margin:10px 0 0;text-align:center;font-size:12px;color:${C.muted};">Si no solicitaste este registro, ignora este correo.</p>`,
})

// 3. Restablecer contraseña
const link = 'https://abogadosparada.com/nueva-contrasena?token=abc123def456ghi789'
const reset = renderShell({
  subjectLine: 'Restablecer contraseña',
  innerHtml:
    `<p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">Recibimos una solicitud para restablecer la contraseña de tu cuenta. Si fuiste tú, usa el botón para crear una nueva contraseña.</p>
     <div style="text-align:center;margin:0 0 26px;">${emailButton('Restablecer contraseña', link)}</div>
     ${infoBox(`<p style="margin:0;color:${C.muted};font-size:12px;line-height:1.6;">Si el botón no funciona, copia y pega este enlace en tu navegador:</p><p style="margin:8px 0 0;word-break:break-all;"><a href="${link}" style="color:${C.navy};font-size:12px;text-decoration:underline;">${link}</a></p>`)}
     <p style="margin:22px 0 0;font-size:13px;line-height:1.65;color:${C.body};">El enlace expira en ${em('1 hora')}. Si no solicitaste este cambio, puedes ignorar este correo; tu contraseña actual seguirá funcionando.</p>`,
})

// 4. Ficha de contacto
const contacto = renderShell({
  subjectLine: 'Ficha de contacto',
  innerHtml:
    `<p style="margin:0 0 22px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">Estos son los datos de contacto de tu abogado:</p>
     ${infoBox(
       `<div style="text-align:center;"><div style="font-family:${FONT_SERIF};font-size:20px;font-weight:700;color:${C.navy};margin-bottom:12px;">Esteban Arias</div>
        <a href="mailto:esteban@example.com" style="color:${C.navy};font-size:14px;text-decoration:underline;display:block;margin-bottom:18px;">esteban@example.com</a>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;"><tr><td align="center" bgcolor="#128C4B" style="border-radius:8px;background-color:#128C4B;"><a href="https://wa.me/573124086734" style="display:inline-block;padding:12px 26px;font-size:14px;font-weight:700;color:#ffffff;border-radius:8px;">Escribir por WhatsApp</a></td></tr></table></div>`
     )}
     <p style="margin:18px 0 0;text-align:center;font-size:12px;color:${C.muted};">Ref. consulta: AAP-7F3K9Q</p>`,
})

// 5. Notificación al admin (solicitud de revisión)
const campo = (label, value) =>
  `<p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${label}</p>
   <p style="margin:0;font-size:15px;color:${C.navy};font-weight:600;">${value}</p>`
const admin = renderShell({
  subjectLine: 'Solicitud de revisión de proceso',
  innerHtml:
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">El profesional ${em('Juan Molina')} solicita que revises una conversación con un cliente.</p>
     ${infoBox(`<div style="text-align:center;">${campo('Cliente', 'María Gómez')}<div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>${campo('Consulta', 'Derecho Laboral')}</div>`)}
     <div style="text-align:center;margin:26px 0 0;">${emailButton('Ver conversación', 'https://abogadosparada.com/admin?tab=chats')}</div>`,
})

writeFileSync('.preview-email-rechazado.html', rechazado)
writeFileSync('.preview-email-reasignado.html', reasignado)
writeFileSync('.preview-email-pqr.html', pqr)
writeFileSync('.preview-email-abogado.html', abogado)
writeFileSync('.preview-email-aprobado.html', aprobado)
writeFileSync('.preview-email-inactividad.html', inactividad)
writeFileSync('.preview-email-otp.html', otp)
writeFileSync('.preview-email-reset.html', reset)
writeFileSync('.preview-email-contacto.html', contacto)
writeFileSync('.preview-email-admin.html', admin)
console.log('OK: abogado, otp, reset, contacto, admin')
