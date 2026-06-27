import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom', '@mediapipe/tasks-vision'],
  // Injects 'use client' at the top of every output file.
  // Required for Next.js App Router to treat the package as a client boundary.
  banner: {
    js: "'use client';",
  },
  esbuildOptions(options) {
    // Preserve JSX for React consumers to handle
    options.jsx = 'automatic';
  },
});