/* ────────────────────────────────────────────────────────────────────────
   Plantilla de correo COMPARTIDA — tema claro, pensado para Gmail en modo
   light. Un único lugar para todos los correos a clientes y profesionales.

   Construcción email-safe:
   · layout con <table> (Outlook usa el motor de Word, flex/grid no es fiable)
   · estilos 100% inline + color sólido de respaldo bajo cada degradado
   · color-scheme light para evitar la inversión automática a oscuro
   · ghost-table MSO para ancho fijo en Outlook
   · tipografías de la marca (Cinzel título / Raleway cuerpo) con fallbacks
     serif/sans; Gmail no carga fuentes web, así que el título usa
     text-transform:uppercase para mantener el aire "grabado" con Georgia.

   El dorado de marca (#c9a84c) NO se usa como texto sobre fondo claro (da
   ~1.5:1, ilegible). Para texto dorado legible usamos #9a7a2c; el brillante
   queda para el fondo del botón, bordes y acentos.
──────────────────────────────────────────────────────────────────────── */

export const FONT_SERIF = "'Cinzel', Georgia, 'Times New Roman', serif"
export const FONT_SANS  = "'Raleway', -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif"

export const C = {
  navy:     '#0d2d5e',
  goldText: '#9a7a2c', // dorado legible sobre fondo claro
  gold:     '#c9a84c', // dorado brillante: solo fondos/bordes/acentos
  body:     '#41506b',
  muted:    '#5f6e8a',
}

// Énfasis dentro del cuerpo: navy en negrita (el dorado no contrasta sobre blanco).
export function em(text) {
  return `<strong style="color:${C.navy};font-weight:700;">${text}</strong>`
}

// Botón principal: degradado dorado con texto navy. Bulletproof (table + bgcolor).
export function emailButton(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
  <tr>
    <td align="center" bgcolor="${C.gold}" style="border-radius:10px;background-color:${C.gold};background:linear-gradient(135deg,#e8c96a 0%,#c9a84c 55%,#a9842f 100%);box-shadow:0 6px 16px rgba(201,168,76,0.35);">
      <a href="${url}" target="_blank" style="display:inline-block;padding:15px 40px;font-family:${FONT_SANS};font-size:14px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.navy};border-radius:10px;">${label}</a>
    </td>
  </tr>
</table>`
}

// Caja informativa de respaldo (enlace, datos, referencia).
export function infoBox(innerHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">
  <tr>
    <td style="background-color:#f4f8fd;border:1px solid #dbe6f4;border-radius:12px;padding:18px 20px;font-family:${FONT_SANS};">
      ${innerHtml}
    </td>
  </tr>
</table>`
}

// Caja del código OTP (6 dígitos): navy grande sobre fondo claro, borde dorado.
export function codeBox(code) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
  <tr>
    <td align="center" style="background-color:#f1f6fc;border:2px solid ${C.gold};border-radius:12px;padding:22px 16px;">
      <div style="font-family:${FONT_SERIF};font-size:40px;font-weight:700;color:${C.navy};letter-spacing:12px;line-height:1;">${code}</div>
    </td>
  </tr>
</table>`
}

/* ── Shell: tarjeta blanca con header (degradado azul claro + título navy/oro),
   slot de cuerpo y pie. `innerHtml` controla la alineación de su contenido. */
export function renderShell({ subjectLine, preheader, innerHtml }) {
  const pre = preheader || subjectLine || 'Abogados y Asociados Parada'
  return `<!DOCTYPE html>
<html lang="es" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${subjectLine}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Raleway:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
    a { text-decoration:none; }
    @media (max-width:620px) {
      .aap-container { width:100% !important; border-radius:0 !important; }
      .aap-pad { padding-left:24px !important; padding-right:24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#eef4fb;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${pre}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef4fb;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" class="aap-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e1e9f4;box-shadow:0 6px 24px rgba(13,45,94,0.08);">

          <!-- Encabezado: degradado azul claro -> blanco -->
          <tr>
            <td align="center" bgcolor="#d8e6f7" style="background-color:#d8e6f7;background:linear-gradient(180deg,#d4e4f7 0%,#e9f1fc 58%,#ffffff 100%);padding:38px 32px 30px;">
              <div style="font-family:${FONT_SERIF};font-size:21px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:${C.navy};line-height:1.35;">
                Abogados y Asociados <span style="color:${C.goldText};">Parada</span>
              </div>
              <div style="width:54px;height:3px;margin:14px auto 0;background-color:${C.gold};background:linear-gradient(90deg,rgba(201,168,76,0),#c9a84c,rgba(201,168,76,0));line-height:3px;font-size:0;">&nbsp;</div>
              <div style="font-family:${FONT_SANS};font-size:13px;color:${C.body};margin-top:14px;letter-spacing:0.02em;">
                ${subjectLine}
              </div>
            </td>
          </tr>

          <!-- Cuerpo -->
          <tr>
            <td class="aap-pad" style="padding:34px 40px 36px;font-family:${FONT_SANS};color:${C.body};font-size:15px;line-height:1.75;">
              ${innerHtml}
            </td>
          </tr>

          <!-- Divisor -->
          <tr><td class="aap-pad" style="padding:0 40px;"><div style="border-top:1px solid #e6edf6;font-size:0;line-height:0;">&nbsp;</div></td></tr>

          <!-- Pie -->
          <tr>
            <td align="center" class="aap-pad" style="padding:22px 40px 30px;font-family:${FONT_SANS};">
              <div style="font-size:11.5px;line-height:1.7;color:${C.muted};">
                Mensaje automático de Abogados y Asociados Parada. Por favor, no respondas a este correo.
              </div>
              <div style="font-size:11.5px;line-height:1.7;margin-top:6px;">
                <a href="https://abogadosparada.com" target="_blank" style="color:${C.goldText};font-weight:600;">abogadosparada.com</a>
              </div>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`
}

/* ── Conveniencia para el correo estándar (saludo + párrafo justificado +
   botón). Usado por notify.js (nueva consulta / abogado se unió / inactividad). */
export function renderEmailHtml({ subjectLine, greetingHtml, bodyHtml, ctaLabel, ctaUrl, preheader }) {
  const inner =
    `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:${C.navy};">${greetingHtml}</p>
     <div style="margin:0 0 30px;font-size:15px;line-height:1.75;color:${C.body};text-align:justify;">${bodyHtml}</div>
     <div style="text-align:center;">${emailButton(ctaLabel, ctaUrl)}</div>`
  return renderShell({ subjectLine, preheader, innerHtml: inner })
}
