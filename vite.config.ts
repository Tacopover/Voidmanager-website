/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site is served from /<repo>/.
// Repo: github.com/Tacopover/Voidmanager-website
export default defineConfig({
  base: '/Voidmanager-website/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
});
