# Deploying a Zanix app

Packaging is **destination-agnostic** — nothing in the Zanix ecosystem assumes a
specific hosting provider. The real deploy artifact, regardless of where it
runs, is always the same two things a project already has once scaffolded:

- The project's own `mod.ts` — imports the app's manifest and calls
  `bootstrapServers()`/ `Zanix.start()` from `@zanix/server`/`@zanix/core`.
  `@zanix/space` itself never calls `Deno.serve()` — that stays exclusively
  `@zanix/server`'s job, whether the app runs embedded alongside others or
  standalone in its own process.
- The `start` task already declared in the project's own `deno.json`
  (`baseZnxConfig`) —
  `deno run --env-file=.env --allow-net --allow-env --allow-read --allow-sys --allow-write
  --allow-ffi --no-prompt mod.ts`,
  or simply `deno task start`.

**One exception: a `@zanix/app`-based (`'app'` project type) standalone Zanix
App.** Its own `mod.ts` only exports a manifest — never runnable on its own. Its
real deploy artifact is instead `serve.ts` (a `bootstrapRemoteApp` call,
scaffolded by `zanix prepare --docker -p app` — see below) and the matching
`serve` task, but the packaging story is otherwise identical: same two-stage
Docker template, same "destination-agnostic, no code changes to move between
them" guarantee.

Whichever destination is chosen, **no code changes are required** to move
between them.

## Docker

```bash
zanix prepare --docker -p server   # or: space, space-server, app
```

