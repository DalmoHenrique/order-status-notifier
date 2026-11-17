import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { EMULATOR_PORT } from './emulator-env';

// Runs the image built from local/emulator/Dockerfile, following the user guide.
// The shared folder is where the emulator drops its credentials and CA certificate.
const shared = join(homedir(), '.aws', 'emulator');
mkdirSync(shared, { recursive: true });

const port = String(EMULATOR_PORT);
const args = ['run', '--rm', '--memory=2g', '--memory-swap=2g', '-p', `127.0.0.1:${port}:${port}`, '-e', 'EMULATOR_TELEMETRY=off'];

if (process.platform === 'win32') {
  args.push('-v', `${shared}:/home/emulator/.aws/emulator`);
} else {
  args.push('-e', `HOME=${homedir()}`, '-v', `${shared}:${shared}`);
  if (process.platform === 'linux' && process.getuid && process.getgid) {
    args.splice(1, 0, '--user', `${process.getuid()}:${process.getgid()}`);
  }
}
args.push('aws-emulator', '-p', port);

console.log(`Starting AWS Emulator on https://127.0.0.1:${port} (Ctrl+C to stop)`);
const child = spawn('docker', args, { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
