# @voxli/cli

CLI agent for running [Voxli](https://voxli.io) test scenarios locally.

## Install

```sh
npm install -g @voxli/cli
```

Requires Node.js 18+.

## Setup

Authenticate with your Voxli API key:

```sh
voxli auth
```

This saves your key to `~/.voxli/config.json`. You can also set the `VOXLI_API_KEY` environment variable instead.

## Usage

Start listening for test work:

```sh
voxli listen --command "<your test command>"
```

The CLI polls the Voxli API for pending test batches. When work arrives, it spawns your command as a subprocess with these environment variables:

| Variable | Description |
|---|---|
| `VOXLI_API_KEY` | Your API key |
| `TEST_RESULT_IDS` | JSON array of test result IDs to run |
| `RUN_ID` | The run ID (if part of a run) |

## Commands

| Command | Description |
|---|---|
| `voxli auth` | Authenticate with your API key |
| `voxli listen --command <cmd>` | Poll for pending test work and run it locally |
