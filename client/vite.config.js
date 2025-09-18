import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // ESM-compatible way to get the directory
  const envDir = new URL('.', import.meta.url).pathname;
  const env = loadEnv(mode, envDir, '');
  const API_BASE_URL = env.VITE_API_BASE_URL || 'http://localhost:5000'

  return {
    plugins: [react()],
    server: {
      proxy: {
        // --- Synced with backend endpoints ---
        '/list-pdfs': API_BASE_URL,
        '/pdf-cover': API_BASE_URL,
        '/authorize': API_BASE_URL,
        '/covers': API_BASE_URL,
        '/api/login': API_BASE_URL,
        '/api/register': API_BASE_URL,
        '/api/change-password': API_BASE_URL,
        '/api/add-secondary-email': API_BASE_URL,
        '/api/remove-secondary-email': API_BASE_URL,
        '/api/drive-webhook': API_BASE_URL,
        '/api/get-user': API_BASE_URL,
        '/api/export-account': API_BASE_URL,
        '/api/import-account': API_BASE_URL,
        '/api/update-profile-settings': API_BASE_URL,
        '/api/update-colors': API_BASE_URL,
        '/api/update-external-id': API_BASE_URL,
        '/api/get-notification-prefs': API_BASE_URL,
        '/api/update-notification-prefs': API_BASE_URL,
        '/api/get-notification-history': API_BASE_URL,
        '/api/notification-history': API_BASE_URL,
        '/api/notify-reply': API_BASE_URL,
        '/api/notify-new-book': API_BASE_URL,
        '/api/notify-book-update': API_BASE_URL,
        '/api/notify-app-update': API_BASE_URL,
        '/api/mark-all-notifications-read': API_BASE_URL,
        '/api/delete-notification': API_BASE_URL,
        '/api/dismiss-all-notifications': API_BASE_URL,
        '/api/mark-notification-read': API_BASE_URL,
        '/api/delete-all-notification-history': API_BASE_URL,
        '/api/get-bookmarks': API_BASE_URL,
        '/api/add-bookmark': API_BASE_URL,
        '/api/remove-bookmark': API_BASE_URL,
        '/api/update-bookmark-meta': API_BASE_URL,
        '/api/vote-book': API_BASE_URL,
        '/api/book-votes': API_BASE_URL,
        '/api/top-voted-books': API_BASE_URL,
        '/api/user-top-voted-books': API_BASE_URL,
        '/api/add-comment': API_BASE_URL,
        '/api/edit-comment': API_BASE_URL,
        '/api/delete-comment': API_BASE_URL,
        '/api/get-comments': API_BASE_URL,
        '/api/has-new-comments': API_BASE_URL,
        '/api/vote-comment': API_BASE_URL,
        '/api/get-comment-votes': API_BASE_URL,
        '/api/user-comments': API_BASE_URL,
        '/api/moderate-comment': API_BASE_URL,
        '/api/all-books': API_BASE_URL,
        '/api/user-voted-books': API_BASE_URL,
        '/api/cover-queue-health': API_BASE_URL,
        '/api/server-health': API_BASE_URL,
        '/api/health': API_BASE_URL,
        '/api/landing-page-book-ids': API_BASE_URL,
        '/api/cover-diagnostics': API_BASE_URL,
        '/api/rebuild-cover-cache': API_BASE_URL,
        '/api/github-webhook': API_BASE_URL,
        '/api/cover-exists': API_BASE_URL,
        '/api/simulate-cover-load': API_BASE_URL,
        '/api/pdf-text': API_BASE_URL,
        '/api/cancel-session': API_BASE_URL,
        '/api/seed-drive-books': API_BASE_URL,
        '/api/admin/make-admin': API_BASE_URL,
        '/api/admin/remove-admin': API_BASE_URL,
        '/api/admin/bootstrap-admin': API_BASE_URL,
        '/api/admin/send-emergency-email': API_BASE_URL,
        '/api/admin/send-newsletter': API_BASE_URL,
        '/api/admin/ban-user': API_BASE_URL,
        '/api/admin/unban-user': API_BASE_URL,
        '/api/test-send-scheduled-notifications': API_BASE_URL,
        // --- Endpoints for production ---
        // To use production backend, set VITE_API_BASE_URL in your .env.production file
      }
    }
  }
})

