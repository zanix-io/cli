import { assert, assertEquals } from '@std/assert'
import { dirname, fromFileUrl, join } from '@std/path'
import { getTemporaryFolder } from '@zanix/helpers'
import { Commander } from 'cli'
import newSpaceAction from 'commands/new/actions/space.ts'
import { getSpaceUiThemeTemplate } from 'commands/new/lib/tree/projects/space-theme.ts'

/**
 * `--theme astronaut`'s own real, unmocked network path — same tier/reasoning as
 * `space-theme-live.test.ts`: `copyAstronautAssets` fetches `behavior.css`/`card.css` from the
 * real, published `@zanix/space-ui`, via the exact same `getSpaceUiThemeTemplate` that file's own
 * test already exercises — proven here again only because THIS theme's own scaffold is what
 * needs the real-content-lands-correctly proof, not because the fetch mechanism itself needs a
 * second, redundant test.
 *
 * Deliberately does NOT attempt a real `zanix space build` here, unlike `command.test.ts`'s own
 * local-link fixtures: a REAL `newSpaceAction`-scaffolded project's `deno.json` declares its FULL,
 * real dependency set (including transitive ones this session's local import-map fixes don't cover
 * — confirmed empirically: even a plain `--template base` scaffold hits the same unresolved-import
 * wall, e.g. `@zanix/errors`, once linked locally and built for real). That gap is real, but
 * general to testing ANY full real scaffold against a local `@zanix/space` checkout — it predates
 * this theme and isn't specific to it, so it isn't this file's job to work around. The BUILD
 * pipeline itself (comets/CSS/client-entry all resolving and producing real output) is already
 * proven, end-to-end, by `command.test.ts`'s own local-link fixtures — deliberately minimal ones,
 * for exactly this reason.
 */
const temporaryFolder = getTemporaryFolder(import.meta.url)

const SPACE_UI_TEMPLATES_DIR = join(
  dirname(fromFileUrl(import.meta.url)),
  '../../../../space-ui/src/templates',
)

Deno.test(
  '--template welcome --theme astronaut: real scaffold — theme (5 files, real fetched content ' +
    'for the shared two), richer welcome page, and comet demo all land correctly',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-astronaut-space')

    try {
      await newSpaceAction.call(
        new Commander(),
        { template: 'welcome', theme: 'astronaut' },
        appPath,
      )

      const spaceAppTs = await Deno.readTextFile(join(appPath, 'space.app.ts'))
      assert(spaceAppTs.includes("clientBuildDir: './.dist/client',"), spaceAppTs)
      for (
        const file of [
          'tokens.css',
          'behavior.css',
          'card.css',
          'space-defaults.css',
          'astronaut.css',
        ]
      ) {
        assert(spaceAppTs.includes(`'./theme/${file}',`), spaceAppTs)
      }

      // The two files shared, byte-for-byte, with `--theme default` — real fetched content, same
      // proof `space-theme-live.test.ts` already runs for that theme.
      const [realBehavior, realCard] = await Promise.all([
        getSpaceUiThemeTemplate('shared/behavior.css'),
        getSpaceUiThemeTemplate('shared/card.css'),
      ])
      const [localBehavior, localCard] = await Promise.all([
        Deno.readTextFile(join(SPACE_UI_TEMPLATES_DIR, 'shared/behavior.css')),
        Deno.readTextFile(join(SPACE_UI_TEMPLATES_DIR, 'shared/card.css')),
      ])
      assertEquals(realBehavior, localBehavior)
      assertEquals(realCard, localCard)
      const [writtenBehavior, writtenCard] = await Promise.all([
        Deno.readTextFile(join(appPath, 'theme/behavior.css')),
        Deno.readTextFile(join(appPath, 'theme/card.css')),
      ])
      assertEquals(writtenBehavior, realBehavior)
      assertEquals(writtenCard, realCard)

      // The two embedded, astronaut-specific files — never fetched, but real, written content.
      const tokensCss = await Deno.readTextFile(join(appPath, 'theme/tokens.css'))
      assert(tokensCss.includes('--space-navy-950'), 'expected the dark astronaut palette')
      const astronautCss = await Deno.readTextFile(join(appPath, 'theme/astronaut.css'))
      assert(astronautCss.includes('.comet-launch'), 'expected the comet-launch decoration')

      const pageTsx = await Deno.readTextFile(join(appPath, 'src/space/routes/page.tsx'))
      assert(pageTsx.includes("import ExampleCounter from '../comets/example.comet.tsx'"), pageTsx)
      assert(pageTsx.includes('What makes Space different'), pageTsx)
      assert(pageTsx.includes('astronaut theme'), pageTsx)

      const cometTsx = await Deno.readTextFile(
        join(appPath, 'src/space/comets/example.comet.tsx'),
      )
      assert(cometTsx.includes("from '@zanix/space/comet'"), cometTsx)
      assert(cometTsx.includes('comet-launchpad'), cometTsx)

      const config = await Deno.readTextFile(join(appPath, 'deno.json'))
      assert(
        config.includes('"@zanix/space-ui"'),
        `deno.json must declare @zanix/space-ui once --theme astronaut runs:\n${config}`,
      )
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)

Deno.test(
  '--template base --theme astronaut: the theme still lands, and the Comet demo is STILL the ' +
    'interactive one — Comet content follows --theme, independent of --template',
  async () => {
    const root = await Deno.makeTempDir({ dir: temporaryFolder })
    const appPath = join(root, 'my-astronaut-base-space')

    try {
      await newSpaceAction.call(new Commander(), { template: 'base', theme: 'astronaut' }, appPath)

      const pageTsx = await Deno.readTextFile(join(appPath, 'src/space/routes/page.tsx'))
      assert(!pageTsx.includes('WelcomePage'), pageTsx)

      const cometTsx = await Deno.readTextFile(
        join(appPath, 'src/space/comets/example.comet.tsx'),
      )
      assert(cometTsx.includes('comet-launchpad'), cometTsx)

      const astronautCss = await Deno.readTextFile(join(appPath, 'theme/astronaut.css'))
      assert(astronautCss.includes('.comet-launch'), 'expected the comet-launch decoration')
    } finally {
      await Deno.remove(root, { recursive: true })
    }
  },
)
