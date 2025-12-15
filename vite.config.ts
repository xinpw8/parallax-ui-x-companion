import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/v1': 'http://localhost:3001',
      '/api': 'http://localhost:3001',
      '/cluster': 'http://localhost:3001',
    }
  }
})
