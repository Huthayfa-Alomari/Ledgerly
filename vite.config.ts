import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const connectSources: string[] = [];
  const configuredUrl = env.VITE_SUPABASE_URL?.trim();
  if (configuredUrl) {
    try {
      const endpoint = new URL(configuredUrl);
      const allowedProtocol = endpoint.protocol === 'https:' || (command === 'serve' && endpoint.protocol === 'http:');
      if (allowedProtocol && !endpoint.username && !endpoint.password) {
        connectSources.push(endpoint.origin);
        connectSources.push(endpoint.protocol === 'https:' ? `wss://${endpoint.host}` : `ws://${endpoint.host}`);
      }
    } catch {
      throw new Error('VITE_SUPABASE_URL must be a valid URL before building Ledgerly.');
    }
  }
  if (command === 'serve') connectSources.push('http://127.0.0.1:5173', 'ws://127.0.0.1:5173');
  return {
    base: './',
    plugins: [react(), {
      name: 'ledgerly-runtime-csp-sources',
      transformIndexHtml(html) {
        return html.replace('__LEDGERLY_CONNECT_SOURCES__', connectSources.join(' '));
      },
    }],
  };
});
