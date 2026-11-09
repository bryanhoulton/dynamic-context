import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

// Vercel supplies the canonical GitHub path even for builds without a .git directory.
const owner = process.env.VERCEL_GIT_REPO_OWNER;
const slug = process.env.VERCEL_GIT_REPO_SLUG;
const origin = spawnSync('git', ['remote', 'get-url', 'origin'], {
  encoding: 'utf8',
});
const repo =
  owner && slug
    ? owner + '/' + slug
    : origin.stdout
        ?.trim()
        .match(
          /^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+\/[\w.-]+?)(?:\.git)?$/,
        )?.[1];

export default defineConfig({
  define: {
    'import.meta.env.VITE_SOURCE_URL': JSON.stringify(
      repo ? 'https://github.com/' + repo : '',
    ),
  },
  plugins: [react(), tailwind()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
