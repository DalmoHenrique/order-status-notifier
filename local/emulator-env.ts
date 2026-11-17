import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const EMULATOR_PORT = Number(process.env.EMULATOR_PORT ?? 9297);

// AWS Emulator writes fresh credentials, an SDK config and its CA certificate
// to ~/.aws/emulator/<port>/ every time it starts.
export function emulatorDir(): string {
  return join(homedir(), '.aws', 'emulator', String(EMULATOR_PORT));
}

export function emulatorEnv(): Record<string, string> {
  const dir = emulatorDir();
  const caFile = join(dir, 'ca.pem');
  if (!existsSync(caFile)) {
    throw new Error(`AWS Emulator files not found in ${dir}. Start it first with: npm run emulator`);
  }
  return {
    AWS_ENDPOINT_URL: `https://127.0.0.1:${EMULATOR_PORT}`,
    AWS_SHARED_CREDENTIALS_FILE: join(dir, 'emulator_credentials'),
    AWS_CONFIG_FILE: join(dir, 'config'),
    AWS_REGION: 'us-east-1',
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_DISABLE_HOST_PREFIX_INJECTION: 'true',
    // Node only reads extra CAs at startup, which is why I launch the app as a child process.
    NODE_EXTRA_CA_CERTS: caFile,
  };
}
