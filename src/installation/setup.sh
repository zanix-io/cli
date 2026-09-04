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
LATEST="2.0.0"
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
install_output=$(deno install -A -g -n $BIN_NAME $APP 2>&1)
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

# Final message
echo "\n$SEPARATOR"
echo "🎉 \033[0;34mInstallation completed!"
echo "✨ You can use the '$BIN_NAME' command from any terminal."
echo "📦 Version: $VERSION\033[0m"
echo $SEPARATOR
