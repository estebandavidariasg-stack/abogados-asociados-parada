
import { useState, useEffect, useRef } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { supabase } from '../../lib/supabase'
import styles from './ChatSection.module.css'
import AudioPlayer from './AudioPlayer'
import TriagePanel from './TriagePanel'
import { ChatImage, ChatLightbox, openChatFile } from '../../lib/chatFiles'
import UbicacionSelector from '../profile/UbicacionSelector'
import { IconPaperclip, IconMic } from '../shared/Icons'
import { validarCelular, validarCorreo, normalizarCelular, contieneContacto } from '../../lib/validaciones'

// Detecta si el archivo es imagen para renderizar preview inline (WhatsApp style).
function isImage(name) {
  return /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(name || '')
}


const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

// ─────────────────────────────────────────────────────────────────────────
// Card design system — scoped to ChatSection.
// Hover states require CSS rules (can't be expressed via inline styles
// without adding state), so we ship a single <style> block alongside the
// cards. Tokens align with the brand palette already declared in the CSS
// module (--ivory / --navy / --gold).
// ─────────────────────────────────────────────────────────────────────────
const AAP_CARD_STYLES = `
  /* ─── Reset/common ────────────────────────────────────────── */
  .aap-card-feature,
  .aap-card-cedula,
  .aap-card-form,
  .aap-card-rating,
  .aap-card-pqr,
  .aap-card-tipo,
  .aap-card-lawyer {
    box-sizing: border-box;
    position: relative;
  }

  /* ─── Keyframes ───────────────────────────────────────────── */
  @keyframes aap-fade-up {
    from { opacity: 0; transform: translateY(18px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  /* aap-float eliminado — framer-motion gestiona el float de las cards */

  /* Major panels: gold accent bar at the top edge */
  .aap-card-cedula,
  .aap-card-form,
  .aap-card-rating { overflow: hidden; }
  .aap-card-cedula::before,
  .aap-card-form::before,
  .aap-card-rating::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 3px;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(201, 168, 76, 0.55) 18%,
      rgba(201, 168, 76, 0.95) 50%,
      rgba(201, 168, 76, 0.55) 82%,
      transparent 100%
    );
    pointer-events: none;
  }

  /* ─── Side feature cards — navy + gold, dramatically scattered ─ */
  .aap-card-feature {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 255, 255, 0.07) 0%, transparent 60%),
      linear-gradient(165deg, #15376b 0%, #0d2d5e 50%, #081f44 100%);
    border: 1px solid rgba(201, 168, 76, 0.38);
    border-radius: 18px;
    padding: 32px 18px 26px;
    overflow: visible;
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.22),
      0 12px 28px rgba(13, 45, 94, 0.30),
      0 30px 60px rgba(13, 45, 94, 0.32),
      0 0 0 1px rgba(201, 168, 76, 0.14),
      0 0 42px rgba(201, 168, 76, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.10);
    transition:
      box-shadow 380ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 380ms ease,
      filter 380ms ease;
  }
  .aap-card-feature:hover {
    z-index: 4;
    filter: brightness(1.1) saturate(1.12);
    border-color: rgba(201, 168, 76, 0.85);
    box-shadow:
      0 2px 4px rgba(0, 0, 0, 0.30),
      0 24px 48px rgba(13, 45, 94, 0.40),
      0 56px 110px rgba(13, 45, 94, 0.45),
      0 0 0 5px rgba(201, 168, 76, 0.20),
      0 0 70px rgba(201, 168, 76, 0.34),
      inset 0 1px 0 rgba(255, 255, 255, 0.18);
  }

  /* Posicionamiento estático — framer-motion gestiona x/y/rotate en el componente */
  .aap-card-feature[data-side]:first-child       { margin-top: -160px; }
  .aap-card-feature[data-side]:not(:last-child)  { margin-bottom: 30px; }

  /* Icon container — gold gradient chip, navy strokes, outer glow ring */
  .aap-card-feature > div:first-child {
    width: 66px;
    height: 66px;
    border-radius: 18px;
    background: linear-gradient(145deg, #f2d580 0%, #c9a84c 50%, #9a7a2c 100%);
    border: 1px solid rgba(255, 255, 255, 0.25);
    box-shadow:
      0 0 0 3px rgba(201, 168, 76, 0.18),
      0 4px 16px rgba(201, 168, 76, 0.45),
      inset 0 1px 0 rgba(255, 255, 255, 0.65),
      inset 0 -1px 0 rgba(0, 0, 0, 0.18);
    color: #0d2d5e;
    margin: 0 auto 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .aap-card-feature > div:first-child svg {
    width: 30px;
    height: 30px;
    stroke-width: 1.8;
  }
  /* Title — white, Cinzel inherited */
  .aap-card-feature h4 {
    font-size: 0.84rem;
    letter-spacing: 0.14em;
    line-height: 1.3;
    color: #ffffff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    margin: 0;
    text-align: center;
  }
  .aap-card-feature h4::after {
    content: '';
    display: block;
    margin: 10px auto 12px;
    width: 34px;
    height: 2px;
    background: linear-gradient(
      90deg,
      rgba(201, 168, 76, 0.25),
      rgba(232, 196, 110, 1.0),
      rgba(201, 168, 76, 0.25)
    );
    border-radius: 2px;
    box-shadow: 0 0 10px rgba(201, 168, 76, 0.45);
  }
  .aap-card-feature p {
    font-size: 0.76rem;
    line-height: 1.7;
    color: rgba(255, 255, 255, 0.78);
    margin: 0;
  }

  /* ─── Major panels: cedula, form, rating ──────────────────── */
  .aap-card-cedula,
  .aap-card-form,
  .aap-card-rating {
    background: linear-gradient(180deg, #ffffff 0%, #fbf9ef 100%);
    border: 1px solid rgba(13, 45, 94, 0.10);
    border-radius: 18px;
    padding: 40px 36px 32px;
    box-shadow:
      0 1px 3px rgba(13, 45, 94, 0.05),
      0 12px 28px rgba(13, 45, 94, 0.08),
      0 28px 64px rgba(13, 45, 94, 0.10),
      inset 0 1px 0 rgba(255, 255, 255, 0.9);
    transition:
      box-shadow 360ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 360ms ease;
    animation: aap-fade-up 560ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  .aap-card-cedula:hover,
  .aap-card-rating:hover {
    border-color: rgba(13, 45, 94, 0.16);
    box-shadow:
      0 2px 4px rgba(13, 45, 94, 0.06),
      0 16px 36px rgba(13, 45, 94, 0.10),
      0 36px 72px rgba(13, 45, 94, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.95);
  }
  /* Title — centered, larger, with centered gold rule beneath */
  .aap-card-cedula > p:first-of-type,
  .aap-card-rating > p:first-of-type {
    font-size: 1.45rem;
    letter-spacing: 0.05em;
    color: #0d2d5e;
    margin: 0;
    text-align: center;
  }
  .aap-card-cedula > p:first-of-type::after,
  .aap-card-rating > p:first-of-type::after {
    content: '';
    display: block;
    margin: 14px auto 18px;
    width: 56px;
    height: 2px;
    background: linear-gradient(
      90deg,
      rgba(201, 168, 76, 0.25),
      rgba(201, 168, 76, 0.95),
      rgba(201, 168, 76, 0.25)
    );
    border-radius: 2px;
  }
  /* Hint paragraph below the title — also centered */
  .aap-card-cedula > p:nth-of-type(2),
  .aap-card-rating > p:nth-of-type(2) {
    font-size: 0.95rem;
    color: #3d4a60;
    line-height: 1.65;
    margin: 0 0 28px;
    text-align: center;
  }

  /* ─── Tipo selector (Abogado / Contador) ──────────────────── */
  .aap-card-tipo {
    background: linear-gradient(180deg, #ffffff 0%, #fafaf2 100%);
    border: 1px solid rgba(13, 45, 94, 0.10);
    border-radius: 14px;
    padding: 24px 18px;
    overflow: hidden;
    box-shadow:
      0 1px 2px rgba(13, 45, 94, 0.05),
      0 4px 12px rgba(13, 45, 94, 0.07);
    transition:
      transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 240ms ease,
      box-shadow 240ms ease,
      background 240ms ease;
    cursor: pointer;
    animation: aap-fade-up 420ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  .aap-card-tipo:nth-child(1) { animation-delay: 60ms; }
  .aap-card-tipo:nth-child(2) { animation-delay: 140ms; }
  .aap-card-tipo:hover {
    transform: translateY(-3px);
    border-color: rgba(201, 168, 76, 0.45);
    box-shadow:
      0 2px 6px rgba(13, 45, 94, 0.08),
      0 14px 30px rgba(13, 45, 94, 0.12);
  }
  .aap-card-tipo[data-selected="true"] {
    background: linear-gradient(180deg, rgba(201, 168, 76, 0.14) 0%, rgba(201, 168, 76, 0.03) 100%);
    border-color: rgba(201, 168, 76, 0.70);
    box-shadow:
      0 2px 6px rgba(13, 45, 94, 0.06),
      0 14px 36px rgba(201, 168, 76, 0.24),
      inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }
  .aap-card-tipo[data-selected="true"]::before {
    content: '';
    position: absolute;
    top: 0;
    left: 14%;
    right: 14%;
    height: 3px;
    background: linear-gradient(90deg, transparent, rgba(201, 168, 76, 1), transparent);
    border-radius: 0 0 2px 2px;
  }
  .aap-card-tipo[data-selected="true"]:hover {
    transform: translateY(-3px);
    border-color: rgba(201, 168, 76, 0.85);
    box-shadow:
      0 2px 8px rgba(13, 45, 94, 0.08),
      0 16px 40px rgba(201, 168, 76, 0.30);
  }

  /* ─── Lawyer / Contador list cards ────────────────────────── */
  .aap-card-lawyer {
    background: linear-gradient(180deg, #ffffff 0%, #fcfbf4 100%);
    border: 1px solid rgba(13, 45, 94, 0.09);
    border-radius: 14px;
    padding: 18px 20px;
    box-shadow:
      0 1px 2px rgba(13, 45, 94, 0.04),
      0 4px 10px rgba(13, 45, 94, 0.06);
    transition:
      transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 220ms ease,
      box-shadow 220ms ease,
      background 220ms ease;
    cursor: pointer;
    animation: aap-fade-up 380ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  /* Cascading entrance for lists of professionals */
  .aap-card-lawyer:nth-child(1) { animation-delay: 0ms; }
  .aap-card-lawyer:nth-child(2) { animation-delay: 60ms; }
  .aap-card-lawyer:nth-child(3) { animation-delay: 120ms; }
  .aap-card-lawyer:nth-child(4) { animation-delay: 180ms; }
  .aap-card-lawyer:nth-child(5) { animation-delay: 240ms; }
  .aap-card-lawyer:nth-child(n+6) { animation-delay: 300ms; }
  .aap-card-lawyer:hover {
    transform: translateY(-2px);
    border-color: rgba(201, 168, 76, 0.38);
    box-shadow:
      0 2px 4px rgba(13, 45, 94, 0.05),
      0 12px 28px rgba(13, 45, 94, 0.12);
  }
  .aap-card-lawyer[data-selected="true"] {
    background: linear-gradient(180deg, rgba(201, 168, 76, 0.10) 0%, rgba(201, 168, 76, 0.02) 100%);
    border-color: rgba(201, 168, 76, 0.65);
    box-shadow:
      0 2px 4px rgba(13, 45, 94, 0.05),
      0 10px 24px rgba(201, 168, 76, 0.20);
  }
  .aap-card-lawyer[data-selected="true"]:hover {
    transform: translateY(-2px);
    border-color: rgba(201, 168, 76, 0.85);
    box-shadow:
      0 2px 6px rgba(13, 45, 94, 0.07),
      0 14px 32px rgba(201, 168, 76, 0.26);
  }
  /* Avatar — gold ring on hover/selected for a premium touch */
  .aap-card-lawyer img {
    box-shadow: 0 2px 8px rgba(13, 45, 94, 0.14);
    border: 2px solid #ffffff;
    outline: 1px solid rgba(13, 45, 94, 0.10);
    transition: outline-color 220ms ease, box-shadow 220ms ease;
  }
  .aap-card-lawyer:hover img {
    outline-color: rgba(201, 168, 76, 0.45);
  }
  .aap-card-lawyer[data-selected="true"] img {
    outline: 2px solid rgba(201, 168, 76, 0.70);
    box-shadow: 0 2px 12px rgba(201, 168, 76, 0.30);
  }

  /* ─── PQR feedback card ───────────────────────────────────── */
  .aap-card-pqr {
    background: linear-gradient(180deg, #ffffff 0%, #fbfaf3 100%);
    border: 1px solid rgba(13, 45, 94, 0.10);
    border-left: 4px solid rgba(201, 168, 76, 0.80);
    border-radius: 14px;
    padding: 26px 26px 24px;
    box-shadow:
      0 1px 3px rgba(13, 45, 94, 0.05),
      0 8px 22px rgba(13, 45, 94, 0.08);
    transition:
      box-shadow 280ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-color 280ms ease;
    animation: aap-fade-up 480ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
  }
  .aap-card-pqr:hover {
    border-left-color: rgba(201, 168, 76, 0.95);
    box-shadow:
      0 2px 4px rgba(13, 45, 94, 0.06),
      0 14px 30px rgba(13, 45, 94, 0.12);
  }

  /* ─── Tablets / narrow desktop — moderate the outward push so the
     side cards don't fall off the viewport on smaller screens ────── */
  @media (max-width: 1180px) {
    .aap-card-feature[data-side]:first-child { margin-top: -110px; }
    .aap-card-feature[data-side="left"]:nth-child(1)  { --aap-x: -28px; }
    .aap-card-feature[data-side="left"]:nth-child(2)  { --aap-x: -10px; }
    .aap-card-feature[data-side="left"]:nth-child(3)  { --aap-x: -22px; }
    .aap-card-feature[data-side="right"]:nth-child(1) { --aap-x: 28px;  }
    .aap-card-feature[data-side="right"]:nth-child(2) { --aap-x: 10px;  }
    .aap-card-feature[data-side="right"]:nth-child(3) { --aap-x: 22px;  }
  }
  @media (max-width: 900px) {
    .aap-card-feature[data-side]:first-child { margin-top: -60px; }
  }

  /* ─── Mobile ──────────────────────────────────────────────── */
  @media (max-width: 640px) {
    .aap-card-feature[data-side]:nth-child(n) {
      --aap-x: 0px; --aap-y: 0px; --aap-y-mid: -6px; --aap-r: 0deg;
    }
    .aap-card-feature {
      padding: 22px 14px 18px;
      border-radius: 16px;
    }
    .aap-card-feature > div:first-child {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      margin-bottom: 12px;
    }
    .aap-card-feature > div:first-child svg {
      width: 20px;
      height: 20px;
    }
    .aap-card-cedula,
    .aap-card-form,
    .aap-card-rating {
      padding: 28px 22px 24px;
      border-radius: 16px;
    }
    .aap-card-cedula > p:first-of-type,
    .aap-card-rating > p:first-of-type {
      font-size: 1.2rem;
    }
    .aap-card-pqr {
      padding: 22px 20px;
      border-radius: 12px;
    }
    .aap-card-tipo {
      padding: 20px 14px;
      border-radius: 12px;
    }
    .aap-card-lawyer {
      padding: 14px 16px;
      border-radius: 12px;
    }
  }

  /* ─── Respeta reduced-motion ─────────────────────────────── */
  @media (prefers-reduced-motion: reduce) {
    .aap-card-feature,
    .aap-card-cedula,
    .aap-card-form,
    .aap-card-rating,
    .aap-card-pqr,
    .aap-card-tipo,
    .aap-card-lawyer {
      animation: none !important;
      transition-duration: 0ms !important;
    }
  }
`

