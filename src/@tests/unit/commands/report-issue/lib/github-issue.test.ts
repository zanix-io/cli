import { assertEquals, assertRejects } from '@std/assert'
import { stub } from '@std/testing/mock'
import {
  createGithubIssue,
  findExistingOpenIssue,
  GITHUB_ORG,
  GITHUB_TOKEN_ENV,
} from 'commands/report-issue/lib/github-issue.ts'

/**
 * Every one of these stubs `globalThis.fetch` (same precedent as
 * `commands/new/lib/tree/info.ts`'s own tests) — a real network call against
 * `https://api.github.com` here would either fail in CI (no real token) or, worse, actually file
 * spam issues against a real `zanix-io` repo. Never removed, never bypassed.
 */

const originalToken = Deno.env.get(GITHUB_TOKEN_ENV)

function restoreToken() {
  if (originalToken === undefined) Deno.env.delete(GITHUB_TOKEN_ENV)
  else Deno.env.set(GITHUB_TOKEN_ENV, originalToken)
}

Deno.test(
  'createGithubIssue throws a clear, actionable error (never a silent no-op) when GITHUB_TOKEN is unset',
  async () => {
    Deno.env.delete(GITHUB_TOKEN_ENV)
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => {
        throw new Error('fetch must never be called when the token is missing')
      },
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'claude-skills', title: 'a finding' }),
        Error,
        GITHUB_TOKEN_ENV,
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'createGithubIssue surfaces a named-repo 404 as "repository not found", not a raw HTTP error',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('{"message":"Not Found"}', { status: 404 }),
        ),
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'does-not-exist', title: 'a finding' }),
        Error,
        `'${GITHUB_ORG}/does-not-exist' was not found`,
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  "createGithubIssue surfaces GitHub's own error body (not a generic message) on a 401",
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-invalid-token')
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('{"message":"Bad credentials"}', { status: 401 }),
        ),
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'claude-skills', title: 'a finding' }),
        Error,
        'Bad credentials',
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  "createGithubIssue surfaces GitHub's own error body on a 403 too (e.g. an unknown --label)",
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('{"message":"Resource not accessible by integration"}', { status: 403 }),
        ),
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'claude-skills', title: 'a finding' }),
        Error,
        'Resource not accessible by integration',
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'createGithubIssue surfaces any other non-2xx status with the real HTTP status + body',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response('{"message":"Validation Failed"}', { status: 422 }),
        ),
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'claude-skills', title: 'a finding' }),
        Error,
        'HTTP 422',
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'createGithubIssue surfaces a failed POST (create) with the "create an issue" action, ' +
    'distinct from a failed GET (dedup lookup) — reached only once the dedup lookup itself ' +
    'succeeds with no match',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')
    const fetchStub = stub(
      globalThis,
      'fetch',
      (_input: RequestInfo | URL, init?: RequestInit) => {
        if (!init?.method || init.method === 'GET') {
          return Promise.resolve(new Response('[]', { status: 200 }))
        }
        return Promise.resolve(
          new Response('{"message":"Validation Failed"}', { status: 422 }),
        )
      },
    )

    try {
      await assertRejects(
        () => createGithubIssue({ repo: 'claude-skills', title: 'a finding' }),
        Error,
        `create an issue on 'zanix-io/claude-skills' failed (HTTP 422)`,
      )
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'createGithubIssue runs the dedup lookup first (GET), then posts title/body/labels (POST) ' +
    'and resolves the real created issue URL when no open duplicate exists',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')

    const calls: Array<{ url: string; init?: RequestInit }> = []

    const fetchStub = stub(
      globalThis,
      'fetch',
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : input.toString()
        calls.push({ url, init })

        if (!init?.method || init.method === 'GET') {
          // The dedup lookup — no open issues, so nothing matches.
          return Promise.resolve(new Response('[]', { status: 200 }))
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({ html_url: 'https://github.com/zanix-io/claude-skills/issues/42' }),
            { status: 201 },
          ),
        )
      },
    )

    try {
      const result = await createGithubIssue({
        repo: 'claude-skills',
        title: 'A stale skill claim',
        body: 'file:line evidence',
        labels: ['bug', 'from-agent'],
      })

      assertEquals(result.htmlUrl, 'https://github.com/zanix-io/claude-skills/issues/42')
      assertEquals(result.alreadyExists, false)
      assertEquals(calls.length, 2)

      assertEquals(
        calls[0].url,
        `https://api.github.com/repos/${GITHUB_ORG}/claude-skills/issues?state=open&per_page=100`,
      )

      const createCall = calls[1]
      assertEquals(
        createCall.url,
        `https://api.github.com/repos/${GITHUB_ORG}/claude-skills/issues`,
      )
      assertEquals(createCall.init?.method, 'POST')

      const headers = createCall.init?.headers as Record<string, string>
      assertEquals(headers['Authorization'], 'Bearer stubbed-token')
      assertEquals(headers['Accept'], 'application/vnd.github+json')

      const body = JSON.parse(createCall.init?.body as string)
      assertEquals(body, {
        title: 'A stale skill claim',
        body: 'file:line evidence',
        labels: ['bug', 'from-agent'],
      })
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'createGithubIssue skips creation and returns the existing URL when an OPEN issue with the ' +
    'exact same title already exists — never calls POST',
  async () => {
    Deno.env.set(GITHUB_TOKEN_ENV, 'stubbed-token')

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
              { title: 'Some other finding', html_url: 'https://github.com/zanix-io/cli/issues/1' },
              {
                title: 'A recurring finding',
                html_url: 'https://github.com/zanix-io/cli/issues/7',
              },
            ]),
            { status: 200 },
          ),
        )
      },
    )

    try {
      const result = await createGithubIssue({ repo: 'cli', title: 'A recurring finding' })

      assertEquals(postCalled, false)
      assertEquals(result.alreadyExists, true)
      assertEquals(result.htmlUrl, 'https://github.com/zanix-io/cli/issues/7')
    } finally {
      fetchStub.restore()
      restoreToken()
    }
  },
)

