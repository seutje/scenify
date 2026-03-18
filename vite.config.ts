import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      base: '/scenify/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.STORYBOARD_PROVIDER': JSON.stringify(env.STORYBOARD_PROVIDER),
        'process.env.OLLAMA_BASE_URL': JSON.stringify(env.OLLAMA_BASE_URL || env.OLLAMA_URL),
        'process.env.OLLAMA_URL': JSON.stringify(env.OLLAMA_BASE_URL || env.OLLAMA_URL),
        'process.env.OLLAMA_MODEL': JSON.stringify(env.OLLAMA_MODEL)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
