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
