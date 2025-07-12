import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/lambda.ts', 'src/trpc.ts'],
  splitting: false,
  sourcemap: false,
  dts: true,
  clean: true,
  format: ['cjs'],
  target: 'node18',
  minify: false,
  metafile: true,
  // Only bundle flat, let OpenTelemetry packages be external
  noExternal: [/flat/],
  external: [/@opentelemetry/],
})
