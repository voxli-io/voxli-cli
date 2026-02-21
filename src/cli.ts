#!/usr/bin/env node
import { Command } from "commander";
import { authCommand } from "./commands/auth.js";
import { listenCommand } from "./commands/listen.js";

const program = new Command();

program
  .name("voxli")
  .description("CLI agent for running Voxli test scenarios locally")
  .version("0.1.0");

program
  .command("auth")
  .description("Authenticate with your Voxli API key")
  .option("--manual", "Enter API key manually instead of browser auth")
  .action(authCommand);

program
  .command("listen")
  .description("Poll for pending test work and run it locally")
  .requiredOption("--command <cmd>", "Shell command to run per batch")
  .action(listenCommand);

program.parse();
