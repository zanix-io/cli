#!/bin/bash

# Copyright 2025 the Zanix authors. All rights reserved. MIT license.

# Deliberately NOT using `set -e`/`set -o pipefail`: the two `read -p` confirmation blocks
# below rely on `if ! command -v ...`/`if command -v ...` returning a non-zero status as a
# legitimate, expected branch (not an error), and `pipefail` isn't POSIX (README.md documents
# running this file via a plain `sh`, e.g. `sh .zanix.installer`/`... | sh`, not only `bash`).
# Instead, each of the three real failure points below (Deno install, `zanix` install, the
# post-install smoke test) is checked explicitly with its own `|| { ...; exit 1; }`.

# Zanix Logo
logo="
 ______               _       
|___  /              (_)      
   / /   __ _  _ __   _ __  __
  / /   / _\` || '_ \\ | |\\ \\/ /
./ /___| (_| || | | || | >  < 
\\_____/ \\__,_||_| |_||_|/_/\\_\\                       
"

# Variables
LATEST="2.0.5"
VERSION="${1:-$LATEST}"
BIN_NAME="zanix"
SEPARATOR="==================================================="

# Welcome
echo "\n\033[0;34mWelcome to the amazing world of\033[0m:"
echo "$logo"
echo "\033[0;34mWe’re about to embark on a wonderful journey together."
echo "The installation is starting now, so get ready for some great experiences ahead!\033[0m\n"
echo "$SEPARATOR"

#!/bin/bash

# Check if Deno is installed
if ! command -v deno &> /dev/null
then
    # Ask the user if they want to install Deno
    echo "\033[0;33m"
    read -p "Deno is not installed. Would you like to install it? (y/n): " answer
    echo "\033[0m"

    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
        echo "\n\033[0;33minfo[zanix-installer]\033[0m: Installing Deno...\n"
        # Install Deno. Downloaded to a temp file and run as a separate step (instead of
        # `curl ... | sh`) so a failure of either half is unambiguous to detect without
        # `pipefail` (see the note at the top of this file) — and so the two possible causes
        # (couldn't download vs. the installer itself failed) get distinct, specific messages.
        deno_installer="$(mktemp)"
        if ! curl -fsSL https://deno.land/install.sh -o "$deno_installer"; then
            echo "\n\033[0;31merror[zanix-installer]\033[0m: Failed to download the Deno installer. Check your network connection and try again.\n"
            rm -f "$deno_installer"
            exit 1
        fi
        if ! sh "$deno_installer"; then
            echo "\n\033[0;31merror[zanix-installer]\033[0m: The Deno installer ran but failed to complete successfully.\n"
            rm -f "$deno_installer"
            exit 1
        fi
        rm -f "$deno_installer"
        # Add Deno to the PATH (this is for bash, modify if using a different shell)
        export DENO_INSTALL="$HOME/.deno"
        export PATH="$DENO_INSTALL/bin:$PATH"

        echo "\n\033[0;33minfo[zanix-installer]\033[0m: Deno successfully installed."
    else
        echo "\033[0;33minfo[zanix-installer]\033[0m: Deno will not be installed. Installation cannot continue."
        exit 1
    fi
fi

# Check if Zanix is already installed
if command -v zanix &> /dev/null
then
    # Ask the user if they want to replace the current installation
    echo "\033[0;33m"
    read -p "Zanix is already installed. Do you want to replace the current version? (y/n): " answer
    echo "\033[0m"

    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
        echo "\n\033[0;33minfo[zanix-installer]\033[0m: Updating..."
        # Uninstall the current version of Zanix
        deno uninstall -g zanix &> /dev/null
    else
        echo "\033[0;33minfo[zanix-installer]\033[0m: Installation will not proceed."
        exit 1
    fi
else
  # Proceed with the installation
  echo "\n\033[0;33minfo[zanix-installer]\033[0m: Installing Zanix..."
fi

APP="jsr:@zanix/cli@$VERSION"

# APP installation (deno install resolves the exact pinned version fresh — no separate cache
# reload needed, unlike a raw mutable URL). Output is captured (not streamed) so the happy
# path stays quiet, exactly as before — it's only ever printed if the install actually fails.
#
# `--minimum-dependency-age 0` is required here, not optional — real, confirmed failure without
# it: installing a version published within Deno's default 24h freshness window (routine right
# after a release, exactly when someone following these instructions is most likely to run this
# script) rejects outright with `Could not find version of '@zanix/cli' that matches specified
# version constraint '$VERSION' ... newer than the specified minimum dependency date`, even for
# the CLI's own entry-point resolution — before the smoke test below ever runs, let alone this
# package's own dynamically-imported commands (see the lockfile-sync step further down for that
# separate half of the same underlying class of gap). Matches this repo's own internal
# `deno task cli:install`, which has carried the identical flag from the start.
install_output=$(deno install -A -g -n $BIN_NAME --minimum-dependency-age 0 $APP 2>&1)
if [ $? -ne 0 ]; then
    echo "\n\033[0;31merror[zanix-installer]\033[0m: Failed to install '$BIN_NAME' (version $VERSION) via 'deno install'.\n"
    echo "$install_output"
    exit 1
