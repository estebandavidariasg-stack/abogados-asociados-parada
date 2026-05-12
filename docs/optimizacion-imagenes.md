# Optimizacion de carga de imagenes

## Problema detectado

La home podia sentirse lenta en produccion porque el hero esperaba la respuesta
de Supabase antes de renderizar las imagenes locales, y el carrusel podia montar
varias imagenes completas al mismo tiempo. Ademas, algunos logos y avatares no
tenian dimensiones, `decoding="async"` ni carga diferida.

## Cambios aplicados

- El hero renderiza inmediatamente `DEFAULT_SLIDES`, usando las variantes locales
  AVIF/WebP/JPG ya generadas en `public`.
- La consulta a Supabase del carrusel ahora solo reemplaza los slides si la
  configuracion existe y la respuesta llega correctamente.
- El carrusel solo descarga la imagen activa y las vecinas inmediatas. Los slides
  mas lejanos conservan el placeholder LQIP de fondo hasta acercarse al foco.
- La seccion de perfiles carga datos cuando se acerca al viewport, para no competir
  con el hero durante el primer render.
- Avatares, fotos de perfiles, QR y logos tienen dimensiones explicitas,
  `decoding="async"` y `loading="lazy"` donde no son recursos criticos.
- El logo del navbar y footer ya no usa `favicon.png`/`logo.png` pesados; usa
  `logo-nav.webp` con fallback `logo-nav.png`.
- Los videos de perfil usan `preload="metadata"` para evitar descargar video
  completo antes de una interaccion real.

## Justificacion

Estos cambios priorizan el recurso visual critico del primer pantallazo, reducen
descargas simultaneas, evitan layout shifts y dejan que el navegador decida el
formato y ancho correcto para el hero. El resultado esperado es menor LCP, menos
consumo de ancho de banda inicial y una experiencia mas estable en conexiones
lentas.
