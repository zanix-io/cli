# Design proposal: generators for the `zanix-remote-api-app-pattern` (not implemented)

**Status: proposal, not implemented.** No command described here exists in `registry.ts` yet. This
follows `cli-artifact-generators`'s own standing workflow (Evidence → Decisions → Plan) up through
the Plan step, ready for `cli-generator-expert` to implement. Written after a real design session
that added `getBearerRelayHeaders`/`createSessionClientFactory` to `@zanix/console-kit` (see that
repo's own `README.md`/`CHANGELOG.md` once released) — this proposal assumes those exist.

## Evidence (what's real today)

- `zanix-remote-api-app-pattern` (skill) / `@zanix/console`'s own `src/triggers/`, `src/clients/`,
  `src/space/routes/triggers/` — the six-layer shape this generates parts of.
- `interactor/command.ts`'s `resolveInteractorsFolder` **already** special-cases a plain `space`
  project: `src/<kebabName>/<kebabName>.interactor.ts` — explicitly modeled on `@zanix/console`'s
  own `TriggersInteractor`/`TemplatesInteractor`. **Layer 3's interactor is already covered by the
  existing `interactor` generator** — nothing new needed there. This proposal only fills the
  genuinely uncovered layers: 2 (resource descriptor) and 3+6's _client/auth wiring_ (as opposed to
  the interactor itself).
- `connector/command.ts`'s `--slot` picks one of five templates
  (`generic`/`database`/`rest`/`graphql`/`cache:<subtype>`) via a single required-ish option — the
  direct precedent for an `--auth` flag picking a template variant here.
- `repository/command.ts`'s `planRepository` writes two files as one generated unit
  (`entity.provider.ts` + `model.defs.ts`) — precedent for a generator writing more than one file,
  though (see Decisions below) this proposal deliberately does NOT follow that shape for the
  auth/client split.
- `interactor/template.ts`'s own doc: deliberately never references a specific `<Name>RTO` — "that's
  a separate, optional artifact this command has no way of knowing was already generated for this
  same entity. Wire it in by hand once it exists." Same principle applies here: a generator cannot
  know a real RTO's shape, a real target's exchange-route path, or a real client class's name. Every
  template below leaves those as clearly marked `// TODO` lines, never a guess.
- `zanix-remote-api-app-pattern`'s own "Out of scope" section, restated for this proposal: **no
  generator decides which resource/target this is, which RTO it binds, or which credential mechanism
  fits** — a human decides that once, at generation time, via `--auth`. This mirrors the "config vs.
  code" conclusion from the design session that preceded this proposal: `authStrategy` is chosen by a
  human writing one CLI flag, never inferred at runtime.

### Two real console-kit shape findings this proposal designs around