const AREAS_DERECHO = [
  'Derecho Civil', 'Derecho Penal', 'Derecho Laboral', 'Derecho Comercial',
  'Derecho de Familia', 'Derecho Administrativo', 'Derecho Tributario',
  'Derecho Migratorio', 'Derecho Corporativo', 'Derecho Constitucional',
  'Derecho Ambiental', 'Derecho Internacional', 'Derecho Inmobiliario',
  'Derecho de Tránsito', 'Derecho Disciplinario',
]

const AREAS_CONTADURIA = [
  'Contabilidad General', 'Auditoría', 'Tributaria y Fiscal',
  'Contabilidad Forense', 'Costos y Presupuestos', 'Revisoría Fiscal',
  'Finanzas Corporativas', 'Contabilidad Internacional (NIIF)',
  'Nómina y Seguridad Social',
  'Contabilidad Pública y Gubernamental',
  'Contabilidad Digital y Analítica de Datos',
  'Contabilidad de Sostenibilidad (ESG) y Sector Solidario',
  'Otro',
]

// La IA devuelve un área detallada (ej. "Derecho Laboral - Despido sin causa").
// La mapeamos a los chips canónicos para que el formulario muestre la selección
// correcta. Si no hay coincidencia, conserva el texto de la IA como única área.
function normalizarAreas(detectada, tipo) {
  const lista = tipo === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO
  const low = String(detectada || '').toLowerCase()
  const matches = lista.filter(a => low.includes(a.toLowerCase()))
  if (matches.length) return matches.slice(0, 3)
  return detectada ? [detectada] : []
}

// SVG inline para no depender de assets externos
const TIPO_OPTIONS = [
  {
    value: 'abogado',
    label: 'Abogado',
    descripcion: 'Asesoría jurídica',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
        <path d="M12 3v18M5 7h14"/>
        <path d="M3 13l2-6 2 6a3 3 0 1 1-4 0z"/>
        <path d="M17 13l2-6 2 6a3 3 0 1 1-4 0z"/>
        <path d="M7 21h10"/>
      </svg>
    ),
  },
  {
    value: 'contador',
    label: 'Contador',
    descripcion: 'Asesoría contable y fiscal',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="34" height="34">
        <rect x="5" y="3" width="14" height="18" rx="2"/>
        <rect x="8" y="6" width="8" height="3" rx="0.5"/>
        <circle cx="9"  cy="13" r="0.6" fill="currentColor"/>
        <circle cx="12" cy="13" r="0.6" fill="currentColor"/>
        <circle cx="15" cy="13" r="0.6" fill="currentColor"/>
        <circle cx="9"  cy="16" r="0.6" fill="currentColor"/>
        <circle cx="12" cy="16" r="0.6" fill="currentColor"/>
        <circle cx="15" cy="16" r="0.6" fill="currentColor"/>
        <circle cx="9"  cy="19" r="0.6" fill="currentColor"/>
        <circle cx="12" cy="19" r="0.6" fill="currentColor"/>
        <circle cx="15" cy="19" r="0.6" fill="currentColor"/>
      </svg>
    ),
  },
]

async function hashCedula(cedula) {
  const data = new TextEncoder().encode(cedula.trim())
  const buf  = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')
}