Deno.test(
  'findExistingOpenIssue returns undefined when no OPEN issue has the exact same title',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify([{ title: 'A different finding', html_url: 'https://x/1' }]),
            { status: 200 },
          ),
        ),
    )

    try {
      const result = await findExistingOpenIssue('cli', 'A recurring finding', 'stubbed-token')
      assertEquals(result, undefined)
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'findExistingOpenIssue ignores pull requests even when a PR title exactly matches — a PR is ' +
    'not a duplicate issue',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () =>
        Promise.resolve(
          new Response(
            JSON.stringify([
              {
                title: 'A recurring finding',
                html_url: 'https://github.com/zanix-io/cli/pull/9',
                pull_request: { url: 'https://api.github.com/.../pulls/9' },
              },
            ]),
            { status: 200 },
          ),
        ),
    )

    try {
      const result = await findExistingOpenIssue('cli', 'A recurring finding', 'stubbed-token')
      assertEquals(result, undefined)
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'findExistingOpenIssue requests only OPEN issues, up to 100 per page, under the exact repo',
  async () => {
    let capturedUrl = ''
    const fetchStub = stub(
      globalThis,
      'fetch',
      (input: RequestInfo | URL) => {
        capturedUrl = input instanceof Request ? input.url : input.toString()
        return Promise.resolve(new Response('[]', { status: 200 }))
      },
    )

    try {
      await findExistingOpenIssue('server', 'anything', 'stubbed-token')
      assertEquals(
        capturedUrl,
        `https://api.github.com/repos/${GITHUB_ORG}/server/issues?state=open&per_page=100`,
      )
    } finally {
      fetchStub.restore()
    }
  },
)

Deno.test(
  'findExistingOpenIssue surfaces a failed list request the same way createGithubIssue surfaces ' +
    'a failed create (named-repo 404, not a raw HTTP error)',
  async () => {
    const fetchStub = stub(
      globalThis,
      'fetch',
      () => Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 })),
    )

    try {
      await assertRejects(
        () => findExistingOpenIssue('does-not-exist', 'anything', 'stubbed-token'),
        Error,
        `'${GITHUB_ORG}/does-not-exist' was not found`,
      )
    } finally {
      fetchStub.restore()
    }
  },
)
