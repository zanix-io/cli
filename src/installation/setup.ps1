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
$LATEST = "2.0.0"
$VERSION = if ($args.Count -gt 0) { $args[0] } else { $LATEST }
$BIN_NAME = "zanix"
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
        # Install Deno using the official PowerShell script. `iex` runs the downloaded script
        # in-process rather than as an external process, so a failure surfaces as a terminating
        # exception (caught below), not a `$LASTEXITCODE` — the previous EAP is restored in
        # `finally` so it doesn't leak into the rest of this script (e.g. the later `Read-Host`
        # prompts, which must keep their normal, non-terminating error behavior).
        $previousErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Stop'
        try {
            irm https://deno.land/install.ps1 | iex
        } catch {
            Write-Color "`nerror[zanix-installer]: Failed to download or run the Deno installer: $($_.Exception.Message)" "Red"
            exit 1
        } finally {
            $ErrorActionPreference = $previousErrorActionPreference
        }

        # Add Deno to the PATH (this is for PowerShell)
        $DENO_INSTALL = "$env:USERPROFILE\.deno"
        $env:PATH = "$DENO_INSTALL\bin;" + $env:PATH

        # The Deno installer script can itself fail non-terminatingly (e.g. print an error and
        # return without throwing), which `try`/`catch` alone would miss — confirm the `deno`
        # command is actually resolvable now before claiming success.
        if (-not (Get-Command deno -ErrorAction SilentlyContinue)) {
            Write-Color "`nerror[zanix-installer]: Deno installation did not complete successfully ('deno' command not found after install)." "Red"
            exit 1
        }

        Write-Color "`nDeno successfully installed." "Yellow"
    } else {
        Write-Color "`nDeno will not be installed. Installation cannot continue." "Yellow"
        exit 1
    }
}

# Check if Zanix is already installed
if (Get-Command zanix -ErrorAction SilentlyContinue) {
    # Ask the user if they want to replace the current installation
    Write-Color "Zanix is already installed. Do you want to replace the current version? (y/n): " "Yellow"
    $answer = Read-Host
    Write-Host

    if ($answer -eq "y" -or $answer -eq "Y") {
        Write-Color "`nUpdating..." "Yellow"
        # Uninstall the current version of Zanix
        deno uninstall -g zanix | Out-Null
    } else {
        Write-Color "`nInstallation will not proceed." "Yellow"
        exit 1
    }
} else {
    # Proceed with the installation
    Write-Color "`nInstalling Zanix..." "Yellow"
}


$APP = "jsr:@zanix/cli@$VERSION"

# APP installation (deno install resolves the exact pinned version fresh — no separate cache
# reload needed, unlike a raw mutable URL). `deno` is a native executable, so a failure is
# reported via `$LASTEXITCODE`, not an exception. Output is captured (not streamed) so the
# happy path stays quiet, exactly as before — it's only ever printed if the install fails.
$installOutput = deno install -A -g -n $BIN_NAME $APP 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Color "`nerror[zanix-installer]: Failed to install '$BIN_NAME' (version $VERSION) via 'deno install'." "Red"
    Write-Host $installOutput
    exit 1
}

# Test and install dependencies on first run. Same capture-then-check approach: quiet on
# success, but a broken/misconfigured install now fails loudly instead of silently claiming
# success below.
$smokeOutput = & $BIN_NAME 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Color "`nerror[zanix-installer]: '$BIN_NAME' was installed but failed to run (smoke test failed)." "Red"
    Write-Host $smokeOutput
    exit 1
}

# Final message
Write-Host "`n$SEPARATOR"
Write-Color "🎉 Installation completed!" "Blue"
Write-Color "✨ You can use the '$BIN_NAME' command from any terminal." "Blue"
Write-Color "📦 Version: $VERSION" "Blue"
Write-Host $SEPARATOR
