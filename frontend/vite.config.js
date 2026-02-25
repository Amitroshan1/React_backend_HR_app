import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // If deploying to a subpath (e.g. /app/), set base: '/app/'
  base: '/',
  build: {
    assetsDir: 'assets',
    cssCodeSplit: true,
    sourcemap: false,
  },
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:5000',
      '/select_role': 'http://127.0.0.1:5000',
      '/static': 'http://127.0.0.1:5000',
    },
  },
})
