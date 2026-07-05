import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://amerispro.com',
  base: '/',
  outDir: './dist',
  build: {
    format: 'file'
  }
});
