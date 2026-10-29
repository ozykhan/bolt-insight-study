import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The repo keeps one .env at its root. Load it before anything reads
// process.env (OpenTelemetry setup runs before Nest's ConfigModule does).
// Variables already set in the shell win over the file.
const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}
