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

This opens your browser to `app.voxli.io` where you log in and approve access. An API key is created automatically and saved to `~/.voxli/config.json`.

To enter an API key manually instead:

```sh
voxli auth --manual
```

You can also set the `VOXLI_API_TOKEN` environment variable instead.

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

## Commands

| Command | Description |
|---|---|
| `voxli auth` | Authenticate via browser |
| `voxli auth --manual` | Authenticate by entering an API key manually |
| `voxli listen --command <cmd>` | Poll for pending test work and run it locally |

