#!/bin/bash

# Copyright 2025 the Zanix authors. All rights reserved. MIT license.

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
LATEST="1.0.3"
VERSION="${1:-LATEST}"
BIN_NAME="znx"
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
        # Install Deno
        curl -fsSL https://deno.land/install.sh | sh 
        # Add Deno to the PATH (this is for bash, modify if using a different shell)
        export DENO_INSTALL="$HOME/.deno"
        export PATH="$DENO_INSTALL/bin:$PATH"
        
        echo "\n\033[0;33minfo[zanix-installer]\033[0m: Deno successfully installed."
    else
        echo "\033[0;33minfo[zanix-installer]\033[0m: Deno will not be installed. Installation cannot continue."
        exit 1
    fi
fi

# Check if Znx is already installed
if command -v znx &> /dev/null
then
    # Ask the user if they want to replace the current installation
    echo "\033[0;33m"
    read -p "Zanix is already installed. Do you want to replace the current version? (y/n): " answer
    echo "\033[0m"

    if [[ "$answer" == "y" || "$answer" == "Y" ]]; then
        echo "\n\033[0;33minfo[zanix-installer]\033[0m: Updating..."
        # Uninstall the current version of Znx
        deno uninstall -g znx &> /dev/null
    else
        echo "\033[0;33minfo[zanix-installer]\033[0m: Installation will not proceed."
        exit 1
    fi
else
  # Proceed with the installation
  echo "\n\033[0;33minfo[zanix-installer]\033[0m: Installing Zanix..."
fi

deno install -A -g -n $BIN_NAME https://jsr.io/@zanix/cli/$VERSION/.dist/app.mjs &> /dev/null
# Test and install dependencies on first run
znx &> /dev/null

# Final message
echo "\n$SEPARATOR"
echo "🎉 \033[0;34mInstallation completed!"
echo "✨ You can use the '$BIN_NAME' command from any terminal."
echo "📦 Version: $VERSION\033[0m"
echo $SEPARATOR
