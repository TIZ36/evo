import { defineConfig } from 'tsdown'

/**
 * The plugin half ships as one dependency-free file. Claude Code installs a
 * plugin by copying the repository — it runs no build, and only restores npm or
 * bun lockfiles, never pnpm — so a checkout has to be runnable as it stands.
 */
export default defineConfig({
  entry: { hook: 'src/hook/cli.ts' },
  outDir: 'plugin/bin',
  format: 'esm',
  dts: false,
  sourcemap: false,
  clean: false,
  noExternal: [/.*/],
  platform: 'node',
})
