import { getPathFromCurrent, isFileUrl } from '@zanix/helpers'

/** How many times a transient remote-fetch failure gets retried before this function gives up on
 * it — a real connection reset or a `5xx` from a CDN edge is common enough over a real
 * `jsr.io`/GitHub-hosted fetch that a single attempt shouldn't be the difference between a real
 * `zanix new`/`zanix prepare` scaffold succeeding or falling back to a degraded/failed state. A
 * genuine `4xx` (a real "not found"/"forbidden" — the URL/path itself is wrong, not the network)
 * is never retried: no number of attempts changes that answer, and retrying it only delays the
 * real error every caller already handles. */
const MAX_FETCH_ATTEMPTS = 3
/** Base delay between retries, in ms — doubled per attempt (`200`, `400`, `800`, ...: standard
 * exponential backoff), so a genuinely down/overloaded host gets progressively more room rather
 * than being hammered at a fixed (or merely linearly growing) interval. */
const RETRY_DELAY_MS = 200

/** Fetches `url`, retrying only what a retry can plausibly fix: `fetch()` itself throwing (DNS,
 * connection reset, TLS) or a `5xx` response (the server's own transient failure) — up to
 * {@linkcode MAX_FETCH_ATTEMPTS} total attempts, with a short growing delay between them. A `4xx`
 * response is returned immediately, on the first attempt, exactly as a plain `fetch()` would —
 * {@linkcode readFileFromCurrentUrl}'s own `!response.ok` check still produces the identical error
 * for it, just without a pointless delay first. The LAST attempt's own result (or thrown error) is
 * always returned/rethrown as-is, network or not, so the caller's own error message is never
 * masked by this function's retry bookkeeping. */
async function fetchWithRetry(url: string): Promise<Response> {
  let lastNetworkError: unknown
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      // deno-lint-ignore no-await-in-loop
      const response = await fetch(url)
      const isLastAttempt = attempt === MAX_FETCH_ATTEMPTS
      if (response.ok || response.status < 500 || isLastAttempt) return response
    } catch (error) {
      lastNetworkError = error
      if (attempt === MAX_FETCH_ATTEMPTS) throw error
    }
    // deno-lint-ignore no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 2 ** (attempt - 1)))
  }
  // Unreachable in practice (the loop above always returns or throws on its own last iteration) —
  // satisfies the compiler's own control-flow analysis, which can't see that guarantee statically.
  throw lastNetworkError ?? new Error(`fetchWithRetry: exhausted all attempts for '${url}'`)
}

/**
 * Reads the contents of a `file` from a given `URL`, either from the local filesystem or over
 * HTTP/HTTPS. Lives in `cli`, not `@zanix/utils` — shared by `cli`'s own `zanix new`
 * project-tree scaffolding and `zanix prepare`'s git/editor scaffolding, its only real consumers
 * ecosystem-wide.
 *
 * Throws (never returns a fallback value) when the remote fetch itself fails to connect, and also
 * throws — naming the URL and the real HTTP status — for a non-OK response (404/500/JSR down).
 * A non-OK response is a real failure every caller must not silently absorb: a fallback empty
 * string would get written straight to disk as a 0-byte file, with `zanix new`/`zanix prepare`
 * still reporting success. A transient connection failure or `5xx` is retried a few times first
 * (see {@linkcode fetchWithRetry}) — a real scaffold shouldn't fail outright, or silently degrade
 * a `--icons`/`--theme` step, over one momentary network blip.
 */
export async function readFileFromCurrentUrl(
  url: string,
  relativeFromPath: string,
): Promise<string> {
  const currentUrl = getPathFromCurrent(url, relativeFromPath)

  if (isFileUrl(url)) return Deno.readTextFile(currentUrl)

  const response = await fetchWithRetry(currentUrl)

  if (!response.ok) {
    throw new Error(
      `Failed to fetch '${currentUrl}': ${response.status} ${response.statusText}`,
    )
  }

  return response.text()
}
