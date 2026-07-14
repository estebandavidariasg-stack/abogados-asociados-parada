# Firma electrónica propia — Diseño

**Fecha:** 2026-07-10
**Estado:** Aprobado (pendiente de revisión final del usuario)

---

## 1. Objetivo

Implementar **firma electrónica propia, gratuita y sin marca de agua** dentro de
Parada Bridge, válida en Colombia bajo la **Ley 527 de 1999** como firma
electrónica (no "firma digital certificada"). Todo el estampado ocurre en el
navegador; no se contrata ningún proveedor externo ni se paga por firma.

## 2. Decisiones tomadas (resumen del brainstorming)

| Tema | Decisión |
|------|----------|
| Nivel legal | Firma electrónica (Ley 527/1999), gratis, sin marca de agua |
| Verificación de identidad | **OTP de 6 dígitos al correo** del firmante, antes de firmar |
| Formatos aceptados | **PDF y Word (.docx)**; el Word se convierte a PDF en el navegador |
| Pie de firma (bajo cada firma) | Nombre, cédula, teléfono, correo, ciudad, fecha, "en calidad de" |
| Camino 1 | **Chat**: profesional ↔ cliente |
| Camino 2 | **Contratos**: interno profesional ↔ administrador (ambos autenticados) |
| Quién inicia el contrato interno | Cualquiera de los dos (profesional o administrador) |

## 3. Restricción crítica de infraestructura

`api/` ya tiene **12 funciones serverless**, que es el **límite de Vercel Hobby**.
Rutas actuales: `verify-code`, `carousel`, `professionals`, `reassign`,
`verify-request`, `cron/gen-inactividad`, `notify`, `forgot-password`,
`whatsapp-webhook`, `solicitudes`, `ai`, `send-verification-code`.

**Regla de diseño: esta feature NO agrega ninguna función serverless nueva.**

- El motor de firma (estampado, hash, conversión) corre **100% en el navegador**.
- Los registros (`solicitudes`, `firmantes`) se crean **por Supabase REST** con
  `getAuthHeaders()`, igual que ya hace `MisContratos`.
- El **OTP reutiliza** `send-verification-code` + `verify-code`, extendidos para
  aceptar `tipo='firma'`.

## 4. Alcance

**Incluye:**
- Estampado de firma manuscrita (canvas) sobre PDF + pie de firma + página de
  certificado de auditoría.
- Conversión .docx → PDF en el navegador (con `docx-preview` ya instalado).
- Verificación OTP por correo antes de cada firma.
- Camino chat (cliente firma en el hilo) y camino contratos (interno).

**No incluye (fuera de alcance / futuro):**
- Firma digital certificada (requiere entidad acreditada ONAC — de pago).
- Ruta pública `/firmar/:token` para terceros externos. *Se considera opcional a
  futuro*, solo para un cliente de chat que regrese fuera de la sesión.
- Firma de .xlsx.

## 5. Arquitectura

Piezas nuevas (todas de cliente, salvo la extensión de OTP):

| Pieza | Ubicación | Rol |
|-------|-----------|-----|
| `firmaPdf.js` | `src/lib/` | Motor: cargar PDF, estampar firma+pie, anexar certificado, calcular hash |
| `docxAPdf.js` | `src/lib/` | Convertir .docx → PDF (render `docx-preview` → imágenes → PDF) |
| `FirmaSigner.jsx` (+ `.module.css`) | `src/components/firma/` | UI de firmar: lienzo, formulario del pie, paso OTP |
| `EnviarAFirmar.jsx` (+ `.module.css`) | `src/components/firma/` | UI para iniciar: elegir doc, definir firmantes, previsualizar |
| Extensión OTP | `api/send-verification-code.js`, `api/verify-code.js` | Aceptar `tipo='firma'` (sin nuevas funciones) |
| Tablas + bucket | Supabase | Persistencia (ver §6) |

`pdf-lib` es la **única dependencia nueva**.

## 6. Modelo de datos

### 6.1 Tabla `firmas_solicitudes`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `origen` | text | `'chat'` \| `'contrato'` |
| `room_id` | uuid null | si `origen='chat'`, referencia a `chat_rooms` |
| `contrato_id` | uuid null | si `origen='contrato'`, referencia a `contratos` |
| `creador_id` | uuid | profile que inició (profesional o admin) |
| `doc_original_path` | text | PDF a firmar en bucket `documentos-firma` |
| `doc_firmado_path` | text null | PDF final una vez firmado por todos |
| `estado` | text | `'pendiente'` \| `'firmado'` \| `'cancelado'` |
| `created_at` | timestamptz | default now() |

