import { assertEquals } from '@std/assert'
import { parseEnvFileText } from 'commands/space/dev/action.ts'

Deno.test('parseEnvFileText: keeps a key with a hyphen, which @std/dotenv drops', () => {
  const env = parseEnvFileText(
    "PORT=20204\nJWK_PRI_ops-console='abc=='\nSERVICE_PERMISSIONS_admin-hub=zanix:admin\n",
  )

  assertEquals(env, {
    PORT: '20204',
    'JWK_PRI_ops-console': 'abc==',
    'SERVICE_PERMISSIONS_admin-hub': 'zanix:admin',
  })
})

Deno.test('parseEnvFileText: a hyphenated key with several hyphens, `export` and spaces around =', () => {
  const env = parseEnvFileText("export JWK_PUB_a-b-c = 'v1'\nOTHER = two\n")

  assertEquals(env['JWK_PUB_a-b-c'], 'v1')
  assertEquals(env.OTHER, 'two')
})

Deno.test('parseEnvFileText: a hyphen in a value or a comment is left alone, and plain files parse as before', () => {
  const env = parseEnvFileText("# NOT_A-KEY=1\nURL=http://my-host:80/some-path\nQUOTED='a-b=c'\n")

  assertEquals(env, { URL: 'http://my-host:80/some-path', QUOTED: 'a-b=c' })
  assertEquals(parseEnvFileText(''), {})
})
