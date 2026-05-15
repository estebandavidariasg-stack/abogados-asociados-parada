import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [react()],

  // En producción, eliminar console.log/debug/info/trace del bundle.
  // Mantener console.error y console.warn para que errores reales sigan
  // siendo observables en el browser (útil si se integra Sentry/LogRocket).
  // Esto evita filtrar datos de debug, IDs internos, headers, etc. via
  // DevTools — defense in depth contra info disclosure.
  ...(mode === 'production' && {
    esbuild: {
      pure: ['console.log', 'console.debug', 'console.info', 'console.trace'],
      drop: ['debugger'],
    },
  }),
}))
