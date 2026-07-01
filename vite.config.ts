import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { tradingReviewApiPlugin } from './src/server/app-plugin';

export default defineConfig({
  plugins: [tradingReviewApiPlugin(), react()],
  server: {
    port: 5173,
  },
});
