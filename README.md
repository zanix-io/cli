# Zanix - Utils

[![Version](https://img.shields.io/jsr/v/@zanix/cli?color=blue&label=jsr)](https://jsr.io/@zanix/cli/versions)

[![Release](https://img.shields.io/github/v/release/zanix-io/cli?color=blue&label=git)](https://github.com/zanix-io/cli/releases)

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

To install **Zanix CLI** globally, use [Deno](https://deno.com/) with following command:

```bash
deno install -A -g -n znx .dist/app.mjs --config deno.jsonc
```

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
