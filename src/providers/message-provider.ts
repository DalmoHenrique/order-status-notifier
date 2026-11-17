import type { OrderStatus } from '../domain/order-status';

export interface OutgoingMessage {
  to: string;
  customerName: string;
  orderId: string;
  status: OrderStatus;
  text: string;
}

export interface SendResult {
  providerMessageId: string;
}

// The notifier only knows this contract. Swapping the simulator for WhatsApp
// (or SMS, or e-mail) is a config change, not a code change in the pipeline.
export interface MessageProvider {
  readonly name: string;
  send(message: OutgoingMessage): Promise<SendResult>;
}
