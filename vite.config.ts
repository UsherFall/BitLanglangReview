import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { tradingReviewApiPlugin } from './src/server/app-plugin';

export default defineConfig(({ mode }) => {
  // `.env` is the local config file (gitignored). `MARKET_DATA_SOURCE` there
  // switches the coin scan off its Bitget default (binance / okx / bitget);
  // a value already set in the shell environment wins over the file.
  const env = loadEnv(mode, process.cwd(), '');
  process.env.MARKET_DATA_SOURCE ??= env.MARKET_DATA_SOURCE;
  return {
    plugins: [tradingReviewApiPlugin(), react()],
    server: {
      port: 5173,
      watch: {
        ignored: [
          '**/data/**',
          '**/*.sqlite',
          '**/*.sqlite-wal',
          '**/*.sqlite-shm',
          '**/*.log',
          '**/.trellis/**',
          '**/.scratch/**',
        ],
      },
    },
  };
});
