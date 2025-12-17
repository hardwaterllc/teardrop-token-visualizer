import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@tokens': path.resolve(__dirname, 'src/lib/mana/tokens.json')
    }
  },
  server: {
    port: 3002,
    open: true,
    strictPort: false
  },
  publicDir: 'public',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React and React DOM into separate chunk
          'react-vendor': ['react', 'react-dom'],
          // Split Radix UI components into separate chunk
          'radix-ui': [
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-icons'
          ],
          // Split force graph library into separate chunk
          'force-graph': ['react-force-graph-2d']
        }
      }
    },
    // Increase chunk size warning limit since we're splitting manually
    chunkSizeWarningLimit: 600
  }
});

