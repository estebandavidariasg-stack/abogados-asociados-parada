/* ────────────────────────────────────────────────────────────────────────
   Correo al administrador para solicitudes de verificación.
   Reusa el estilo navy + gold de los demás correos del proyecto.
   Destinatario configurable por env ADMIN_NOTIFY_EMAIL (no hardcodeado).
──────────────────────────────────────────────────────────────────────── */

import nodemailer from 'nodemailer'
import { renderShell, emailButton, infoBox, em, C } from './emailTemplate.js'

export const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL || 'abogadosyasociados.parada@gmail.com'

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
})

// Etiqueta de campo dentro de la ficha de datos.
function campo(label, value) {
  return `<p style="margin:0 0 2px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;color:${C.muted};">${label}</p>
          <p style="margin:0;font-size:15px;color:${C.navy};font-weight:600;">${value}</p>`
}

function renderHtml({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  const datos = infoBox(
    `<div style="text-align:center;">
       ${campo('Cliente', nombreCliente)}
       <div style="height:14px;line-height:14px;font-size:0;">&nbsp;</div>
       ${campo('Consulta', area)}
     </div>`
  )
  const inner =
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:${C.body};text-align:center;">
       El profesional ${em(nombreAbogado)} solicita que revises una conversación con un cliente.
     </p>
     ${datos}
     <div style="text-align:center;margin:26px 0 0;">${emailButton('Ver conversación', ctaUrl)}</div>`
  return renderShell({
    subjectLine: 'Solicitud de revisión de proceso',
    preheader: `${nombreAbogado} solicita revisar una conversación.`,
    innerHtml: inner,
  })
}

export async function sendVerificationEmail({ nombreAbogado, nombreCliente, area, ctaUrl }) {
  await transporter.sendMail({
    from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
    to: ADMIN_NOTIFY_EMAIL,
    subject: `Solicitud de revisión: ${nombreCliente}`,
    html: renderHtml({ nombreAbogado, nombreCliente, area, ctaUrl }),
  })
}

// Aviso al profesional cuando el admin le reasigna una consulta inactiva.
export async function sendReassignEmail({ email, nombreAbogado, ctaUrl }) {
  const subjectLine = 'Te asignaron una consulta'
  const inner =
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${C.navy};">Estimado/a ${em(nombreAbogado)},</p>
     <p style="margin:0 0 26px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">
       El equipo administrativo te asignó una consulta que estaba pendiente para que la atiendas.
       Ingresa a tu panel para revisarla y darle respuesta lo antes posible.
     </p>
     <div style="text-align:center;">${emailButton('Ver la consulta', ctaUrl)}</div>`
  await transporter.sendMail({
    from: `"Abogados y Asociados Parada" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: subjectLine,
    html: renderShell({ subjectLine, preheader: 'Una consulta fue asignada a tu cuenta.', innerHtml: inner }),
  })
}