// ── Columnas no-PII de chat_rooms accesibles por el cliente anon ───────
// El rol `anon` en BD tiene REVOKE SELECT sobre las columnas con datos
// personales (client_email, client_celular, client_nombre). Esta lista
// debe coincidir con el GRANT SELECT (...) ON public.chat_rooms TO anon.
// Si agregas una columna nueva PÚBLICA, inclúyela aquí Y en el GRANT.
const ANON_ROOM_COLS =
  'id,area_derecho,status,codigo_referencia,tipo_profesional,created_at,updated_at,client_token,client_cedula'

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes/1024).toFixed(1)} KB`
  return `${(bytes/1048576).toFixed(1)} MB`
}

async function notificarAbogado({ lawyerId, nombreAbogado, nombreCliente, area }) {
  // Pasa lawyerId — el endpoint resolverá el email server-side con service
  // role. Antes mandábamos el email desde el front, lo que requería que el
  // browser descargara la lista de correos de todos los profesionales
  // aprobados (leak de datos personales).
  try {
    await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'new_consultation', data: { lawyerId, nombreAbogado, nombreCliente, area } }),
    })
  } catch (err) { console.error('Error notificando abogado:', err) }
}

const CARDS_LEFT = [
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>),
    title: 'Cifrado seguro',
    text: 'Tu información viaja protegida con encriptación de extremo a extremo.',
    xOffset: -64, yFloat: [0, -12, 0], rotate: -3.5,
    floatDuration: 4.8, floatDelay: 0, entranceDelay: 0,
  },
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>),
    title: 'Identidad anónima',
    text: 'Tu cédula se convierte en un código único. Nadie sabrá quién eres.',
    xOffset: -28, yFloat: [0, 11, 0], rotate: 2.5,
    floatDuration: 5.2, floatDelay: 0.3, entranceDelay: 0.1,
  },
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>),
    title: 'Cobertura nacional e internacional',
    text: 'Abogados en Colombia y en el exterior, listos para atender tu caso.',
    xOffset: -50, yFloat: [0, -14, 0], rotate: -1.5,
    floatDuration: 4.5, floatDelay: 0.6, entranceDelay: 0.2,
  },
]
const CARDS_RIGHT = [
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>),
    title: 'Especialistas verificados',
    text: 'Abogados y contadores con credenciales comprobadas en tu área.',
    xOffset: 64, yFloat: [0, -11, 0], rotate: 3.5,
    floatDuration: 5.0, floatDelay: 0.15, entranceDelay: 0.05,
  },
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>),
    title: 'Respuesta rápida',
    text: 'Recibe orientación legal en minutos desde cualquier dispositivo.',
    xOffset: 28, yFloat: [0, 13, 0], rotate: -2.5,
    floatDuration: 4.3, floatDelay: 0.45, entranceDelay: 0.15,
  },
  {
    icon: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>),
    title: 'Atención oportuna',
    text: 'Un profesional disponible toma tu caso lo antes posible.',
    xOffset: 50, yFloat: [0, -15, 0], rotate: 1.5,
    floatDuration: 5.4, floatDelay: 0.75, entranceDelay: 0.25,
  },
]

const FM_EASE = [0.16, 1, 0.3, 1]

function FeatureCardItem({ card, side, triggered, live, prefersReduced }) {
  const xStart = (side === 'left' ? -90 : 90) + card.xOffset
  // Los bucles (flotar + halo) solo corren cuando la tarjeta ya entró Y sigue
  // visible. Fuera de viewport se apagan para no repintar/componer en vano.
  const floating = triggered && live && !prefersReduced

  return (
    <motion.div
      className={`${styles.featureCard} aap-card-feature`}
      data-side={side}
      initial={{ opacity: 0, x: xStart, rotate: card.rotate }}
      animate={triggered ? {
        opacity: 1,
        x: card.xOffset,
        rotate: card.rotate,
        y: floating ? card.yFloat : 0,
      } : {
        opacity: 0,
        x: xStart,
        rotate: card.rotate,
      }}
      transition={{
        opacity: { duration: 0.72, ease: FM_EASE, delay: card.entranceDelay },
        x:       { duration: 0.88, ease: FM_EASE, delay: card.entranceDelay },
        rotate:  { duration: 0 },
        y: floating ? {
          duration: card.floatDuration,
          repeat: Infinity,
          ease: 'easeInOut',
          delay: card.entranceDelay + 0.9,
          times: [0, 0.5, 1],
        } : { duration: 0.6, ease: 'easeOut' },
      }}
      whileHover={prefersReduced ? {} : {
        scale: 1.07,
        transition: { type: 'spring', stiffness: 260, damping: 18 },
      }}
    >
      {/* Icon chip — halo dorado "respirando". Animamos opacity/scale de una
          capa compuesta (GPU); antes se animaba box-shadow, que repinta cada
          frame en el hilo principal y trababa el scroll. */}
      <div className={styles.cardIconWrap}>
        <motion.span
          className={styles.cardIconGlow}
          aria-hidden="true"
          animate={floating
            ? { opacity: [0.35, 0.85, 0.35], scale: [1, 1.14, 1] }
            : { opacity: prefersReduced ? 0.5 : 0.45, scale: 1 }}
          transition={floating ? {
            duration: 2.6,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: card.entranceDelay + 1.4,
          } : { duration: 0.4 }}
        />
        {card.icon}
      </div>
      <h4 className={styles.cardTitle}>{card.title}</h4>
      <p className={styles.cardText}>{card.text}</p>
    </motion.div>
  )
}

function SideCards({ cards, side }) {
  const ref = useRef(null)
  // Entrada: una sola vez. `live`: visibilidad en vivo que apaga los bucles
  // cuando la sección sale de pantalla (clave para que no trabe el scroll).
  const entered = useInView(ref, { once: true, amount: 0.25 })
  const live = useInView(ref, { amount: 0 })
  const prefersReduced = useReducedMotion()

  return (
    <div ref={ref} className={styles.sideCards}>
      {cards.map((card) => (
        <FeatureCardItem
          key={card.title}
          card={card}
          side={side}
          triggered={entered}
          live={live}
          prefersReduced={prefersReduced}
        />
      ))}
    </div>
  )
}

function StarRating({ value, onChange }) {
  const [hovered, setHovered] = useState(0)
  return (
    <div style={{ display:'flex', gap:8 }}>
      {[1,2,3,4,5].map(star => (
        <span key={star} onClick={() => onChange(star)}
          onMouseEnter={() => setHovered(star)} onMouseLeave={() => setHovered(0)}
          style={{ fontSize:'2.4rem', cursor:'pointer',
            color: star <= (hovered||value) ? 'var(--gold)' : '#2a2a2a',
            transition:'color 0.15s, transform 0.1s',
            transform: star <= (hovered||value) ? 'scale(1.15)' : 'scale(1)',
            lineHeight:1, userSelect:'none' }}>★</span>
      ))}
    </div>
  )
}

function RatingPanel({ roomId, onDone }) {
  const [lawyers, setLawyers]       = useState([])
  const [ratings, setRatings]       = useState({})
  const [comentario, setComentario] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]   = useState(false)

  useEffect(() => {
    async function load() {
      const { data: assignments } = await supabase.from('chat_room_lawyers').select('lawyer_id').eq('room_id', roomId)
      if (!assignments) return
      const profiles = []
      for (const { lawyer_id } of assignments) {
        const { data: p } = await supabase.from('profiles').select('id, nombre, apellido, foto_url').eq('id', lawyer_id).single()
        if (p) profiles.push(p)
      }
      setLawyers(profiles)
    }
    load()
  }, [roomId])

  async function handleSubmit() {
    setSubmitting(true)
    for (const [lawyer_id, rating] of Object.entries(ratings)) {
      await supabase.from('chat_ratings').insert({ room_id: roomId, lawyer_id, rating, comentario: comentario.trim() || null })
    }
    setSubmitted(true)
    setTimeout(onDone, 2000)
    setSubmitting(false)
  }

  if (submitted) return (
    <div className={`${styles.ratingCard} aap-card-rating`}>
      <p className={styles.ratingTitle}>¡Gracias por tu calificación!</p>
      <p className={styles.ratingSubtitle}>Redirigiendo…</p>
    </div>
  )

  return (
    <div className={`${styles.ratingCard} aap-card-rating`}>
      <p className={styles.ratingTitle}>¿Cómo fue tu experiencia?</p>
      <p className={styles.ratingSubtitle}>Califica el servicio de los abogados que te atendieron.</p>
      <div style={{ display:'flex', flexDirection:'column', gap:24, margin:'28px 0' }}>
        {lawyers.length === 0 && (
          <div style={{ textAlign:'center' }}>
            <p style={{ color:'#666', fontSize:'0.8rem', marginBottom:12 }}>Calificación general</p>
            <div style={{ display:'flex', justifyContent:'center' }}>
              <StarRating value={ratings['general']||0} onChange={v => setRatings({ general: v })} />
            </div>
          </div>
        )}
        {lawyers.map(l => {
          const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
          return (
            <div key={l.id}>
              <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:10 }}>
                <img
                  src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`}
                  alt={nombre}
                  width="40"
                  height="40"
                  loading="lazy"
                  decoding="async"
                  style={{ width:40, height:40, borderRadius:'50%', objectFit:'cover', flexShrink:0 }}
                />
                <p style={{ color:'#ccc', fontWeight:600, fontSize:'0.9rem', margin:0 }}>{nombre}</p>
              </div>
              <StarRating value={ratings[l.id]||0} onChange={v => setRatings(r => ({ ...r, [l.id]: v }))} />
            </div>
          )
        })}
      </div>
      <div style={{ marginBottom:20, display:'flex', flexDirection:'column', gap:10 }}>
        <label className={styles.label}>Comentario opcional</label>
        <textarea className={styles.textarea} value={comentario}
          onChange={e => setComentario(e.target.value)}
          placeholder="¿Algo que quieras compartir sobre la atención?" rows={3} />
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <button className={styles.btnGold} style={{ flex:1 }} onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Enviando…' : 'Enviar calificación'}
        </button>
        <button className={styles.btnOutline} onClick={onDone}>Omitir</button>
      </div>
    </div>
  )
}