Generates a `Dockerfile` (two-stage: a cached dependency layer, then the runtime
image — see [`prepare.md`](./prepare.md#-d---docker) for exactly what each
project type produces) and a `.dockerignore` at the project root. Build and run
it like any other container:

```bash
docker build -t my-app .
docker run -p 8000:8000 --env-file .env my-app
```

Docker is a first-class citizen here, but it is **not the assumed default** —
deliberately, so a future destination change never means rewriting application
code. (Deno Deploy Classic is being retired on **2026-07-20**, and the newer
Deploy product still has undocumented gray areas around instance statefulness
and unsupported queues — betting the whole deployment story on one provider,
even the runtime's own vendor, would repeat the exact lock-in Next.js took three
years and an adapters API to walk back from.)

### What the `space`/`space-server` runtime image actually ships

The BUILD stage still copies the whole project (`COPY . .`) — `zanix space
build` needs the full source, `theme/`, `assetsDir`, and `messagesDir` to
produce `.dist/client`. The RUNTIME stage does not: it copies only `src/`
(`@zanix/space`'s SSR side runs directly against source — a page/Comet's own
`.tsx` is `import()`-ed by its real path at request time, so there is no
server-side bundle to substitute it with), `deno.json(c)`/`deno.lock`
(the bare-specifier import map `deno run` needs, plus lockfile verification),
`mod.ts`/`space.app.ts`, and the compiled `.dist/client` output from the
build stage.

**Deliberately excluded from the runtime image, because production never
reads any of it once built**: `theme/` (`globalCss` source — the runtime
reads `.dist/client/css-manifest.json` and the already-hashed CSS instead),
`messages/` (raw `messagesDir` ICU source — once `clientBuildDir` is
configured, `loadMessages()` reads `.dist/client/messages/...` exclusively;
see [`@zanix/space`'s own `docs/i18n.md`](https://github.com/zanix-io/space/blob/master/docs/i18n.md)),
`assets/` (raw `assetsDir` source — `assetsPlugin` already emits every file
under it into `.dist/client/assets/` at build time; `AssetsRoute.serve()`
tries that build output FIRST, so a raw copy is a straight duplicate for the
common case, and `COPY` has no "skip if missing" mode, so it fails outright
for a project with no real `assetsDir` at all), and
`docs/`/`README.md`/`CHANGELOG.md`/`LICENSE`/`src/@tests/` (never imported
by any runtime code path). Only add a `COPY assets ./assets` line back to
the generated `Dockerfile` if this project's own code deliberately
references a stable/hardcoded asset path that bypasses `resolveAssetHref()`
— rare, and worth a comment of its own explaining why, since it diverges
from the generated default.

### Running the worker process

A `server`/`space-server` project (never plain `space`) also gets a separate
`worker.ts` entrypoint and a `worker` task (`deno task worker`) —
`Zanix.startWorker()`, a standalone AsyncMQ background- jobs process with no
HTTP server at all, always its own process, never the same one `start` runs.

The generated `Dockerfile` doesn't try to pick between `start`/`worker` on its
own (e.g. via some platform-specific env var like Heroku's `$DYNO`) — that would
bake a provider-specific convention into an otherwise destination-agnostic
image. Instead, **the same image serves both roles**; the deployment target
picks which command to run, overriding the image's own default `CMD`:

```bash
# One-off / plain Docker: two containers from the same image, different commands
docker run --env-file .env -p 8000:8000 my-app                    # web (default CMD)
docker run --env-file .env my-app deno task worker                # worker (CMD override)
```

```yaml
# docker-compose.yml — two services, one image
services:
  web:
    image: my-app
    ports: ['8000:8000']
  worker:
    image: my-app
    command: deno task worker
```

```yaml
# Kubernetes — a separate Deployment for the worker, same image, command override
containers:
  - name: worker
    image: my-app
    command: ['deno', 'task', 'worker']
```

```yaml
# heroku.yml — same idea again: one build, `run` overrides the command per process type.
# `run.web` can be omitted (falls back to the image's own default CMD); only `worker` needs it.
build:
  docker:
    web: Dockerfile
    worker: Dockerfile
run:
  worker: deno task worker
```

## A bare Deno host / VM

No packaging step needed at all — the project already runs as-is:

```bash
deno install    # only if using @zanix/space's real npm deps (Vite/React/Tailwind/sharp)
zanix space build   # only for space/space-server, before the first start
deno task start
```

Put this behind any reverse proxy/process manager (systemd, pm2-for-Deno
equivalents, etc.) the same way you would any other long-running server process.
If the project has a `worker` task (`server`/`space-server`), run
`deno task worker` as its own separate process/service unit — never in the same
process as `start`.

## Deno Deploy

Point Deno Deploy at `mod.ts` directly — no Docker step required. Same caveats
as above apply (retiring Classic tier, undocumented gray areas on the newer
product) — evaluate before committing to it as the only destination.

## Media transcoding

Only relevant if the project's own code calls `@zanix/space`'s `VideoTranscoder`
(`createSystemFfmpegTranscoder()`/`createCachedVideoTranscoder()`, in
`@zanix/space/media`) — video transcoding (`transcode()`) or thumbnail
extraction (`extractThumbnail()`). Harmless, unused weight otherwise: nothing
in `@zanix/space` calls this on its own.

**Three distinct phases, never conflated:**

1. **This project's own build** (`zanix space build`, run inside the
   `Dockerfile`'s own build stage, or directly on a bare host) — builds the
   client bundle (comets, CSS, PWA, hashed static assets via `assetsPlugin`).
   It never touches `ffmpeg` at all: video files under `assetsDir` are hashed
   and copied like any other static asset (see `assetsPlugin`'s own doc) —
   transcoding is a separate, opt-in, RUNTIME concern (`mediaPlugin`/a future
   Asset API), never a step this build performs on its own.
2. **Docker image provisioning** (this Dockerfile's own runtime-stage `RUN`,
   below) — installs the `ffmpeg` **binary** into the image and verifies its
   capabilities, once, at `docker build` time. This is infrastructure
   provisioning, not media processing: no video file is ever transcoded here,
   no `VideoTranscoder` code runs here at all.
3. **`SystemFfmpegTranscoder`'s own runtime** (`transcode()`/
   `extractThumbnail()`, called by this project's own request-handling or
   background-job code, whenever it actually runs) — the one place `ffmpeg`
   is genuinely invoked against a real file. It only detects and invokes
   whatever is already on `PATH` (`probeFfmpegAvailability()`,
   `@zanix/space`'s `modules/media/ffmpeg-availability.ts`) — it never
   installs, downloads, or provisions the binary itself, in TypeScript or
   otherwise. Phase 2 is what makes phase 3 possible in Docker; the two never
   overlap in time or in which process runs them.

Provisioning the binary (phase 2) is entirely this project's/this deploy
target's own job, per target:

- **Docker** — already provisioned. `zanix prepare --docker -p space` (or
  `space-server`)'s generated `Dockerfile` installs `ffmpeg` via
  `apt-get install ffmpeg` in its runtime stage, on top of the
  `denoland/deno` base image (Debian) — the SAME image `SystemFfmpegTranscoder`
  actually runs in at request/job time (phase 3), never a different one. No
  extra step needed.
- **A bare Deno host / VM** — the operator's own responsibility. Install
  `ffmpeg`/`ffprobe` on the host (matching the OS's own package manager) before
  running `deno task start`; `RUN_PERMISSIONS` already grants the generated
  `start`/`worker` tasks `--allow-run=ffmpeg,ffprobe`, so no permission flag
  needs adding by hand — only the binary itself.
- **Deno Deploy** — **unsupported**, not a configuration gap: Deno Deploy's
  standard request runtime disables `Deno.Command` (subprocess spawning)
  entirely, so no `ffmpeg` invocation is possible there regardless of
  provisioning. `probeFfmpegAvailability()` reports this explicitly
  (`reason: 'unsupported-runtime'`) rather than failing unhelpfully. Use
  Docker or a bare Deno host/VM for anything that needs to transcode video.

### Required capabilities — verified at `docker build` time, not assumed

`SystemFfmpegTranscoder` depends on five real `ffmpeg` capabilities, never
just "ffmpeg is installed":

- `libx264`, `aac`, `libvpx-vp9`, `libopus` — the baseline
  `REQUIRED_ENCODERS` (`modules/media/ffmpeg-availability.ts`) every
  `transcode()` call needs. Missing any one of these makes the WHOLE
  transcoder report `available: false` at runtime (`reason:
  'incompatible-binary'`) — every call, silently, until fixed.
- `libwebp` — required specifically for `extractThumbnail({ format: 'webp'
  })`. An officially supported thumbnail format, on the same footing as
  `jpeg`/`png` — **never** a feature that silently degrades depending on
  which `ffmpeg` build happens to be installed, and **never** a silent
  fallback to `jpeg`/`png` when unavailable.

**Docker guarantees all five, and verifiably so — the build itself fails if
any of them ever stops being true.** The generated `Dockerfile`'s `ffmpeg`
install step is immediately followed by:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && command -v ffmpeg > /dev/null \
  && command -v ffprobe > /dev/null \
  && for encoder in libx264 aac libvpx-vp9 libopus libwebp; do \
    ffmpeg -hide_banner -encoders 2>/dev/null | grep -q "$encoder" \
      || (echo "FATAL: this image's ffmpeg build is missing the '$encoder' encoder" >&2 && exit 1); \
  done
```

Confirmed empirically against a real `docker build` (not assumed): the
`denoland/deno` base image is Debian trixie, whose own
`apt-get install ffmpeg` already ships a build with all five — and the
assertion itself genuinely fails the build (verified by deliberately naming a
nonexistent encoder and confirming `docker build` exits non-zero with the
`FATAL:` message). This turns a silent, future loss of that guarantee (e.g. a
base image bump landing on a Debian release/package build that drops one of
them) into a loud, immediate `docker build` failure at this exact step —
never a runtime surprise discovered later inside a request handler. No
TypeScript code anywhere in `@zanix/space`/`@zanix/cli` installs or downloads
`ffmpeg` — this shell assertion, at image-build time, is the only place any
of the five capabilities is ever verified before the image ships.

**A bare host is not automatically covered** — capability support depends
entirely on how that host's own `ffmpeg` was built (e.g. a default Homebrew
`ffmpeg` on macOS ships `libx264`/`aac`/`libvpx-vp9`/`libopus` but **not**
`libwebp`; confirmed empirically). Verify the host's own build first:

```bash
ffmpeg -hide_banner -encoders | grep -E "libx264|aac|libvpx-vp9|libopus|libwebp"
```

**What happens when a capability is missing, at runtime (phase 3):**
`transcode()`/`extractThumbnail()` check this explicitly, before ever
invoking `ffmpeg` for real work, and throw a specific, actionable error —
never a raw `ffmpeg` stderr dump, and (for `webp` specifically) never a
silently produced `jpg`/`png` instead of the requested format:

```
InternalError: System ffmpeg is missing WebP encoder support (libwebp) — required for
extractThumbnail with format: 'webp'. Install/use an ffmpeg build with libwebp enabled
(the Docker image this framework provisions already includes it).
```

`jpeg`/`png` thumbnails are entirely unaffected by a missing `libwebp` — only
a `format: 'webp'` request is ever blocked by that specific check.

## Graceful shutdown

`Zanix.start()`/`bootstrap()` traps `SIGINT`/`SIGTERM` automatically (no
opt-out) — either signal drains in-flight HTTP requests via `Deno.serve()`'s own
`.shutdown()`, closes connector connections, then exits. This is exactly
Docker's/Kubernetes' own default stop signal — no extra config needed on either
side. `Zanix.startWorker()`'s own worker process has always trapped both signals
the same way.

## Health checks

`GET /health` (liveness, always a cheap `200`) and `GET /ready` (readiness —
every registered core connector's `isReady`/`isHealthy`, `200`/`503`) are
registered automatically, on by default, on every port a `server`/`space-server`
project ends up serving real content on — no scaffolding step, no code change
needed. Point a container orchestrator's health probe at either directly:

```yaml
# Kubernetes — same port the app already serves on
livenessProbe:
  httpGet: { path: /health, port: 8000 }
readinessProbe:
  httpGet: { path: /ready, port: 8000 }
```

`zanix prepare --docker`'s own generated `Dockerfile` deliberately does **not**
bake in a Docker `HEALTHCHECK` instruction — the same image serves both `web`
and `worker` (see "Running the worker process" above), and `worker` never runs
an HTTP server at all, so a `HEALTHCHECK` baked into the shared image would
report that container permanently unhealthy. Add it per service instead, only on
`web` — the generated base image has no `curl`/`wget` (`debian:stable-slim`), so
use `deno` itself, already in the image:

```yaml
# docker-compose.yml — healthcheck on `web` only, never on `worker`
services:
  web:
    image: my-app
    ports: ['8000:8000']
    healthcheck:
      test: [
        'CMD',
        'deno',
        'eval',
        "Deno.exit((await fetch('http://localhost:8000/health')).ok ? 0 : 1)",
      ]
      interval: 10s
      timeout: 3s
      retries: 3
  worker:
    image: my-app
    command: deno task worker
```

**No `docker-compose`?** The same `test` command works as `docker run`'s own
`--health-*` flags — still only on the `web` container, never on `worker`:

```bash
docker run -d -p 8000:8000 --env-file .env \
  --health-cmd="deno eval \"Deno.exit((await fetch('http://localhost:8000/health')).ok ? 0 : 1)\"" \
  --health-interval=10s --health-timeout=3s --health-retries=3 \
  my-app
docker run -d --env-file .env my-app deno task worker   # worker: no --health-* flags at all
```

Kubernetes needs neither `docker-compose` nor `docker run` flags — its
`livenessProbe`/ `readinessProbe` (above) are declared directly on the **web**
Deployment's own manifest, so the same "never on the worker" rule is just "never
add these two keys to the worker Deployment's spec."

Heroku's Common Runtime has no `heroku.yml` equivalent to Docker's `HEALTHCHECK`
— it restarts a dyno on process crash/repeated boot timeout, not on an ongoing
HTTP probe, so there's nothing to wire `/health`/`/ready` into there; they're
still reachable manually if you want to watch them yourself (an uptime monitor,
etc.).

Disable (`server.health = false`), move (`path`/`readyPath`), or extend
(`checks`) this from the project's own `mod.ts` — see `@zanix/server`'s own
README ("Health & Readiness") for the full shape.

## See also

- [`prepare`](./prepare.md) — the `--docker` flag itself.
- [`build`](./build.md) — `zanix build`/`zanix space build`, what a Dockerfile's
  build stage runs.
