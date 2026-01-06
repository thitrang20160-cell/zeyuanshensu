import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  return {
    plugins: [react()],
    define: {
      // Safely default to empty string if undefined to prevent build crashes
      'process.env.API_KEY': JSON.stringify(env.API_KEY || '')
    }
  };
});