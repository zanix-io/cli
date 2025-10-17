# Zanix - Utils

[![Version](https://img.shields.io/jsr/v/@zanix/cli?color=blue&label=jsr)](https://jsr.io/@zanix/cli/versions)

[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

## Table of Contents

1. [Description](#description)
2. [Features](#features)
3. [Installation](#installation)
4. [Basic Usage](#basic-usage)
5. [Documentation](#documentation)
6. [Contributing](#contributing)
7. [License](#license)
8. [Resources](#resources)

## Description

The **Zanix Framework** `CLI` is a powerful command-line interface (CLI) tool designed to facilitate the development and management of `Zanix` applications. With a comprehensive set of commands and utilities, the CLI empowers developers to streamline their workflow and efficiently work with `Zanix` projects. This README provides an overview of the CLI commands and their usage.

## Features

- CLI bundle.
- Multiple commands.

## Installation

### Install Zanix CLI

To install **Zanix CLI** globally, use [Deno](https://deno.com/) with following command:

```bash
deno install -A -g -n znx https://jsr.io/@zanix/cli/[version]/.dist/app.mjs
```

### Running a Shell Script from a URL

If you need to execute a `.sh` script from a web URL, you can use the following methods:

1. **Using `curl`**:

   ```bash
   curl -sSL https://jsr.io/@zanix/cli/[version]/src/installation/setup.sh -o .zanix.installer && sh .zanix.installer && rm -f .zanix.installer
   ```

2. **Using `wget`**:

   ```bash
   wget -qO- https://jsr.io/@zanix/cli/[version]/src/installation/setup.sh | sh
   ```

   - `curl -sSL`: Downloads the script and pipes it into `bash` for execution. This is useful for automating script execution directly from the web.
   - `wget -qO-`: Does the same using `wget`, which is another tool for downloading files.

### Running a PowerShell Script from a URL

If you need to execute a **PowerShell** script (`zanix.ps1`) directly from a URL, you can use the following methods:

1. **Download and execute with `Invoke-Expression`:**

   This command downloads and executes the script directly in PowerShell:

   ```powershell
   Invoke-Expression (Invoke-WebRequest -Uri "https://jsr.io/@zanix/cli/[version]/src/installation/setup.ps1" -UseBasicP)
   ```

2. **Download the script first, then execute manually:**

   - First, download the script using `Invoke-WebRequest`:

     ```powershell
     Invoke-WebRequest -Uri "https://jsr.io/@zanix/cli/[version]/src/installation/setup.ps1" -OutFile "zanix.ps1"
     ```

   - Then, execute the downloaded script:

     ```powershell
     .\zanix.ps1
     ```

3. **Run the script with Administrator privileges:**

   To run the script with elevated permissions (Administrator), use this command:

   ```powershell
   Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File 'zanix.ps1'" -Verb RunAs
   ```

4. **Change Execution Policy if needed:**

   If you encounter an error due to execution policies, you may need to change the policy to allow the script to run. You can temporarily change the policy with the following command:

   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```

### Security Warning

**Be cautious!** Running scripts downloaded from the web can be risky, especially if you don’t trust the source. Always ensure to review the content of the script before executing it.

Replace `[version]` with the actual version number when needed.

---

**Important:**

1. **Install Deno**: Ensure Deno is installed on your system. If not, follow the [official installation guide](https://docs.deno.com/runtime/getting_started/installation).

2. **Install VSCode Extension**: If using Visual Studio Code, install the **Deno extension** for syntax highlighting, IntelliSense, and linting. Get it from the [VSCode marketplace](https://marketplace.visualstudio.com/items?itemName=denoland.vscode-deno).

3. **Add Deno to PATH**: Ensure Deno is in your system’s `PATH` so the plugin works correctly:
   - **macOS/Linux**: Add to `.bashrc`, `.zshrc`, or other shell config files:
     ```bash
     export PATH="$PATH:/path/to/deno"
     ```
   - **Windows**: Add the Deno folder to your system’s `PATH` via Environment Variables.

---

## Basic Usage

The **Zanix Framework CLI** provides a range of commands to help you with various tasks related to `Zanix` development. Once installed, you can run any of the CLI commands listed above by executing `znx <command>` in your terminal:

Of course! Here's the improved version in English for your README:

---

## Basic Usage

The **Zanix Framework CLI** provides a range of commands to help you with various tasks related to `Zanix` development. Once installed, you can run any of the available commands by executing `znx <command>` in your terminal.

### Help Command

To view a list of available commands and get detailed usage information, run:

```bash
znx --help
```

This command will display the general help information and a list of all available commands.

## Documentation

For full documentation, check out the [official Zanix website](https://github.com/zanix-io) for detailed usage, advanced examples, and more.

## Contributing

If you have any questions, suggestions, or feedback, you can reach out to the author via email at [icalle@utp.edu.co](icalle@utp.edu.co). You can also connect with the author on [Linkedin](https://mx.linkedin.com/in/ismael-calle-marulanda) for updates and announcements about software.

## Changelog

For a detailed list of changes, please refer to the [CHANGELOG](./docs/CHANGELOG.md) file.

## License

This library is licensed under the MIT License. See the [LICENSE](./docs/LICENSE) file for more details.

## Resources

- [Deno Documentation](https://docs.deno.com/)
- [Zanix Framework Documentation](https://github.com/zanix-io)

---

_Developed with ❤️ by Ismael Calle | [@iscam2216](https://github.com/iscam2216)_
