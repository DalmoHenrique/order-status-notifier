import type { OrderEvent } from '../src/domain/order-event';

export function buildEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    eventId: 'evt-1',
    orderId: 'ORD-1001',
    status: 'SHIPPED',
    occurredAt: '2026-11-16T12:00:00.000Z',
    customer: { name: 'Ana', phone: '+5511999990000' },
    ...overrides,
  };
}
