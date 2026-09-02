# @voxli/cli

CLI agent for running [Voxli](https://voxli.io) test scenarios locally.

## Install

```sh
npm install -g @voxli/cli
```

Requires Node.js 18+.

## Setup

Authenticate with your Voxli account:

```sh
voxli auth
```

This opens your browser to `app.voxli.io` where you log in and approve access. A user-scoped access token (with a refresh token) is saved to `~/.voxli/config.json`, or to an existing `.voxli/config.json` found in the current directory or a parent. Use `--local` to force `./.voxli/config.json`.

### Headless machines, VMs, and SSH

The browser doesn't have to be on the same machine. Run `voxli auth`, open the printed URL anywhere, and log in. The browser is then sent to `http://127.0.0.1:<port>/callback`, which it can't reach from another machine and shows a "can't connect" page. Copy the full URL from the address bar and paste it into the terminal prompt; the CLI completes the login from there.

The CLI only tries to open a browser when one is likely in front of you (not over SSH, in CI, or without a display). Set `BROWSER=none` to never open one, or `BROWSER=<command>` to choose which.

Pasting requires an interactive terminal (`ssh -t` if needed).

### CI and service accounts

Set the `VOXLI_API_TOKEN` environment variable to skip the login entirely; it takes precedence over any config file. Env-var tokens are never refreshed.

## Usage

Start listening for test work:

```sh
voxli listen --command "<your test command>"
```

The CLI polls the Voxli API for pending test batches. When work arrives, it spawns your command as a subprocess with these environment variables:

| Variable | Description |
|---|---|
| `VOXLI_API_TOKEN` | Your API key |
| `TEST_RESULT_IDS` | JSON array of test result IDs to run |
| `RUN_ID` | The run ID (if part of a run) |

## Credential lookup order

1. `VOXLI_API_TOKEN` environment variable
2. Nearest `.voxli/config.json` walking up from the current directory
3. `~/.voxli/config.json`

## Commands

| Command | Description |
|---|---|
| `voxli auth` | Authenticate via browser |
| `voxli auth --local` | Save credentials to `./.voxli/config.json` |
| `voxli listen --command <cmd>` | Poll for pending test work and run it locally |

## Development

```sh
npm run build   # compile to dist/
npm test        # run the test suite
npm run lint    # eslint
```

Requires Node 20 or newer (see `engines` in `package.json`). CI runs lint, build,
and tests on every pull request against Node 20, 22, and 24.
