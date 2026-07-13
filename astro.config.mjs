import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

export default defineConfig({
  site: 'https://amerispro.com',
  base: '/',
  outDir: './dist',
  output: 'server',
  adapter: vercel(),
  build: {
    format: 'directory'
  }
});
