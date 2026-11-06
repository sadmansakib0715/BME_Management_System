import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// BASE_PATH lets the same build serve from GitHub Pages (/<repo>/) or a domain root (/).
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { sourcemap: false, chunkSizeWarningLimit: 1300,
    rollupOptions: { output: { manualChunks: { xlsx: ['xlsx'], exceljs: ['exceljs'], supabase: ['@supabase/supabase-js'], react: ['react', 'react-dom', 'react-router-dom'] } } } },
});
