#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";
import { authCommand } from "./commands/auth.js";
import { listenCommand } from "./commands/listen.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json") as { version: string };

const program = new Command();

program
  .name("voxli")
  .description("CLI agent for running Voxli test scenarios locally")
  .version(version);

program
  .command("auth")
  .description("Authenticate with your Voxli API key")
  .option("--manual", "Enter API key manually instead of browser auth")
  .option("--local", "Save credentials in the current directory")
  .action(authCommand);

program
  .command("listen")
  .description("Poll for pending test work and run it locally")
  .requiredOption("--command <cmd>", "Shell command to run per batch")
  .option("--name <name>", "Display name for this agent (defaults to hostname)")
  .action(listenCommand);

program.parse();
