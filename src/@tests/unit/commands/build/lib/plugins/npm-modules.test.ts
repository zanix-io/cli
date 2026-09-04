import { assertEquals } from '@std/assert'
import { npmModulesPlugin } from 'commands/build/lib/plugins/npm-modules.ts'

Deno.test('npmModulesPlugin marks known and custom libraries as external', () => {
  const plugin = npmModulesPlugin(['my-custom-lib'])

  let resolveCallback: (args: { path: string }) => unknown = () => undefined
  plugin.setup({
    // deno-lint-ignore no-explicit-any
    onResolve: (_filter: unknown, callback: any) => {
      resolveCallback = callback
    },
    // deno-lint-ignore no-explicit-any
  } as any)

  assertEquals(resolveCallback({ path: 'esbuild' }), {
    external: true,
    path: 'npm:esbuild',
  })
  assertEquals(resolveCallback({ path: 'my-custom-lib' }), {
    external: true,
    path: 'npm:my-custom-lib',
  })
  assertEquals(resolveCallback({ path: './local-file.ts' }), null)
})
