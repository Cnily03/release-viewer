# Release Viewer

A static site generator for viewing GitHub release information with a beautiful and user-friendly interface. This project allows you to create an elegant documentation website to showcase releases, changelogs, and assets from any GitHub repository.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) for TypeScript runtime
- [pnpm](https://pnpm.io/) for package management
- [rsync](https://rsync.samba.org/) for syncing files
- [curl](https://curl.se/) or [wget](https://www.gnu.org/software/wget/) for downloading files

### Installation

```bash
# Clone the repository
git clone https://github.com/Cnily03/release-viewer.git
cd release-viewer

# Install dependencies
pnpm install
```

### Configuration

1. Copy the `.env.sample` file to `.env` and set your environment variables as needed.
2. Generate a release configuration using the `generate.ts` script (see [Usage](#usage) section).
3. Build the static site by running `pnpm build`.

## Usage

### Generate configuration

The static site requires a configuration file that contains release data fetched from a GitHub repository.

Run the `generate.ts` script to fetch release data from a GitHub repository and generate a configuration file.

```bash
bun run generate.ts <repo_fullname> [...options]
```

**Options:**

```plaintext
Usage: ./generate.ts <repo_fullname> [...options]
Options:
  -h, --help                        Show this help message
  -o, --output <file>               Output file
  --token <token>                   GitHub API token (or set GITHUB_TOKEN env variable)
  --reduce <major[,minor[,patch]]>  Reduce releases to at most major/minor/patch releases
  --ignore-empty-assets             Ignore releases with no assets
```

### Build the static site

Simply run `pnpm build` to build the static site using the generated configuration in the current directory.

It also contains the following extended options:

- `--base <base>` - Base URL for the front-end (e.g., `/app/`, default as per `astro.config.mts`)
- `-c, --config <file>` - Path to the configuration file (default: `config.json`)
- `-d, --out-dir <directory>` - Output directory for the built site (default as per `astro.config.mts`)

### Sync assets and build the site

The project provides a `sync.ts` script to download release assets and sync them to a specified destination.

**Usage:**

```plaintext
Usage: sync.ts <repo_fullname> [...options] [..generate options]

Basic Options:
  -h,
  --help                              Show this help message
  -o,
  --save <path>                       Save generated configuration to file
  -c,
  --compare <path>                    Compare with former configuration file

Download Options:
  -d,
  --download-target <directory>       Directory for downloaded files
  -t,
  --url-template <template>           Template URL for downloading files (user-facing)
  --fast-fail                         Fail immediately on download error
  --fast-sync                         Synchronize files to downloaded directory after download immediately
  --concurrency <number>              Number of concurrent downloads (default: 1)

Build Options:
  -b,
  --build-base <base>                 Base URL for building front-end (e.g., /app/)
  --www-root <directory>              Root directory for the front-end website
```

The following options arguments are supported remote path for rsync:

- `-d, --download-target <directory>`
- `--www-root <directory>`
- `-c, --compare <path>`
- `-o, --save <path>`

**Behavior:**

When running the `sync.ts` script, it will:

1. Generate the release configuration using the provided repository fullname and options.
2. Compare it and calculate the differences with a former configuration file if provided, otherwise consider all assets as new in differences.
3. According to the differences, download new or updated assets to the specified download target directory.
4. Build the static site.
5. Delete assets that are no longer present in the latest configuration.

**About URL Template:**

When using the `-t, --url-template` option in `sync.ts`, you can use these variables:

- `{tag}` - Release tag name
- `{name}` - Asset file name
- `{release}` - Release name
- `{url}` - Original download URL

## License

Copyright (c) Cnily03. All rights reserved.

Licensed under the [MIT License](LICENSE).