### 6.2 Tabla `firmas_firmantes`
| Columna | Tipo | Notas |
|---------|------|-------|
| `id` | uuid PK | |
| `solicitud_id` | uuid FK → firmas_solicitudes | on delete cascade |
| `orden` | int | orden de firma |
| `rol_firma` | text | `'cliente'` \| `'abogado'` \| `'contador'` \| `'administrador'` |
| `nombre` | text | pie de firma |
| `cedula` | text | pie de firma |
| `telefono` | text | pie de firma |
| `correo` | text | destino del OTP + pie de firma |
| `ciudad` | text | pie de firma |
| `estado` | text | `'pendiente'` \| `'firmado'` |
| `firmado_at` | timestamptz null | |
| `ip` | text null | traza |
| `user_agent` | text null | traza |
| `otp_verificado` | bool | default false |
| `doc_hash` | text null | SHA-256 del PDF tras estampar esta firma |

### 6.3 Bucket `documentos-firma`
Privado. Acceso por **URL firmada** (mismo patrón que `contratos`/`chat-files`).

### 6.4 RLS (a aplicar en Supabase, como se hizo con `notificaciones`)
- `firmas_solicitudes` / `firmas_firmantes`: el creador y los profesionales/admin
  asignados pueden leer; el superadmin lee todo. Escritura por el creador y por
  el firmante que actualiza su propia fila al firmar.
- El **cliente de chat** (anónimo) firma con la **anon key**; se requiere una
  policy explícita de UPDATE sobre su fila `firmas_firmantes` acotada por el `id`
  de la fila (token entregado en el mensaje del chat), similar a la policy de
  INSERT anónimo en `pqr`.

### 6.5 OTP
Reutiliza la tabla existente `verification_codes` con `tipo_registro='firma'`.
No se crea tabla de OTP nueva.

## 7. Motor de firma — `src/lib/firmaPdf.js`

API del módulo (todo cliente, con `pdf-lib`):

- `async estamparFirma(pdfBytes, { firmaPng, pie, posicion }) → Uint8Array`
  Incrusta la imagen PNG de la firma en `posicion` (página + x/y) y dibuja debajo
  el **pie de firma** con los 7 campos.
- `async anexarCertificado(pdfBytes, { solicitudId, firmantes }) → Uint8Array`
  Agrega una última página "Certificado de Firma Electrónica" (ver §11).
- `async hashDocumento(pdfBytes) → string` (SHA-256 vía `crypto.subtle`).

## 8. Conversión Word → PDF — `src/lib/docxAPdf.js`

Enfoque **gratuito, de navegador**:
1. `docx-preview` renderiza el .docx en un contenedor oculto (ya se usa así en
   `ModelosContractualesSection`).
2. Cada página renderizada se rasteriza a imagen y se compone un PDF con `pdf-lib`.

⚠️ **Riesgo aceptado:** la conversión puede alterar levemente el formato
(márgenes, saltos, fuentes). **Mitigación:** tras convertir, se muestra una
**vista previa obligatoria** y un botón "descargar PDF convertido" para que el
iniciador verifique antes de enviar a firmar. Si no convence, puede exportar a
PDF desde Word (1 clic) y subir ese.

## 9. Componente `FirmaSigner.jsx`

Pasos que ve el firmante:
1. Ve el PDF a firmar.
2. **OTP**: se envía código al correo (`send-verification-code` con `tipo='firma'`)
   → lo ingresa → `verify-code`.
3. **Dibuja** su firma en un `<canvas>` (dedo/mouse) → exporta PNG.
4. **Completa el pie de firma**: nombre, cédula, teléfono, correo, ciudad, fecha
   (auto), "en calidad de" (según su rol). Se pre-llena lo conocido.
5. Confirma → el cliente estampa con `firmaPdf.estamparFirma`, sube el PDF al
   bucket por REST, actualiza su fila en `firmas_firmantes` (estado, hash, ip, ua).
6. Si es el último firmante, se anexa el certificado y `firmas_solicitudes` pasa a
   `'firmado'`.

## 10. Flujos

### 10.1 Camino Chat (profesional ↔ cliente)
1. Profesional en `LawyerChatDashboard`/`ContadorChatDashboard` pulsa **"Enviar a
   firmar"** (nuevo botón en la barra del chat) → monta `EnviarAFirmar`.
2. Sube/elige PDF o Word (Word → §8 con vista previa). Define firmantes.
3. Se crea `firmas_solicitudes(origen='chat', room_id=…)` + filas de
   `firmas_firmantes`. Se inserta un **mensaje especial** en `chat_messages`
   (tipo firma, con `solicitud_id`) que renderiza el botón "Firmar documento".
