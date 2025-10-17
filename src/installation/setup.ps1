# Copyright 2025 the Zanix authors. All rights reserved. MIT license.

# Zanix Logo
$logo = @"
 ______               _       
|___  /              (_)      
   / /   __ _  _ __   _ __  __
  / /   / _' || '_ \ | |\ \/ /
./ /___| (_| || | | || | >  < 
\_____/ \__,_||_| |_||_|/_/\_\                       
"@

# Variables
$LATEST = "1.0.5"
$VERSION = if ($args.Count -gt 0) { $args[0] } else { $VERSION }
$BIN_NAME = "znx"
$SEPARATOR = "==================================================="

# Function to write colored text
function Write-Color {
    param (
        [string]$Text,
        [string]$Color
    )
    
    Write-Host $Text -ForegroundColor $Color
}

# Welcome
Write-Color "`nWelcome to the amazing world of" "Blue"
Write-Host $logo
Write-Color "We're about to embark on a wonderful journey together." "Blue"
Write-Color "The installation is starting now, so get ready for some great experiences ahead!`n" "Blue"
Write-Host $SEPARATOR

# Check if Deno is installed
if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
    # Ask the user if they want to install Deno
    Write-Color "Deno is not installed. Would you like to install it? (y/n): " "Yellow"
    $answer = Read-Host
    Write-Host

    if ($answer -eq "y" -or $answer -eq "Y") {
        Write-Color "`nInstalling Deno..." "Yellow"
        # Install Deno using the official PowerShell script
        irm https://deno.land/install.ps1 | iex

        # Add Deno to the PATH (this is for PowerShell)
        $DENO_INSTALL = "$env:USERPROFILE\.deno"
        $env:PATH = "$DENO_INSTALL\bin;" + $env:PATH
        
        Write-Color "`nDeno successfully installed." "Yellow"
    } else {
        Write-Color "`nDeno will not be installed. Installation cannot continue." "Yellow"
        exit 1
    }
}

# Check if Znx is already installed
if (Get-Command znx -ErrorAction SilentlyContinue) {
    # Ask the user if they want to replace the current installation
    Write-Color "Zanix is already installed. Do you want to replace the current version? (y/n): " "Yellow"
    $answer = Read-Host
    Write-Host

    if ($answer -eq "y" -or $answer -eq "Y") {
        Write-Color "`nUpdating..." "Yellow"
        # Uninstall the current version of Znx
        deno uninstall -g znx | Out-Null
    } else {
        Write-Color "`nInstallation will not proceed." "Yellow"
        exit 1
    }
} else {
    # Proceed with the installation
    Write-Color "`nInstalling Zanix..." "Yellow"
}


$APP = "https://jsr.io/@zanix/cli/$VERSION/.dist/app.mjs"

# Reload caching to ensure dependencies update
deno cache --reload $APP | Out-Null

# APP installation
deno install -A -g -n $BIN_NAME $APP | Out-Null

# Test and install dependencies on first run
znx | Out-Null

# Final message
Write-Host "`n$SEPARATOR"
Write-Color "🎉 Installation completed!" "Blue"
Write-Color "✨ You can use the '$BIN_NAME' command from any terminal." "Blue"
Write-Color "📦 Version: $VERSION" "Blue"
Write-Host $SEPARATOR
