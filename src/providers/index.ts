import type { MessageProvider } from './message-provider';
import { SimulatorProvider } from './simulator-provider';
import { WhatsAppProvider, whatsAppConfigFromEnv } from './whatsapp-provider';

export function createProvider(name: string): MessageProvider {
  switch (name) {
    case 'simulator':
      return new SimulatorProvider();
    case 'whatsapp':
      return new WhatsAppProvider(whatsAppConfigFromEnv());
    default:
      throw new Error(`Unknown MESSAGE_PROVIDER "${name}". Use "simulator" or "whatsapp".`);
  }
}

export type { MessageProvider, OutgoingMessage, SendResult } from './message-provider';