fi

# Test and install dependencies on first run. Same capture-then-check approach: quiet on
# success, but a broken/misconfigured install now fails loudly instead of silently claiming
# success below.
smoke_output=$($BIN_NAME 2>&1)
if [ $? -ne 0 ]; then
    echo "\n\033[0;31merror[zanix-installer]\033[0m: '$BIN_NAME' was installed but failed to run (smoke test failed).\n"
    echo "$smoke_output"
    exit 1
fi

# `deno install -g`'s own generated shim config/lockfile (`~/.deno/bin/.$BIN_NAME/deno.lock`) only
# ever captures dependencies reachable from `mod.ts`'s STATIC import graph — every command whose
# real body lives in a dynamically-imported `action.ts` (the lazy-dispatch pattern this CLI uses
# to keep its own eager CLI surface light, see each `commands/*/command.ts`'s own doc) resolves
# its own dependencies FRESH at runtime instead, subject to Deno's default 24h
# minimum-dependency-age policy regardless of this package's own `"minimumDependencyAge"` setting
# — a `jsr:`-loaded global install's own governing config is a synthetic, install-time-generated
# file, never this package's own published `deno.jsonc`. Real, confirmed failure without this
# step: `zanix space dev`/`build` on a project needing a same-day-published `@zanix/*` dependency
# fails outright on the very first run, `Could not find version of '...' that matches specified
# version constraint '...' ... newer than the specified minimum dependency date`.
#
# Fixed by merging this package's own PUBLISHED lockfile — generated from a `deno test`/
# `deno check` run that DOES reach every lazily-imported action.ts, so it already has every one
# of these entries locked — into the shim's own generated lockfile: every entry the install
# step's own resolution didn't already capture gets ADDED, never overwriting anything `deno
# install` itself already correctly resolved. Best-effort: a failure here only means a
# same-day-fresh dependency might still be rejected until this step succeeds (e.g. on a retry, or
# via `deno task cli:install` from a local checkout) — never something that should fail the whole
# installation over, since the CLI itself is already correctly installed and runnable at this
# point.
echo "\n\033[0;33minfo[zanix-installer]\033[0m: Syncing dependency lockfile..."
SHIM_LOCK="$HOME/.deno/bin/.$BIN_NAME/deno.lock"
if [ -f "$SHIM_LOCK" ]; then
    PUBLISHED_LOCK="$(mktemp)"
    if curl -fsSL "https://jsr.io/@zanix/cli/$VERSION/deno.lock" -o "$PUBLISHED_LOCK"; then
        deno eval --ext=ts "
          const shim = JSON.parse(await Deno.readTextFile('$SHIM_LOCK'))
          const published = JSON.parse(await Deno.readTextFile('$PUBLISHED_LOCK'))
          for (const section of ['specifiers', 'jsr', 'npm']) {
            for (const [key, value] of Object.entries(published[section] ?? {})) {
              shim[section] ??= {}
              if (!(key in shim[section])) shim[section][key] = value
            }
          }
          await Deno.writeTextFile('$SHIM_LOCK', JSON.stringify(shim, null, 2) + '\n')
        " > /dev/null 2>&1 || echo "\n\033[0;33mwarn[zanix-installer]\033[0m: Lockfile sync failed — '$BIN_NAME space dev'/'build' may reject a freshly-published dependency until a retry.\n"
    else
        echo "\n\033[0;33mwarn[zanix-installer]\033[0m: Could not fetch the published lockfile — '$BIN_NAME space dev'/'build' may reject a freshly-published dependency.\n"
    fi
    rm -f "$PUBLISHED_LOCK"
fi

# Final message
echo "\n$SEPARATOR"
echo "🎉 \033[0;34mInstallation completed!"
echo "✨ You can use the '$BIN_NAME' command from any terminal."
echo "📦 Version: $VERSION\033[0m"
echo $SEPARATOR
