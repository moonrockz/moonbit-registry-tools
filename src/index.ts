#!/usr/bin/env bun
/**
 * MoonBit Registry CLI entry point
 */

import { createCli } from "./cli/index.ts";

const cli = createCli();
cli.parse(process.argv);
