import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/list-pdfs': 'http://localhost:5000',
      '/view-pdf': 'http://localhost:5000',
      '/download-pdf': 'http://localhost:5000',
      "/pdf-cover": "http://localhost:5000",
      '/authorize': 'http://localhost:5000',
    }
  }
})