function StepCedula({ onNew, onResume }) {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const codigoURL = urlParams.get('codigo') || ''
  const [cedula, setCedula] = useState('')
  const [codigo, setCodigo] = useState(codigoURL)
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit() {
    const rawCedula = cedula.trim()
    if (!/^\d{6,12}$/.test(rawCedula)) { setError('Ingresa un número de cédula válido (6–12 dígitos).'); return }
    setLoading(true); setError('')
    const hash = await hashCedula(rawCedula)
    localStorage.setItem('chat_cedula_hash', hash)
    if (codigo.trim()) localStorage.setItem('chat_codigo_ref', codigo.trim().toUpperCase())
    else localStorage.removeItem('chat_codigo_ref')
    const { data: rooms } = await supabase.from('chat_rooms').select(ANON_ROOM_COLS).eq('client_cedula', hash).order('created_at', { ascending: false })
    const existing = rooms?.find(r => r.status === 'waiting' || r.status === 'active')
    if (existing) onResume(existing)
    else onNew()
    setLoading(false)
  }

  return (
    <div className={`${styles.card} aap-card-cedula`}>
      <p className={styles.cedulaTitle}>Identificación</p>
      <p className={styles.cedulaHint}>Ingresa tu cédula para iniciar o retomar una consulta.</p>
      <div className={styles.field} style={{ marginBottom:16 }}>
        <label className={styles.label}>Número de cédula <span className={styles.required}>*</span></label>
        <input className={styles.input} value={cedula}
          onChange={e => { setCedula(e.target.value.replace(/\D/g,'')); setError('') }}
          onKeyDown={e => e.key==='Enter' && handleSubmit()} placeholder="Ej: 1234567890" maxLength={12} />
      </div>
      <div className={styles.field}>
        <label className={styles.label}>
          Código de referencia
          <span style={{ color:'rgba(13,45,94,0.45)', fontWeight:400, marginLeft:8 }}>(opcional)</span>
        </label>
        <input className={styles.input} value={codigo}
          onChange={e => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g,''))}
          onKeyDown={e => e.key==='Enter' && handleSubmit()}
          placeholder="Ej: AAP-A3KX72" maxLength={10} style={{ letterSpacing:'2px', fontWeight:600 }} />
        <p style={{ fontSize:'0.75rem', color:'rgba(13,45,94,0.55)', marginTop:8, marginBottom:0 }}>
          Si un asesor te dio un código, ingrésalo aquí.
        </p>
      </div>
      {error && <p className={styles.formError} style={{ marginTop:8 }}>{error}</p>}
      <button className={styles.btnGold} style={{ marginTop:20, width:'100%' }}
        onClick={handleSubmit} disabled={loading || !cedula}>
        {loading ? 'Verificando…' : 'Continuar'}
      </button>
    </div>
  )
}

