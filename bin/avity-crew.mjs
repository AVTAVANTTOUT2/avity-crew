#!/usr/bin/env node
import { main } from '../dist/apps/cli/src/main.js';
process.exitCode = await main();
