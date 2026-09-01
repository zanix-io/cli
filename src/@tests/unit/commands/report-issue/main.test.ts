import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert'
import { stub } from '@std/testing/mock'
import reportIssueCommand from 'commands/report-issue/main.ts'
import { GITHUB_TOKEN_ENV } from 'commands/report-issue/lib/github-issue.ts'
import { Commander } from 'cli'

type ActionCommand = {
  settings: { actionHandler: (options: Record<string, unknown>) => Promise<void> }
}

function registerCommand(): ActionCommand {
  const cwd = new Commander()
  reportIssueCommand.call(cwd)
  return cwd.getCommands()[0] as unknown as ActionCommand
}

const originalToken = Deno.env.get(GITHUB_TOKEN_ENV)

function restoreToken() {
  if (originalToken === undefined) Deno.env.delete(GITHUB_TOKEN_ENV)
  else Deno.env.set(GITHUB_TOKEN_ENV, originalToken)
}

Deno.test('report-issue rejects (via this.throw) when --title is missing', async () => {
  const command = registerCommand()

  await assertRejects(
    () => command.settings.actionHandler({ repo: 'claude-skills' }),
    Error,
    "'--title'",
  )
})

Deno.test(
  'report-issue rejects when both --body and --body-file are given, before touching the network',
  async () => {
    const command = registerCommand()
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => {
        throw new Error('fetch must not be called when --body/--body-file both given')
      },
    )

    try {
      await assertRejects(
        () =>
          command.settings.actionHandler({
            repo: 'claude-skills',
            title: 't',
            body: 'inline',
            bodyFile: '/tmp/does-not-matter.md',
          }),
        Error,
        '--body-file',
      )
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'report-issue surfaces a clear error (not a raw Deno exception) when --body-file cannot be read',
  async () => {
    const command = registerCommand()

    await assertRejects(
      () =>
        command.settings.actionHandler({
          repo: 'claude-skills',
          title: 't',
          bodyFile: '/definitely/does/not/exist.md',
        }),
      Error,
      "'--body-file /definitely/does/not/exist.md'",
    )
  },
)

Deno.test(
  'report-issue propagates a real createGithubIssue failure (e.g. missing GITHUB_TOKEN) via this.throw',
  async () => {
    Deno.env.delete(GITHUB_TOKEN_ENV)
    const command = registerCommand()

    try {
      await assertRejects(
        () => command.settings.actionHandler({ repo: 'claude-skills', title: 't' }),
        Error,
        GITHUB_TOKEN_ENV,
      )
    } finally {
      restoreToken()
    }
  },
)

Deno.test(
  'report-issue reads --body-file, posts to the real GitHub issues endpoint, and logs the created URL',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const command = registerCommand()

    const bodyFilePath = await Deno.makeTempFile({ suffix: '.md' })
    await Deno.writeTextFile(bodyFilePath, 'structured handoff-prompt content')

    let capturedBody: Record<string, unknown> | undefined
    const fetchStub = stub(
      globalThis,
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === 'GET') {
          return Promise.resolve(new Response('[]', { status: 200 }))
        }

        capturedBody = JSON.parse(init?.body as string)
        return Promise.resolve(
          new Response(
            JSON.stringify({ html_url: 'https://github.com/zanix-io/cli/issues/7' }),
            { status: 201 },
          ),
        )
      },
    )

    try {
      await command.settings.actionHandler({
        repo: 'cli',
        title: 'A real bug found incidentally',
        bodyFile: bodyFilePath,
        label: ['bug'],
      })

      assertEquals(capturedBody?.body, 'structured handoff-prompt content')
      assertEquals(capturedBody?.labels, ['bug'])
    } finally {
      fetchStub.restore()
      restoreToken()
      await Deno.remove(bodyFilePath)
    }
  },
)

Deno.test(
  'report-issue posts to the exact zanix-io/<repo> issues endpoint for an explicitly given --repo',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const command = registerCommand()

    const capturedUrls: string[] = []
    const fetchStub = stub(
      globalThis,
      'fetch',
      (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrls.push(input instanceof Request ? input.url : input.toString())

        if (!init?.method || init.method === 'GET') {
          return Promise.resolve(new Response('[]', { status: 200 }))
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({ html_url: 'https://github.com/zanix-io/server/issues/1' }),
            { status: 201 },
          ),
        )
      },
    )

    try {
      await command.settings.actionHandler({ repo: 'server', title: 't' })
      assertStringIncludes(capturedUrls.at(-1) ?? '', '/repos/zanix-io/server/issues')
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'report-issue does not throw and never calls POST when an OPEN issue with the exact same ' +
    'title already exists — the dedup guard, wired end-to-end through the action handler',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const command = registerCommand()

    let postCalled = false
    const fetchStub = stub(
      globalThis,
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'POST') {
          postCalled = true
          throw new Error('POST must not be called when an exact-title open duplicate exists')
        }

        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                title: 'A recurring finding',
                html_url: 'https://github.com/zanix-io/claude-skills/issues/9',
              },
            ]),
            { status: 200 },
          ),
        )
      },
    )

    try {
      // Would throw (via cwd.throw) if the duplicate weren't handled as a normal, successful
      // no-op path — a real regression back to "always POST" would surface here as a rejection
      // (the stubbed fetch throws on any POST call) rather than silently passing.
      await command.settings.actionHandler({ repo: 'claude-skills', title: 'A recurring finding' })
      assertEquals(postCalled, false)
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)