1. **`HubAuthAccessors` (M2M) and `SessionAuthAccessors` (Bearer) use different field names** —
   `requireAdminHubBaseUrl`/`getAdminHubAuthHeaders` vs. `requireBaseUrl`/`getAuthHeaders`. The
   M2M shape's names are literally hub-specific even though `createHubClientFactory` itself works
   against ANY target, not just `zanix-admin`. Not fixed here (would be a breaking rename for
   `@zanix/console`'s own `admin-hub-auth.ts`/`triggers-hub.client.ts`) — the `service` templates
   below just use the real, existing field names verbatim. Worth a follow-up console-kit
   conversation, not blocking this proposal.
2. **`createAdminHubAuthClient` bakes in one fixed env var** (`ADMIN_HUB_BASE_URL_ENV =
   'ADMIN_HUB_BASE_URL'`) — right for "the one `zanix-admin` hub a console talks to," wrong for an
   arbitrary M2M target (a project could have several). The `service` template below does NOT call
   `createAdminHubAuthClient` — it composes the lower-level, genuinely generic
   `createHubServiceAuthClient(serviceId)` with a small hand-written `require<Target>BaseUrl()`,
   the exact same few lines `@zanix/console`'s own `admin-hub-auth.ts` factors before
   `createAdminHubAuthClient` existed. `createAdminHubAuthClient` stays reserved for the literal
   "target is `zanix-admin` itself" case — this proposal doesn't attempt to generalize it further.

## Decisions

- **Three new generators, not one.** A target's auth wiring (layer 6) is shared across every
  resource client that talks to it (console's own `admin-hub-auth.ts` is instantiated once, imported
  by four separate `*-hub.client.ts` files) — a different cardinality than `repository`'s 1:1
  file pair. Bundling auth+client into one command would either regenerate/skip the auth file on
  every new resource (silently, since generators never overwrite) or force a "target already exists,
  don't regenerate" check no other generator does. Keeping them separate matches the real
  N-clients-to-1-target shape directly:
  - `remote-auth <target>` — one per external target/hub. Layer 6.
  - `remote-client <name>` — one per resource client. Layer 3 (client-factory instantiation only,
    NOT the interactor — `interactor` already exists).
  - `remote-resource <name>` — one per UI resource. Layer 2.
- **`--auth` is a required option on both `remote-auth` and `remote-client`**, no default — same
  reasoning `dlqprocessor`/`middleware` already established: three (or two) genuinely common,
  equally-likely paths with nothing to safely default to.
  - `remote-auth` accepts `bearer|service` only — there's nothing to generate for "no auth."
  - `remote-client` accepts `bearer|service|public` — `public` builds a plain, credential-less
    client (no `-auth.ts` file needed/expected for it).
- **Folder layout**: `src/clients/` for both `remote-auth` and `remote-client` output (matches
  `@zanix/console`'s real `src/clients/` — sibling to, not nested under, `src/space/`). Both are
  `space`/`space-server` only (`assertProjectType`), same set `interactor`/`page` already allow.
  `remote-resource` writes into the SAME per-entity folder `interactor` already resolves
  (`src/<kebabName>/<kebabName>.resource.ts`, alongside `<kebabName>.interactor.ts`) — reuses
  `resolveInteractorsFolder`'s exact folder, imported from `interactor/command.ts`, rather than
  re-deriving it.
- **This introduces a new standing folder convention** (`src/clients/` as a real, generator-owned
  target) — `docs/engineering.md` needs a note, not just `docs/generate-space.md` (per
  `cli-artifact-generators`'s own "Docs" step).
- **Every cross-artifact reference is a `// TODO`, never inferred**: the real RTO(s) a resource binds
  (layer 2), the real client class a `remote-client` wraps (layer 3), the real service identity /
  exchange-route path a `service`-flavored `remote-auth` needs (layer 6) — none of these are
  guessable from a name string. Same discipline `interactor/template.ts` already established for its
  own RTO reference.
- **`ensureZanixDependency(root, '@zanix/console-kit')`** for all three (once it publishes to JSR —
  see that repo's own `README.md` "Status" section for the current local-link caveat, which this
  generator inherits until console-kit's first real publish).

## Plan

### `remote-auth <target> [root]` — layer 6

```
src/commands/generate/remote-auth/
  command.ts   -- registerRemoteAuthCommand, generateRemoteAuthAction, planRemoteAuth
  template.ts  -- bearerAuthTemplate(pascalTarget, kebabTarget), serviceAuthTemplate(...)
```

- `--auth <bearer|service>` (required).
- `--base-url-env <ENV_NAME>` (optional; default `<SCREAMING_SNAKE(target)>_BASE_URL`, e.g.
  `weather-api` → `WEATHER_API_BASE_URL`).
- Output: `src/clients/<kebabTarget>-auth.ts`.
- `bearerAuthTemplate` — imports `getBearerRelayHeaders` from `@zanix/console-kit/auth`; exports
  `<PASCAL_TARGET>_BASE_URL_ENV`, `require<PascalTarget>BaseUrl()`, and
  `get<PascalTarget>AuthHeaders(ctx: ScopedContext)` (a direct pass-through).
- `serviceAuthTemplate` — imports `createHubServiceAuthClient` from `@zanix/console-kit/auth` (NOT
  `createAdminHubAuthClient` — see Evidence above); exports the same base-url pair, plus a
  `// TODO: replace with this app's own registered service identity` constant and
  `get<PascalTarget>AuthHeaders()` wrapping the cached exchange function. Leaves a
  `// TODO: confirm <target>'s own exchange route if it differs from /admin/service-token` comment
  — that path is a real per-target fact this generator cannot know.

### `remote-client <name> [root]` — layer 3 (client-factory instantiation)

```
src/commands/generate/remote-client/
  command.ts   -- registerRemoteClientCommand, generateRemoteClientAction, planRemoteClient
  template.ts  -- bearerClientTemplate/serviceClientTemplate/publicClientTemplate(pascalName, kebabName, target)
```

- `--auth <bearer|service|public>` (required).
- `--target <target-kebab-name>` (required for `bearer`/`service` — names the sibling
  `remote-auth` output to import from, `./​<target>-auth.ts`; rejected/ignored for `public`, which
  has no auth file to import).
- Output: `src/clients/<kebabName>.client.ts`.
- `bearerClientTemplate`/`serviceClientTemplate` — import `createSessionClientFactory`/
  `createHubClientFactory` from `@zanix/console-kit/client`, plus the named accessor pair from
  `./<target>-auth.ts`. Both leave a `// TODO: replace with your real client class` stub (a minimal
  `class <PascalName>Client { constructor(public options: {baseUrl: string; headers:
  Record<string,string>}) {} }`) — the SAME "cannot know a real class" gap `interactor/template.ts`
  already accepts for RTOs. Exports `get<PascalName>Client`/`set<PascalName>ClientFactory`/
  `reset<PascalName>ClientFactory`, mirroring `@zanix/console`'s own real
  `getTriggersHubClient`/`setTriggersHubClientFactory`/`resetTriggersHubClientFactory` naming
  exactly.
- `publicClientTemplate` — no `-auth.ts` import, no `@zanix/console-kit/client` import either
  (nothing to make pluggable/testable via `set`/`reset` when there's no credential to fake) — a
  plain `RestClient`-backed constructor call with a hardcoded `// TODO: base URL` env read.

### `remote-resource <name> [root]` — layer 2

```
src/commands/generate/remote-resource/
  command.ts   -- registerRemoteResourceCommand, generateRemoteResourceAction, planRemoteResource
  template.ts  -- resourceTemplate(pascalName, kebabName)
```

- No `--auth` (see the design session's own conclusion: auth strategy is a client/target concern,
  never a `AdminResource` field).
- Output: reuses `resolveInteractorsFolder(projectRoot, projectType, kebabName)` from
  `interactor/command.ts` (imported, not re-derived) → `src/<kebabName>/<kebabName>.resource.ts`.
- Template imports `AdminResource` from `@zanix/console-kit` (root); exports
  `<SCREAMING_SNAKE(name)>_ADMIN_RESOURCE: AdminResource` with `rto: {}` and empty `fields`/
  `actions` arrays, each with a `// TODO` comment pointing at `zanix-remote-api-app-pattern`'s own
  "Reference the backend's real RTO by field name, never redeclare it" section and at
  `assertAdminResourceFieldsMatchRto` (a `// TODO: add a unit test calling
  assertAdminResourceFieldsMatchRto` reminder, matching that skill's own checklist item — this
  generator does not write the test file itself, since it has no field list yet to test against).

## Explicitly out of scope for this proposal

- **No `--verify` semantics beyond the standard opt-in `deno check`** — a stub with empty
  `fields`/`rto: {}` always type-checks; `--verify` here only catches an import-path/dependency
  mistake, same honest limit `rto`'s own `--verify` has for an equally-empty generated class.
- **No route/page generation.** `zanix generate page` already exists and covers layer 4 per route;
  duplicating that here would fork a shape that already works.
- **No attempt to auto-wire the interactor to the generated client.** `interactor/template.ts`
  already establishes "wire dependencies in by hand, once they exist" as the norm for this exact
  kind of cross-artifact reference — this proposal follows it, not an exception to it.
- **`console-kit`'s `HubAuthAccessors` field-naming asymmetry** (see Evidence) — flagged, not fixed,
  here.