export default function ChatSection() {
  const [step, setStep]         = useState('cedula')
  const [triageResumen, setTriageResumen] = useState('')   // resumen de la IA → primer mensaje de la sala
  const [solicitudAbierta, setSolicitudAbierta] = useState(false) // flujo "publicar" (no hay profesional del área)
  const [areasBloqueadas, setAreasBloqueadas] = useState(false)   // área pre-detectada por la IA → no editable
  const prefersReducedMotion = useReducedMotion()
  const [form, setForm]         = useState({
    nombre:'', apellido:'', ciudad:'', departamento:'', barrio:'',
    areas:[], correo:'', celular:'', descripcion:'',
    tipo_profesional: 'abogado',
    genero: '',
  })
  const [correoTouched,  setCorreoTouched]  = useState(false)
  const [celularTouched, setCelularTouched] = useState(false)
  const [formError, setFormError]   = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [lawyers, setLawyers]       = useState({ cercanos:[], porArea:[] })
  const [picked, setPicked]         = useState([])
  const [loadingL, setLoadingL]     = useState(false)
  const [roomId, setRoomId]         = useState(null)
  const [roomStatus, setRoomStatus] = useState('waiting')
  const [roomArea, setRoomArea]     = useState('')
  const [roomCodigo, setRoomCodigo] = useState('')          // ← código de referencia visible
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [uploading, setUploading]   = useState(false)

  // ── Lightbox para ver imágenes en grande — ChatLightbox maneja Escape internamente
  const [lightbox, setLightbox] = useState(null)

  // ── Contacto bloqueado (modal) ────────────────────────────────────────────
  const [contactoWarning, setContactoWarning] = useState(false)
  useEffect(() => {
    if (!contactoWarning) return
    const onKey = (e) => { if (e.key === 'Escape') setContactoWarning(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [contactoWarning])

  // ── Abogados excluidos (inactividad) ─────────────────────────────────────
  const [excludedLawyerIds, setExcludedLawyerIds] = useState([])
  const [closedRoomId, setClosedRoomId]           = useState(null)

  // ── PQR (peticiones / quejas / reclamos) tras cierre del chat ────────────
  const [pqrTipo,       setPqrTipo]       = useState('')        // peticion | queja | reclamo
  const [pqrMensaje,    setPqrMensaje]    = useState('')
  const [pqrSubmitting, setPqrSubmitting] = useState(false)
  const [pqrSent,       setPqrSent]       = useState(false)
  const [pqrError,      setPqrError]      = useState('')
  const [pqrYaExiste,   setPqrYaExiste]   = useState(false)     // si ya envió uno para este room

  // ── Voz ──────────────────────────────────────────────────────────────────
  const [recording, setRecording]         = useState(false)
  const [recordingTime, setRecordingTime] = useState(0)
  const mediaRecorderRef  = useRef(null)
  const audioChunksRef    = useRef([])
  const recordingTimerRef = useRef(null)

  // refs para evitar stale closures en callbacks de realtime
  const formRef    = useRef(form)
  const roomAreaRef = useRef(roomArea)
  useEffect(() => { formRef.current = form }, [form])
  useEffect(() => { roomAreaRef.current = roomArea }, [roomArea])

  const fileRef     = useRef(null)
  const messagesRef = useRef(null)
  const lawyersRef  = useRef(null)

  useEffect(() => {
    if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight
  }, [messages])

  // Cuando se abre el listado, el cierre del chat o la pantalla de espera,
  // llevar la vista a la sección correspondiente.
  useEffect(() => {
    if ((step === 'lawyers' || step === 'choose_another' || step === 'post_chat' || step === 'esperando') && lawyersRef.current) {
      lawyersRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [step])

  // Al entrar a post_chat, verificar si ya hay un PQR para esta sala —
  // así el formulario aparece UNA sola vez por consulta.
  useEffect(() => {
    if (step !== 'post_chat' || !closedRoomId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/pqr?room_id=eq.${closedRoomId}&select=id&limit=1`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        )
        const data = await res.json()
        if (!cancelled && Array.isArray(data) && data.length > 0) setPqrYaExiste(true)
      } catch { /* si falla, mostramos el form igual — no bloqueamos al cliente */ }
    })()
    return () => { cancelled = true }
  }, [step, closedRoomId])

  async function handleSendPqr() {
    if (!pqrTipo)            { setPqrError('Selecciona el tipo (petición, queja o reclamo).'); return }
    if (!pqrMensaje.trim())  { setPqrError('Describe tu situación.'); return }
    if (pqrMensaje.trim().length < 15) { setPqrError('El mensaje es muy corto, por favor amplíalo un poco.'); return }
    setPqrSubmitting(true); setPqrError('')
    const nombreCliente = `${form.nombre || ''} ${form.apellido || ''}`.trim()
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/pqr`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          // return=minimal — sin esto, PostgREST hace SELECT del row insertado
          // y necesita SELECT permission. Anon no tiene SELECT en `pqr` (solo
          // superadmin la lee), así que el SELECT post-INSERT falla con 42501
          // aunque el INSERT mismo haya pasado. La response no se usa, así que
          // minimal es lo correcto.
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          room_id:           closedRoomId || null,
          codigo_referencia: roomCodigo || null,
          client_nombre:     nombreCliente || null,
          client_email:      form.correo || null,
          tipo:              pqrTipo,
          mensaje:           pqrMensaje.trim(),
        }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => '')
        throw new Error(detail || `HTTP ${res.status}`)
      }
      // Avisar al equipo administrativo por correo (best-effort, no bloquea).
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'pqr_received',
          data: {
            tipo: pqrTipo,
            clientNombre: nombreCliente || null,
            clientEmail: form.correo || null,
            codigoReferencia: roomCodigo || null,
            mensaje: pqrMensaje.trim(),
          },
        }),
      }).catch(() => {})
      setPqrSent(true)
    } catch (err) {
      setPqrError('No se pudo enviar tu PQR: ' + (err.message || 'error desconocido'))
    } finally {
      setPqrSubmitting(false)
    }
  }

  useEffect(() => {
    if (!roomId) return
    loadMessages(roomId)
    const ch = supabase.channel(`rc:${roomId}`)
      .on('postgres_changes', { event:'INSERT', schema:'public', table:'chat_messages', filter:`room_id=eq.${roomId}` },
        p => {
          setMessages(prev => prev.find(m => m.id===p.new.id) ? prev : [...prev, p.new])
        })
      .on('postgres_changes', { event:'UPDATE', schema:'public', table:'chat_rooms', filter:`id=eq.${roomId}` },
        async p => {
          setRoomStatus(p.new.status)
          // Solicitud abierta tomada por un profesional → entra al chat.
          if (p.new.status === 'active') {
            setStep(s => s === 'esperando' ? 'chat' : s)
          }
          if (p.new.status === 'closed') {
            // Guardar roomId cerrado para rating posterior
            setClosedRoomId(p.new.id)
            // Obtener abogados del chat cerrado para excluirlos
            const { data: assignments } = await supabase
              .from('chat_room_lawyers').select('lawyer_id').eq('room_id', p.new.id)
            const excluded = (assignments || []).map(a => a.lawyer_id)
            setExcludedLawyerIds(excluded)
            // Obtener áreas actuales
            const areas = formRef.current.areas.length > 0
              ? formRef.current.areas
              : roomAreaRef.current.split(', ').map(a => a.trim()).filter(Boolean)
            const dept = formRef.current.departamento || ''
            // Buscar profesionales disponibles excluyendo los del chat cerrado
            if (areas.length > 0) {
              const rol = formRef.current.tipo_profesional || 'abogado'
              // Reutiliza fetchLawyers: mismo filtrado + lista cacheada (CDN).
              await fetchLawyers(areas, dept, excluded, rol)
            }
            // Flujo de cierre: 1° rating → 2° PQR → 3° opción de elegir otro.
            setStep('rating')
          }
        })
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [roomId])

  function handleResume(room) {
    setRoomId(room.id)
    setRoomStatus(room.status)
    setRoomArea(room.area_derecho)
    setRoomCodigo(room.codigo_referencia || '')
    setStep('chat')
  }

  function resetToStart() {
    setStep('cedula'); setRoomId(null); setRoomStatus('waiting'); setRoomArea(''); setRoomCodigo('')
    setMessages([]); setForm({ nombre:'', apellido:'', ciudad:'', departamento:'', barrio:'', areas:[], correo:'', celular:'', descripcion:'', tipo_profesional:'abogado', genero:'' })
    setPicked([])
    setExcludedLawyerIds([]); setClosedRoomId(null)
    setPqrTipo(''); setPqrMensaje(''); setPqrSent(false); setPqrError(''); setPqrYaExiste(false)
    setTriageResumen(''); setSolicitudAbierta(false); setAreasBloqueadas(false)
    localStorage.removeItem('chat_cedula_hash'); localStorage.removeItem('chat_nombre'); localStorage.removeItem('chat_codigo_ref')
  }

  async function handleFormSubmit() {
    const { nombre, apellido, ciudad, departamento, areas, correo, celular, descripcion } = form
    if (!nombre.trim())                    { setFormError('Ingresa tu nombre.'); return }
    if (!apellido.trim())                  { setFormError('Ingresa tu apellido.'); return }
    if (!departamento)                     { setFormError('Selecciona tu departamento.'); return }
    if (!ciudad)                           { setFormError('Selecciona tu ciudad.'); return }
    if (areas.length < 1)                  { setFormError('Selecciona al menos un área.'); return }
    if (!correo.trim() && !celular.trim()) { setFormError('Ingresa al menos un correo o celular.'); return }
    if (!descripcion.trim())               { setFormError('Describe brevemente tu caso.'); return }
    setSubmitting(true); setFormError('')
    localStorage.setItem('chat_nombre', `${nombre.trim()} ${apellido.trim()}`)

    // Flujo "solicitud abierta": no hay profesional del área → publicar directo
    // y pasar a la pantalla de espera (sin paso de selección ni segundo botón).
    if (solicitudAbierta) {
      setSubmitting(false)
      await publicarSolicitud()
      return
    }

    await fetchLawyers(areas, departamento, excludedLawyerIds, form.tipo_profesional)
    setStep('lawyers'); setSubmitting(false)
  }

  async function fetchLawyers(areas, departamento, excluded = [], rol = 'abogado') {
    setLoadingL(true)
    // Lista cacheada en el CDN (api/professionals.js) — misma data pública que
    // el home; evita pegar a Supabase por cada cliente que llega a este paso.
    let data = []
    try {
      const res = await fetch(`/api/professionals?rol=${rol}`)
      if (res.ok) data = await res.json()
    } catch { /* sin lista → arreglo vacío */ }
    const filtrados = (data || []).filter(l =>
      !excluded.includes(l.id) &&
      areas.some(a => l.area_derecho?.toLowerCase().includes(a.toLowerCase()))
    )
    setLawyers({
      cercanos: filtrados.filter(l => l.departamento === departamento),
      porArea:  filtrados.filter(l => l.departamento !== departamento),
    })
    setLoadingL(false)
  }

  function toggleLawyer(id) {
    // Selección única: si ya está seleccionado se deselecciona, si no se reemplaza
    setPicked(prev => prev.includes(id) ? [] : [id])
  }

  async function startChat() {
    if (!picked.length) return
    setSending(true)
    const hash      = localStorage.getItem('chat_cedula_hash')
    const codigoRef = localStorage.getItem('chat_codigo_ref') || null
    const { nombre, apellido, areas, descripcion, ciudad, departamento, barrio, correo, celular, genero } = form
    const ubicacionTxt = barrio ? `${ciudad} - ${barrio}, ${departamento}` : `${ciudad}, ${departamento}`

    // Reutilizar room existente waiting/active si ya hay uno (evita 409 por UNIQUE)
    const { data: existingRooms } = await supabase.from('chat_rooms')
      .select(ANON_ROOM_COLS).eq('client_cedula', hash).order('created_at', { ascending: false })
    let room = existingRooms?.find(r => r.status === 'waiting' || r.status === 'active') || null

    if (!room) {
      const baseRoom = {
        area_derecho:     areas.join(', '),
        client_token:     hash,
        client_cedula:    hash,
        client_email:     correo || null,
        client_nombre:    `${nombre} ${apellido}`,
        client_celular:   celular || null,
        client_genero:    genero || null,
        tipo_profesional: form.tipo_profesional || 'abogado',
        status:           'waiting',
      }

      let { data: inserted, error } = await supabase.from('chat_rooms')
        .insert({ ...baseRoom, codigo_referencia: codigoRef })
        .select(ANON_ROOM_COLS).single()

      // Fallback: si el codigo_referencia colisiona con un UNIQUE legacy
      // (consulta anterior cerrada, o el mismo código usado por otro
      // cliente), reintenta sin él. El UNIQUE no tiene sentido aquí —
      // un AAP-XXXXXX es de referencia, debe poder reusarse. Lo correcto
      // es soltar la constraint en BD; este fallback evita bloquear al
      // usuario mientras tanto.
      if (error?.code === '23505') {
        console.warn('[startChat] codigo_referencia colisiona con UNIQUE — reintentando sin él')
        const retry = await supabase.from('chat_rooms')
          .insert({ ...baseRoom, codigo_referencia: null })
          .select(ANON_ROOM_COLS).single()
        inserted = retry.data
        error    = retry.error
      }

      if (error || !inserted) {
        console.error('[startChat] Error insertando chat_rooms:', error)
        setFormError(`No se pudo crear la consulta: ${error?.message || 'error desconocido'}. Revisa la consola.`)
        setSending(false)
        return
      }
      room = inserted
    }

    await supabase.from('chat_room_lawyers').insert(picked.map(lid => ({ room_id: room.id, lawyer_id: lid, status:'invited' })))
    const resumenBloque = triageResumen
      ? `\n\n📋 Resumen del asistente IA:\n${triageResumen}`
      : ''
    await supabase.from('chat_messages').insert({
      room_id: room.id, sender_type:'client', lawyer_id: null,
      content: `Hola, mi nombre es ${nombre} ${apellido}.\n\nUbicación: ${ubicacionTxt}\nÁrea(s): ${areas.join(', ')}\n\nDescripción del caso:\n${descripcion}${resumenBloque}`,
    })
    const todosAbogados = [...lawyers.cercanos, ...lawyers.porArea]
    for (const abogado of todosAbogados.filter(l => picked.includes(l.id))) {
      // El email lo resuelve /api/notify server-side a partir del lawyerId,
      // así el browser nunca descarga correos de profesionales.
      await notificarAbogado({
        lawyerId:      abogado.id,
        nombreAbogado: `${abogado.nombre} ${abogado.apellido}`,
        nombreCliente: `${nombre} ${apellido}`,
        area:          areas.join(', '),
      })
    }
    setRoomId(room.id); setRoomStatus(room.status || 'waiting'); setRoomArea(areas.join(', '))
    setRoomCodigo(codigoRef || ''); setPicked([])
    setStep('chat'); setSending(false)
  }

  // ── Publicar "solicitud abierta" (modelo claim tipo Uber/DiDi) ──────────
  // Se usa SOLO como respaldo cuando no hay ningún profesional del área.
  // Crea la sala con status='open' (sin profesional asignado) y deja al
  // cliente en estado "esperando"; el primer profesional que la tome la
  // pasa a 'active' (lo detecta el realtime de chat_rooms más abajo).
  async function publicarSolicitud() {
    setSending(true); setFormError('')
    const hash      = localStorage.getItem('chat_cedula_hash')
    const codigoRef = localStorage.getItem('chat_codigo_ref') || null
    const { nombre, apellido, areas, descripcion, ciudad, departamento, barrio, correo, celular, genero } = form
    const ubicacionTxt = barrio ? `${ciudad} - ${barrio}, ${departamento}` : `${ciudad}, ${departamento}`

    // La sala 'open' + su mensaje de intro se crean en el servidor con
    // service-role (api/publicar-solicitud). Así el mensaje queda garantizado:
    // la RLS de chat_messages no deja al cliente anónimo escribir en una sala
    // sin profesional asignado. El profesional que la tome ve el caso completo.
    try {
      const res = await fetch('/api/solicitudes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accion: 'publicar',
          cedulaHash: hash, codigoRef,
          tipoProfesional: form.tipo_profesional || 'abogado',
          nombre, apellido, areas, descripcion,
          ubicacion: ubicacionTxt,
          correo: correo || null, celular: celular || null, genero: genero || null,
          resumen: triageResumen || '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data?.roomId) {
        setFormError(data?.error || 'No se pudo publicar la consulta. Intenta de nuevo.')
        setSending(false)
        return
      }
      setRoomId(data.roomId); setRoomStatus('open'); setRoomArea(areas.join(', '))
      setRoomCodigo(codigoRef || ''); setPicked([])
      setStep('esperando'); setSending(false)
    } catch {
      setFormError('No se pudo publicar la consulta. Revisa tu conexión.')
      setSending(false)
    }
  }

  async function loadMessages(rid) {
    const { data } = await supabase.from('chat_messages').select('*').eq('room_id', rid).order('created_at', { ascending: true })
    setMessages(data || [])
  }

  async function sendMessage() {
    if (!input.trim() || !roomId) return
    const content = input.trim()
    // ── Bloqueo de datos de contacto (teléfono / correo) ──────────────────
    if (contieneContacto(content)) {
      setContactoWarning(true)
      return
    }
    setInput('')
    await supabase.from('chat_messages').insert({ room_id: roomId, sender_type:'client', lawyer_id: null, content })
  }

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file || !roomId) return
    setUploading(true)
    const path = `${roomId}/${crypto.randomUUID()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('chat-files').upload(path, file, { contentType: file.type })
    if (!error) {
      const { data: signed } = await supabase.storage.from('chat-files').createSignedUrl(path, 604800)
      await supabase.from('chat_messages').insert({
        room_id: roomId, sender_type:'client', lawyer_id: null,
        content: file.name, file_url: signed?.signedUrl, file_name: file.name, file_size: file.size,
        message_type: 'file',
      })
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function fixAudioDuration(blob) {
    return new Promise(resolve => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        try { URL.revokeObjectURL(audio.src) } catch {}
        resolve(blob)
      }
      // Firefox a veces no dispara `timeupdate` tras el seek a 1e101 — sin
      // este timeout la promesa se cuelga para siempre y uploadAudio nunca
      // se ejecuta.
      const timer = setTimeout(finish, 1500)

      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      audio.src = URL.createObjectURL(blob)
      audio.onloadedmetadata = () => {
        if (audio.duration === Infinity || isNaN(audio.duration)) {
          audio.currentTime = 1e101
          audio.ontimeupdate = () => {
            audio.ontimeupdate = null
            audio.currentTime = 0
            clearTimeout(timer)
            finish()
          }
        } else {
          clearTimeout(timer)
          finish()
        }
      }
      audio.onerror = () => { clearTimeout(timer); finish() }
    })
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : ''
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      mediaRecorderRef.current = recorder; audioChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) audioChunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const actualType = recorder.mimeType || 'audio/webm'
        const blob = new Blob(audioChunksRef.current, { type: actualType })
        if (blob.size > 0) { const fixedBlob = await fixAudioDuration(blob); await uploadAudio(fixedBlob, actualType) }
      }
      recorder.start(100); setRecording(true); setRecordingTime(0)
      recordingTimerRef.current = setInterval(() => setRecordingTime(t => t+1), 1000)
    } catch (err) { alert('No se pudo acceder al micrófono: ' + err.message) }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop(); clearInterval(recordingTimerRef.current)
    setRecording(false); setRecordingTime(0)
  }

  async function uploadAudio(blob, mimeType = 'audio/webm') {
    if (!roomId) return
    setUploading(true)
    try {
      const ext  = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const path = `chats/${roomId}/audio_${Date.now()}.${ext}`
      const cleanMime = mimeType.split(';')[0] || 'audio/webm'
      const res  = await fetch(`${SUPABASE_URL}/storage/v1/object/chat-files/${path}`, {
        method: 'POST',
        headers: { 'Authorization':`Bearer ${SUPABASE_KEY}`, 'apikey':SUPABASE_KEY, 'Content-Type':cleanMime, 'x-upsert':'true' },
        body: blob,
      })
      if (!res.ok) { const err = await res.text().catch(() => ''); console.error('Error subiendo audio:', res.status, err); return }
      // Guardamos el path (no el signed URL) para que el audio NO expire.
      // AudioPlayer firma on-demand al reproducir.
      const { error: insErr } = await supabase.from('chat_messages').insert({
        room_id: roomId, sender_type:'client', lawyer_id: null,
        content:'Mensaje de voz', file_url: path,
        file_name:`voz_${Date.now()}.${ext}`, file_size: blob.size, message_type:'audio',
      })
      if (insErr) { console.error('Error insertando mensaje de audio:', insErr); return }
      await loadMessages(roomId)
    } catch (err) { console.error('Error en uploadAudio:', err) }
    finally { setUploading(false) }
  }

  const allLawyers = [...(lawyers.cercanos||[]), ...(lawyers.porArea||[])]

  // ── JSX compartido para lista de abogados (reutilizado en lawyers y choose_another) ──
  function LawyerList({ onStart, startLabel }) {
    return (
      <>
        {loadingL ? <p className={styles.loadingText}>Buscando abogados disponibles…</p>
          : allLawyers.length === 0 ? (
            <div className={styles.emptyLawyers}>
              <div className={styles.openCard}>
                <span className={styles.openBadge}>Sin profesional disponible</span>
                <p className={styles.openTitle}>
                  No hay un {form.tipo_profesional === 'contador' ? 'contador' : 'abogado'} de esta {form.tipo_profesional === 'contador' ? 'especialidad' : 'área'} disponible ahora mismo.
                </p>
                <p className={styles.openText}>
                  Publica tu consulta y te atenderá el <b>primer profesional disponible</b> que la tome — como pedir un servicio. Entrarás al chat automáticamente apenas alguien la acepte.
                </p>
                <button className={styles.btnPublicar} onClick={publicarSolicitud} disabled={sending}>
                  {sending ? 'Publicando…' : 'Publicar mi consulta'}
                </button>
                <button className={styles.btnBack} onClick={resetToStart} style={{ paddingTop: 14, paddingBottom: 0 }}>Volver al inicio</button>
              </div>
            </div>
          ) : (
            <>
              {lawyers.cercanos.length > 0 && (
                <>
                  <div className={styles.sectionLabel}>
                    <span className={styles.sectionLabelDot}/>
                    {form.tipo_profesional === 'contador' ? 'Contadores cerca de ti' : 'Abogados cerca de ti'} — {form.ciudad}, {form.departamento}
                  </div>
                  <div className={styles.lawyersList}>
                    {lawyers.cercanos.map(l => {
                      const sel = picked.includes(l.id)
                      const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
                      return (
                        <div key={l.id} className={`${sel ? styles.lawyerCardSelected : styles.lawyerCard} aap-card-lawyer`} data-selected={sel ? 'true' : 'false'} onClick={() => toggleLawyer(l.id)}>
                          <img className={styles.lawyerAvatar} src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`} alt={nombre} width="48" height="48" loading="lazy" decoding="async" />
                          <div className={styles.lawyerInfo}>
                            <p className={sel ? styles.lawyerNameSelected : styles.lawyerName}>{nombre}</p>
                            <p className={styles.lawyerArea}>{l.area_derecho}</p>
                            {l.ciudad && <p className={styles.lawyerCity}>{l.ciudad}{l.departamento ? `, ${l.departamento}` : ''}</p>}
                          </div>
                          <div className={sel ? styles.checkCircleSelected : styles.checkCircle}>{sel && <span className={styles.checkMark}>✓</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
              {lawyers.porArea.length > 0 && (
                <>
                  <div className={styles.sectionLabel} style={{ marginTop: lawyers.cercanos.length > 0 ? 32 : 0 }}>
                    <span className={styles.sectionLabelDot}/>
                    {form.tipo_profesional === 'contador' ? 'Contadores por especialidad' : 'Abogados por área'} — resto del país
                  </div>
                  <div className={styles.lawyersList}>
                    {lawyers.porArea.map(l => {
                      const sel = picked.includes(l.id)
                      const nombre = `${l.nombre||''} ${l.apellido||''}`.trim()
                      return (
                        <div key={l.id} className={`${sel ? styles.lawyerCardSelected : styles.lawyerCard} aap-card-lawyer`} data-selected={sel ? 'true' : 'false'} onClick={() => toggleLawyer(l.id)}>
                          <img className={styles.lawyerAvatar} src={l.foto_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(nombre)}&background=1a1a1a&color=c9a84c`} alt={nombre} width="48" height="48" loading="lazy" decoding="async" />
                          <div className={styles.lawyerInfo}>
                            <p className={sel ? styles.lawyerNameSelected : styles.lawyerName}>{nombre}</p>
                            <p className={styles.lawyerArea}>{l.area_derecho}</p>
                            {l.ciudad && <p className={styles.lawyerCity}>{l.ciudad}{l.departamento ? `, ${l.departamento}` : ''}</p>}
                          </div>
                          <div className={sel ? styles.checkCircleSelected : styles.checkCircle}>{sel && <span className={styles.checkMark}>✓</span>}</div>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </>
          )
        }
        {picked.length > 0 && (
          <button className={styles.btnGold} style={{ marginTop:24 }} onClick={onStart} disabled={sending}>
            {sending
              ? 'Iniciando chat…'
              : startLabel || `Iniciar chat con el ${form.tipo_profesional === 'contador' ? 'contador' : 'abogado'}`}
          </button>
        )}
      </>
    )
  }

  return (
    <section className={styles.section} id="chat">
      <style>{AAP_CARD_STYLES}</style>

      <div className={styles.header}>
        <h2 className={styles.title}>Consulta <span className={styles.titleGold}>Privada</span></h2>
        <p className={styles.subtitle}>
          Conecta directamente con abogados y contadores especializados. Tu cédula se convierte en un código anónimo.
        </p>
      </div>

      {/* ── Layout 3 columnas ── */}
      {(step === 'cedula' || step === 'chat') && (
        <div className={styles.floatingLayout}>
          <SideCards cards={CARDS_LEFT} side="left" />

          <div className={styles.centerContent}>
            {step === 'cedula' && (
              <StepCedula onNew={() => setStep('triage')} onResume={handleResume} />
            )}

            {step === 'chat' && (
              <div className={styles.chatWrap}>

                <div className={styles.chatHeader}>
                  <div>
                    <p className={styles.chatTitle}>Consulta — {roomArea || form.areas.join(', ')}</p>
                    <p className={styles.chatStatus}>
                      {roomStatus === 'waiting' ? 'Esperando que un abogado se una…'
                        : roomStatus === 'active' ? 'Chat activo'
                        : 'Consulta finalizada'}
                    </p>
                    {/* ── Código de referencia visible ── */}
                    {roomCodigo && (
                      <p style={{ fontSize:'0.68rem', color:'var(--gold)', letterSpacing:'0.12em',
                        fontFamily:"'Courier New', monospace", marginTop:4, opacity:0.8 }}>
                        Ref: {roomCodigo}
                      </p>
                    )}
                  </div>
                </div>

                <div className={styles.chatMessages} ref={messagesRef}>
                  {messages.length === 0 && (
                    <div className={styles.chatEmpty}>
                      <p className={styles.chatEmptyText}>Puedes presentar tu consulta.</p>
                      <p className={styles.chatEmptyHint}>Un abogado se unirá en breve.</p>
                    </div>
                  )}
                  {messages.map(msg => {
                    const mine = msg.sender_type === 'client'
                    // Mensajes de sistema (cierres de sala, notas, etc.) se
                    // pintan como notificación centrada, no como burbuja.
                    if (msg.message_type === 'system') {
                      return (
                        <div key={msg.id} className={styles.systemMsg}>
                          <span>{msg.content}</span>
                          <span className={styles.systemMsgTime}>
                            {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}
                          </span>
                        </div>
                      )
                    }
                    const isAudio = msg.message_type === 'audio' && msg.file_url
                    const isImageMsg = !isAudio && !!msg.file_url && isImage(msg.file_name)
                    return (
                      <div key={msg.id} className={mine ? styles.msgRowMine : styles.msgRowOther}>
                        <div className={`${mine ? styles.msgBubbleMine : styles.msgBubbleOther} ${isAudio ? styles.msgBubbleAudio : ''} ${isImageMsg ? styles.msgBubbleImg : ''}`}>
                          {isAudio ? (
                            // Color por rol: cliente (mine) → player dorado (theme dark);
                            // profesional → player navy (theme light).
                            <AudioPlayer src={msg.file_url} mine={true} theme={mine ? 'dark' : 'light'} />
                          ) : msg.file_url ? (
                            isImageMsg ? (
                              <ChatImage
                                src={msg.file_url}
                                alt={msg.file_name || 'imagen'}
                                btnClassName={styles.imgBtn}
                                imgClassName={styles.imgPreview}
                                onOpen={setLightbox}
                              />
                            ) : (
                              <button
                                className={styles.fileBtn}
                                onClick={() => openChatFile(msg.file_url)}
                                title={msg.file_name}
                              >
                                <IconPaperclip size={16} />
                                <span className={styles.fileName}>{msg.file_name}</span>
                                <span className={styles.fileSize}>{formatSize(msg.file_size)}</span>
                              </button>
                            )
                          ) : (
                            <p className={styles.msgText}>{msg.content}</p>
                          )}
                          <p className={mine ? styles.msgMetaMine : styles.msgMetaOther}>
                            {mine ? (localStorage.getItem('chat_nombre') || 'Tú') : 'Abogado'} · {new Date(msg.created_at).toLocaleTimeString('es-CO', { hour:'2-digit', minute:'2-digit' })}
                          </p>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className={styles.chatInputBar}>
                  <button className={styles.attachBtn} onClick={() => fileRef.current?.click()}
                    disabled={uploading} title="Adjuntar archivo"><IconPaperclip size={15} /></button>
                  <input ref={fileRef} type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp,.txt"
                    onChange={handleFile} style={{ display:'none' }} />
                  <button className={recording ? styles.recordingBtn : styles.attachBtn}
                    onClick={recording ? stopRecording : startRecording} disabled={uploading}
                    title={recording ? `Detener (${recordingTime}s)` : 'Grabar mensaje de voz'}>
                    {recording ? <><span className={styles.recordDot}/>{recordingTime}s</> : <IconMic size={15} />}
                  </button>
                  <input className={styles.chatInput} value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key==='Enter' && !e.shiftKey && (e.preventDefault(), sendMessage())}
                    placeholder="Escribe un mensaje… (Enter para enviar)" />
                  <button className={styles.sendBtn} onClick={sendMessage} disabled={!input.trim()}>Enviar</button>
                </div>

                {/* ── Modal: datos de contacto bloqueados ── */}
                {contactoWarning && (
                  <div
                    className={styles.modalOverlay}
                    onClick={() => setContactoWarning(false)}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="modalContactoTitleCliente"
                  >
                    <div className={styles.modalCard} onClick={e => e.stopPropagation()}>
                      <div className={styles.modalIconRed}>
                        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8"/>
                          <path d="M5.6 5.6 18.4 18.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                        </svg>
                      </div>
                      <h3 id="modalContactoTitleCliente" className={styles.modalTitle}>No puedes compartir datos de contacto</h3>
                      <p className={styles.modalText}>
                        Por seguridad, no está permitido enviar números de teléfono ni
                        correos electrónicos dentro del chat. Continúa la conversación sin
                        compartir datos de contacto.
                      </p>
                      <div className={styles.modalActions}>
                        <button className={styles.modalBtn} onClick={() => setContactoWarning(false)}>
                          Entendido
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <SideCards cards={CARDS_RIGHT} side="right" />
        </div>
      )}

      {step === 'triage' && (
        <div className={styles.floatingLayout} ref={lawyersRef}>
          <SideCards cards={CARDS_LEFT} side="left" />
          <div className={styles.centerContent}>
          <TriagePanel
            tipoProfesional={form.tipo_profesional}
            onManual={() => { setSolicitudAbierta(false); setAreasBloqueadas(false); setStep('form') }}
            onIniciarChat={({ profesionalId, area, resumen }) => {
              // Pre-llenar el form con lo detectado por la IA y pre-seleccionar el profesional.
              setSolicitudAbierta(false)
              const areasNorm = normalizarAreas(area, form.tipo_profesional)
              setAreasBloqueadas(areasNorm.length > 0)
              setForm(f => ({
                ...f,
                areas: areasNorm.length ? areasNorm : f.areas,
                descripcion: resumen || f.descripcion,
              }))
              setTriageResumen(resumen || '')
              setPicked([profesionalId])
              setStep('form')
            }}
            onPublicar={({ area, resumen }) => {
              // No hay profesional del área → pre-llena el form y activa el modo
              // "publicar": al enviar el form se publica directo y pasa a esperar.
              setSolicitudAbierta(true)
              const areasNorm = normalizarAreas(area, form.tipo_profesional)
              setAreasBloqueadas(areasNorm.length > 0)
              setForm(f => ({
                ...f,
                areas: areasNorm.length ? areasNorm : f.areas,
                descripcion: resumen || f.descripcion,
              }))
              setTriageResumen(resumen || '')
              setPicked([])
              setStep('form')
            }}
          />
          </div>
          <SideCards cards={CARDS_RIGHT} side="right" />
        </div>
      )}

      {/* ── Form ── */}
      {step === 'form' && (
        <div className={styles.form}>
          <div className={`${styles.formCard} aap-card-form`}>

            {/* ── Selector de tipo de profesional ─────────────────────────── */}
            <div className={styles.field}>
              <label className={styles.label}>
                ¿Qué tipo de profesional necesitas? <span className={styles.required}>*</span>
              </label>
              <div className={styles.tipoCards}>
                {TIPO_OPTIONS.map(opt => {
                  const sel = form.tipo_profesional === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`${sel ? styles.tipoCardSelected : styles.tipoCard} aap-card-tipo`}
                      data-selected={sel ? 'true' : 'false'}
                      onClick={() => setForm(f => ({
                        ...f,
                        tipo_profesional: opt.value,
                        // Resetear áreas — las del otro rol no aplican
                        areas: f.tipo_profesional === opt.value ? f.areas : [],
                      }))}
                    >
                      <span className={styles.tipoIcon}>{opt.icon}</span>
                      <span className={styles.tipoLabel}>{opt.label}</span>
                      <span className={styles.tipoDescripcion}>{opt.descripcion}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.field}>
                <label className={styles.label}>Nombre <span className={styles.required}>*</span></label>
                <input className={styles.input} value={form.nombre}
                  onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} placeholder="Tu nombre" />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>Apellido <span className={styles.required}>*</span></label>
                <input className={styles.input} value={form.apellido}
                  onChange={e => setForm(f => ({ ...f, apellido: e.target.value }))} placeholder="Tu apellido" />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label}>Género</label>
              <div className={styles.areasGrid} role="radiogroup" aria-label="Género">
                {[
                  { value: 'femenino',          label: 'Femenino' },
                  { value: 'masculino',         label: 'Masculino' },
                  { value: 'otro',              label: 'Otro' },
                  { value: 'prefiero_no_decir', label: 'Prefiero no decirlo' },
                ].map(opt => {
                  const sel = form.genero === opt.value
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={sel}
                      className={sel ? styles.areaChipSelected : styles.areaChip}
                      onClick={() => setForm(f => ({ ...f, genero: sel ? '' : opt.value }))}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <UbicacionSelector
              departamento={form.departamento}
              municipio={form.ciudad}
              barrio={form.barrio}
              required
              classes={{
                field: styles.field,
                label: styles.label,
                select: styles.select,
              }}
              onChange={({ departamento, municipio, barrio }) =>
                setForm(f => ({ ...f, departamento, ciudad: municipio, barrio }))
              }
            />
            <div className={styles.field}>
              <label className={styles.label}>Correo electrónico</label>
              {(() => {
                const v = validarCorreo(form.correo)
                return (
                  <>
                    <input
                      className={styles.input}
                      type="email"
                      value={form.correo}
                      onChange={e => setForm(f => ({ ...f, correo: e.target.value }))}
                      onBlur={() => setCorreoTouched(true)}
                      placeholder="tu@correo.com"
                      style={correoTouched && form.correo ? {
                        borderColor: v.valid === true
                          ? 'rgba(46,204,113,0.6)'
                          : v.valid === false
                          ? 'rgba(220,80,80,0.5)'
                          : undefined,
                      } : {}}
                    />
                    {correoTouched && form.correo && (
                      <span style={{
                        fontSize: '0.68rem',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: v.valid === true
                          ? 'rgba(46,204,113,0.9)'
                          : 'rgba(220,120,100,0.9)',
                      }}>
                        {v.valid === true ? '✓' : '⚠'} {v.msg}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Celular */}
            <div className={styles.field}>
              <label className={styles.label}>Celular</label>
              {(() => {
                const v = validarCelular(form.celular)
                return (
                  <>
                    <input
                      className={styles.input}
                      type="tel"
                      inputMode="numeric"
                      value={form.celular}
                      onChange={e => {
                        const normalizado = normalizarCelular(e.target.value)
                        setForm(f => ({ ...f, celular: normalizado }))
                      }}
                      onBlur={() => setCelularTouched(true)}
                      placeholder="3001234567"
                      maxLength={10}
                      style={celularTouched && form.celular ? {
                        borderColor: v.valid === true
                          ? 'rgba(46,204,113,0.6)'
                          : v.valid === false
                          ? 'rgba(220,80,80,0.5)'
                          : undefined,
                      } : {}}
                    />
                    {celularTouched && form.celular && (
                      <span style={{
                        fontSize: '0.68rem',
                        marginTop: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        color: v.valid === true
                          ? 'rgba(46,204,113,0.9)'
                          : 'rgba(220,120,100,0.9)',
                      }}>
                        {v.valid === true ? '✓' : '⚠'} {v.msg}
                      </span>
                    )}
                  </>
                )
              })()}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>
                {form.tipo_profesional === 'contador' ? 'Especialidad' : 'Área del caso'} <span className={styles.required}>*</span>
                {!areasBloqueadas && <span style={{ color:'rgba(13,45,94,0.45)', fontWeight:400, marginLeft:8 }}>(mínimo 1, máximo 3)</span>}
              </label>
              {areasBloqueadas ? (
                <div className={styles.areasLocked} aria-readonly="true">
                  {form.areas.map(a => (
                    <span key={a} className={styles.areaChipLocked}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      {a}
                    </span>
                  ))}
                  <span className={styles.areaLockHint}>Área detectada por el asistente</span>
                </div>
              ) : (
                <>
                  <div className={styles.areasGrid}>
                    {(form.tipo_profesional === 'contador' ? AREAS_CONTADURIA : AREAS_DERECHO).map(area => {
                      const selected = form.areas.includes(area)
                      const disabled = !selected && form.areas.length >= 3
                      return (
                        <button key={area} type="button"
                          className={selected ? styles.areaChipSelected : styles.areaChip}
                          disabled={disabled}
                          onClick={() => setForm(f => ({ ...f, areas: selected ? f.areas.filter(a => a!==area) : [...f.areas, area] }))}>
                          {area}
                        </button>
                      )
                    })}
                  </div>
                  {form.areas.length > 0 && <p className={styles.areasSelected}>Seleccionadas: <strong>{form.areas.join(' · ')}</strong></p>}
                </>
              )}
            </div>
            <div className={styles.field}>
              <label className={styles.label}>Descripción del caso <span className={styles.required}>*</span></label>
              <textarea className={styles.textarea} value={form.descripcion}
                onChange={e => setForm(f => ({ ...f, descripcion: e.target.value }))}
                placeholder="Describe la situación. No incluyas datos personales sensibles aún." rows={4} />
            </div>
            {formError && <p className={styles.formError}>{formError}</p>}
            <button className={styles.btnGold} onClick={handleFormSubmit} disabled={submitting || sending}>
              {solicitudAbierta
                ? ((submitting || sending) ? 'Publicando…' : 'Publicar mi consulta')
                : (submitting
                    ? (form.tipo_profesional === 'contador' ? 'Buscando contadores…' : 'Buscando abogados…')
                    : (form.tipo_profesional === 'contador' ? 'Buscar contadores disponibles' : 'Buscar abogados disponibles'))}
            </button>
            <button className={styles.btnBack} onClick={() => setStep('cedula')}>← Volver</button>
          </div>
        </div>
      )}

      {/* ── Selección inicial de profesionales ── */}
      {step === 'lawyers' && (
        <div className={styles.lawyersWrap} ref={lawyersRef}>
          <button className={styles.btnBack} onClick={() => setStep('form')}>← Volver al formulario</button>
          <p className={styles.areaTitle}>{form.areas.join(' · ')}</p>
          <p className={styles.areaSubtitle}>
            Selecciona un {form.tipo_profesional === 'contador' ? 'contador' : 'abogado'} para iniciar el chat.
          </p>
          <LawyerList
            onStart={startChat}
            startLabel={sending
              ? 'Iniciando chat…'
              : `Iniciar chat con el ${form.tipo_profesional === 'contador' ? 'contador' : 'abogado'}`}
          />
        </div>
      )}

      {/* ── Esperando que un profesional tome la solicitud abierta ── */}
      {step === 'esperando' && (
        <div className={styles.esperandoWrap} ref={lawyersRef}>
          <motion.div
            className={styles.esperandoCard}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className={styles.radar} aria-hidden="true">
              {prefersReducedMotion ? (
                <span className={styles.radarCore} />
              ) : (
                <>
                  {[0, 1, 2].map(i => (
                    <motion.span
                      key={i}
                      className={styles.radarWave}
                      initial={{ scale: 0.3, opacity: 0.55 }}
                      animate={{ scale: 1.8, opacity: 0 }}
                      transition={{ duration: 2.4, ease: 'easeOut', repeat: Infinity, delay: i * 0.8 }}
                    />
                  ))}
                  <motion.span
                    className={styles.radarCore}
                    animate={{ scale: [1, 1.12, 1] }}
                    transition={{ duration: 1.8, ease: 'easeInOut', repeat: Infinity }}
                  />
                </>
              )}
            </div>

            <p className={styles.esperandoTitle}>Tu consulta fue publicada</p>
            <p className={styles.esperandoText}>
              Estamos avisando a los profesionales disponibles. En cuanto uno tome tu caso, entrarás automáticamente al chat.
            </p>

            <div className={styles.esperandoStatus}>
              <span className={styles.esperandoDots} aria-hidden="true"><i /><i /><i /></span>
              Buscando un profesional para ti
            </div>

            <p className={styles.esperandoHint}>Puedes dejar esta ventana abierta, no necesitas recargar.</p>
            <button className={styles.esperandoCancel} onClick={resetToStart}>Cancelar</button>
          </motion.div>
        </div>
      )}

      {/* ── Post-chat: banner + PQR + opción de continuar con otro profesional ── */}
      {step === 'post_chat' && (
        <div className={styles.lawyersWrap} ref={lawyersRef}>
          <div className={styles.closedBanner}>
            <strong>Tu consulta anterior fue cerrada.</strong>
            Gracias por usar AAP. Si quieres, déjanos un comentario antes de continuar.
          </div>

          {!pqrYaExiste && (
            <div className={`${styles.pqrCard} aap-card-pqr`}>
              <p className={styles.pqrTitle}>¿Tienes algún comentario sobre tu experiencia?</p>
              <p className={styles.pqrSubtitle}>
                Tu mensaje llega directamente al equipo de AAP. Es opcional.
              </p>

              {pqrSent ? (
                <p className={styles.pqrSuccess}>
                  ✓ Tu PQR fue enviada. Gracias por tu retroalimentación.
                </p>
              ) : (
                <>
                  <div className={styles.pqrTipoPills}>
                    {[
                      { v:'peticion', l:'Petición' },
                      { v:'queja',    l:'Queja' },
                      { v:'reclamo',  l:'Reclamo' },
                    ].map(opt => (
                      <button
                        key={opt.v}
                        type="button"
                        className={pqrTipo === opt.v ? styles.pqrTipoPillSelected : styles.pqrTipoPill}
                        onClick={() => setPqrTipo(opt.v)}
                      >
                        {opt.l}
                      </button>
                    ))}
                  </div>

                  <textarea
                    className={styles.pqrTextarea}
                    placeholder="Describe tu situación..."
                    value={pqrMensaje}
                    onChange={e => setPqrMensaje(e.target.value)}
                    rows={4}
                    maxLength={2000}
                  />

                  <div className={styles.pqrFooter}>
                    <button
                      className={styles.pqrSubmitBtn}
                      onClick={handleSendPqr}
                      disabled={pqrSubmitting}
                    >
                      {pqrSubmitting ? 'Enviando…' : 'Enviar PQR'}
                    </button>
                  </div>

                  {pqrError && <p className={styles.pqrError}>{pqrError}</p>}
                </>
              )}
            </div>
          )}

          <div className={styles.postChatActions}>
            <button className={styles.btnBack} onClick={resetToStart}>
              Salir
            </button>
          </div>
        </div>
      )}

      {/* ── Elegir otro profesional (solo se llega desde post_chat al pulsar "Buscar otro") ── */}
      {step === 'choose_another' && (
        <div className={styles.lawyersWrap} ref={lawyersRef}>
          <p className={styles.areaTitle}>
            Continuar con otro {form.tipo_profesional === 'contador' ? 'contador' : 'abogado'}
          </p>
          <p className={styles.areaSubtitle}>
            Selecciona un {form.tipo_profesional === 'contador' ? 'contador' : 'abogado'} para iniciar una nueva consulta.
          </p>

          <LawyerList
            onStart={async () => {
              setClosedRoomId(null); setExcludedLawyerIds([])
              await startChat()
            }}
            startLabel={sending ? 'Iniciando chat…' : 'Iniciar nueva consulta'}
          />

          <div className={styles.postChatActions} style={{ marginTop: 16 }}>
            <button className={styles.btnBack} onClick={() => setStep('post_chat')}>
              ← Volver
            </button>
            <button className={styles.btnBack} onClick={resetToStart}>Salir</button>
          </div>
        </div>
      )}

      {step === 'rating' && roomId && (
        <RatingPanel roomId={roomId} onDone={() => setStep('post_chat')} />
      )}

      <ChatLightbox src={lightbox} onClose={() => setLightbox(null)} />
    </section>
  )
}
