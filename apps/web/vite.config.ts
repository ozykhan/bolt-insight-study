import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // One .env at the repo root serves both apps.
  envDir: '../../',
  // Vite only exposes variables with these prefixes to browser code. The
  // PostHog project key is public by design (it ships in every page that uses
  // PostHog), so these two are listed by name rather than opening a prefix.
  envPrefix: ['VITE_', 'POSTHOG_PROJECT_KEY', 'POSTHOG_HOST'],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      // Socket.io's handshake and WebSocket go to the API too, so the browser
      // only ever talks to one origin and no CORS setup is needed.
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
