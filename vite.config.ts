import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { tradingReviewApiPlugin } from './src/server/app-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [tradingReviewApiPlugin({ serverChanKey: env.SERVERCHAN_KEY }), react()],
    server: {
      port: 5173,
    },
  };
});
