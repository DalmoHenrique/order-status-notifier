import { spawn } from 'node:child_process';
import { emulatorEnv } from './emulator-env';

// Usage: tsx local/launch.ts <script.ts>
// Starts the script with the environment that points the AWS SDK at AWS Emulator.
const script = process.argv[2];
if (!script) {
  console.error('Usage: tsx local/launch.ts <script.ts>');
  process.exit(1);
}

const env: NodeJS.ProcessEnv = { ...process.env, ...emulatorEnv() };
for (const name of ['AWS_PROFILE', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN']) {
  delete env[name];
}

const child = spawn(process.execPath, ['--import', 'tsx', script], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
