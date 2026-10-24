import { runMcpFromEnv } from '../../../dist/packages/supervisor/src/mcp.js';
try {
  await runMcpFromEnv();
} catch {
  process.exitCode = 1;
}
