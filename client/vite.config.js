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
      '/api/pdf-text': 'http://localhost:5000',
      '/api/register': 'http://localhost:5000',
      '/api/login': 'http://localhost:5000',
      '/api/update-colors': 'http://localhost:5000',
      '/api/update-profile-settings': 'http://localhost:5000',
      '/api/change-password': 'http://localhost:5000',
      '/api/add-secondary-email': 'http://localhost:5000',
      '/api/remove-secondary-email': 'http://localhost:5000',
      '/api/delete-account': 'http://localhost:5000',
      '/api/notification-prefs': 'http://localhost:5000',
      '/api/update-notification-prefs': 'http://localhost:5000',
      '/api/notification-history': 'http://localhost:5000',
      '/api/seed-notifications': 'http://localhost:5000',
      '/api/notify-new-book': 'http://localhost:5000',
      '/api/notify-book-update': 'http://localhost:5000',
      '/api/notify-app-update': 'http://localhost:5000',
      '/api/add-bookmark': 'http://localhost:5000',
      '/api/remove-bookmark': 'http://localhost:5000',
      '/api/get-bookmarks': 'http://localhost:5000',
    }
  }
})
