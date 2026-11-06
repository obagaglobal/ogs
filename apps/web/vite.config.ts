/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Phase 6b performance: the public catalogue is the landing page on phones.
 * Its route is lazy, so without help the browser only learns about its chunks
 * after the entry bundle has run. This adds <link rel="modulepreload"> for
 * that route and its static imports, so they download in parallel.
 */
function preloadRoute(moduleSuffix: string): Plugin {
  return {
    name: 'ogs-preload-route',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, context) {
        const bundle = context.bundle;
        if (bundle === undefined) return [];
        const chunks = Object.values(bundle).filter((output) => output.type === 'chunk');
        const entry = chunks.find((chunk) => chunk.facadeModuleId?.endsWith(moduleSuffix));
        if (entry === undefined) return [];
        const files = new Set<string>();
        const visit = (fileName: string) => {
          if (files.has(fileName)) return;
          files.add(fileName);
          const chunk = chunks.find((candidate) => candidate.fileName === fileName);
          chunk?.imports.forEach(visit);
        };
        visit(entry.fileName);
        const main = chunks.find((chunk) => chunk.isEntry);
        if (main) files.delete(main.fileName);
        return [...files]
          .filter((fileName) => !html.includes(`/${fileName}`))
          .map((fileName) => ({
            tag: 'link',
            attrs: { rel: 'modulepreload', crossorigin: true, href: `/${fileName}` },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  // Non-VITE_ variables are only visible to this config (dev server), never to browser code.
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env['API_PROXY_TARGET'] ?? 'http://127.0.0.1:3000';

  return {
    plugins: [react(), tailwindcss(), preloadRoute('src/features/catalogue/public-pages.tsx')],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    // `vite preview` serves the production build for Lighthouse CI; it proxies
    // /api like the dev server (NGINX does this in deployed environments).
    preview: {
      port: 4173,
      strictPort: true,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      restoreMocks: true,
      css: false,
      // Lazy route chunks are transformed on first use; under a parallel
      // `pnpm check` that can push long form tests past the 5 s default.
      testTimeout: 15_000,
    },
  };
});
