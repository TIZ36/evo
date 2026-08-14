import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cordis/index.ts', 'src/deepseek/index.ts'],
  format: 'esm',
  dts: true,
  sourcemap: true,
  clean: true,
  deps: { neverBundle: [/^@deepseek-ai\//, /^node:/] },
})
