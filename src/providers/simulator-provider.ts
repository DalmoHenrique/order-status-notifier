import { randomUUID } from 'node:crypto';
import type { MessageProvider, OutgoingMessage, SendResult } from './message-provider';

let forcedOutage = false;

// I use this from the local simulator to show what happens when the provider is down:
// the message fails, SQS retries it, and after a few attempts it lands in the DLQ.
export function setSimulatorOutage(down: boolean) {
  forcedOutage = down;
}

export function isSimulatorDown() {
  return forcedOutage || process.env.SIMULATOR_FAIL === 'true';
}

export class SimulatorProvider implements MessageProvider {
  readonly name = 'simulator';

  async send(_message: OutgoingMessage): Promise<SendResult> {
    if (isSimulatorDown()) throw new Error('Simulator provider is unavailable');
    return { providerMessageId: `sim-${randomUUID()}` };
  }
}