4. El cliente, en `ChatSection`, pulsa "Firmar documento" → `FirmaSigner`
   (§9). El PDF firmado se publica de vuelta como mensaje.
5. Si el profesional también firma, repite. Al completar, ambos descargan el final.

### 10.2 Camino Contratos (interno, profesional ↔ administrador)
1. En `MisContratos` (perfil del profesional **o** AdminPage → Contratos) se
   agrega por documento la acción **"Enviar a firmar"**. Puede iniciar **cualquiera
   de los dos**.
2. Se crea `firmas_solicitudes(origen='contrato', contrato_id=…)` con dos
   firmantes: el profesional (`rol_firma` según su rol) y el administrador
   (`'administrador'`).
3. Cada uno, desde su propia sesión autenticada, ve el contrato con estado
   "pendiente de tu firma" y firma con `FirmaSigner` (§9).
4. Al firmar ambos, el PDF firmado se guarda y queda descargable en Contratos.
   El registro en `contratos` se enlaza con `doc_firmado_path`.

> Ambos firmantes están autenticados; el OTP se envía al correo de su cuenta.

### 10.3 Repositorio de evidencia en `MisContratos` (dividido por contraparte)
Todo PDF firmado le queda **guardado al profesional como evidencia**, y
`MisContratos` los organiza en **dos secciones separadas**, derivadas de
`firmas_solicitudes.origen`:

- **Firmados con clientes** — solicitudes `origen='chat'` donde el profesional es
  creador o firmante. Muestra: nombre del documento, cliente(s) firmante(s),
  fecha, botón descargar el PDF firmado.
- **Firmados con la administración** — solicitudes `origen='contrato'`. Muestra el
  contrato interno firmado por profesional + administrador.

Esto convive con la lista actual de **documentos subidos** (comportamiento
existente de `MisContratos`). La UI queda con tres agrupaciones: *Subidos*,
*Firmados con clientes*, *Firmados con la administración* (chips/pestañas). El
administrador (en AdminPage → Contratos, `isSuperAdmin`) ve estas mismas secciones
del profesional seleccionado.

**Implementación:** una consulta REST a `firmas_solicitudes` (con join a
`firmas_firmantes` para los nombres) filtrada por `estado='firmado'` y por el
profesional, agrupada en cliente por `origen`. No requiere columnas nuevas.

## 11. Certificado de auditoría (última página del PDF)

Contenido exacto:
- Encabezado: **"Certificado de Firma Electrónica — Ley 527 de 1999"**.
- Identificador único de la solicitud (`firmas_solicitudes.id`).
- Por cada firmante: nombre, cédula, correo, rol ("en calidad de"), fecha/hora de
  firma, IP, user-agent, y la leyenda **"Identidad verificada mediante código de
  un solo uso enviado a su correo electrónico."**
- **Hash SHA-256** del documento firmado (integridad).
- Nota: "Este documento fue firmado electrónicamente. La firma electrónica tiene
  plena validez jurídica en Colombia conforme a la Ley 527 de 1999."

## 12. Dependencias nuevas
- `pdf-lib` (MIT) — única dependencia nueva. `docx-preview` ya está instalado.

## 13. Riesgos y mitigaciones
| Riesgo | Mitigación |
|--------|------------|
| Fidelidad de conversión Word→PDF | Vista previa obligatoria + opción de subir PDF exportado desde Word |
| Firma anónima del cliente de chat (RLS) | Policy de UPDATE acotada por id de fila (patrón `pqr`) |
| Peso legal menor que firma certificada | Documentado y aceptado; OTP + hash + traza refuerzan la prueba |
| Límite de 12 funciones Vercel | Cero funciones nuevas: todo cliente + REST + reuso de OTP |
| Documentos grandes en navegador | Límite de 10 MB (ya vigente en `MisContratos`) |

## 14. Criterios de aceptación
1. Un profesional envía un PDF a firmar en un chat; el cliente recibe OTP, dibuja
   su firma, y el PDF firmado aparece en el hilo con pie de firma + certificado.
2. Un .docx se convierte a PDF, se muestra la vista previa, y se firma igual.
3. En Contratos, profesional y administrador firman el mismo documento; el PDF
   final tiene **ambos** pies de firma y un certificado con **ambos** firmantes.
4. En `MisContratos`, los documentos firmados aparecen guardados y **divididos en
   "Firmados con clientes" y "Firmados con la administración"** como evidencia,
   descargables por el profesional y por el administrador.
5. El deploy de Vercel sigue con 12 funciones (no se agregó ninguna).
6. Ningún PDF resultante lleva marca de agua.
