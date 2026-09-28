/* ─────────────────────────────────────────────────────────────────────────
   sondear — sondeo periódico que no trabaja de balde.

   La base está en Oregón y la gente en Colombia: cada consulta son unos
   150 ms de ida y vuelta, de los cuales la base ocupa dos. Lo que pesa no es
   la consulta, es CUÁNTAS hay. Con el panel del profesional abierto había
   cerca de cuarenta peticiones por minuto en segundo plano, así que cuando
   la persona por fin hacía algo (abrir un chat, subir un archivo) su
   petición entraba en cola detrás de las demás.

   Dos reglas, y las dos importan:

     · Con la pestaña oculta NO se consulta. Nadie está leyendo.
     · Al volver a la pestaña se consulta EN EL ACTO, sin esperar al
       siguiente turno. Sin esto, pausar se paga con datos viejos: vuelves y
       te quedas mirando el estado de hace veinte segundos.

   Devuelve la función para detenerlo, para usarla tal cual en el `return`
   de un useEffect.
   ───────────────────────────────────────────────────────────────────────── */
export function sondear(fn, ms) {
  let parado = false
  const tick = () => { if (!parado && !document.hidden) fn() }

  const id = setInterval(tick, ms)
  // `visibilitychange` dispara también al ocultar: el propio tick lo filtra.
  document.addEventListener('visibilitychange', tick)

  return () => {
    parado = true
    clearInterval(id)
    document.removeEventListener('visibilitychange', tick)
  }
}
