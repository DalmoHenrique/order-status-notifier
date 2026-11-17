export const ORDER_STATUSES = [
  'ORDER_PLACED',
  'PAYMENT_APPROVED',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

// An order only moves forward. I use the position in the list as its rank,
// so "is this update older than what the customer already saw?" becomes a number comparison.
export function statusRank(status: OrderStatus): number {
  return ORDER_STATUSES.indexOf(status) + 1;
}

export function isNewer(candidate: OrderStatus, current: OrderStatus | undefined): boolean {
  if (!current) return true;
  return statusRank(candidate) > statusRank(current);
}

const MESSAGES: Record<OrderStatus, (name: string, orderId: string) => string> = {
  ORDER_PLACED: (name, id) => `Hi ${name}, we got your order ${id}. We'll keep you posted here.`,
  PAYMENT_APPROVED: (name, id) => `Good news, ${name}: the payment for order ${id} was approved.`,
  SHIPPED: (name, id) => `${name}, order ${id} has shipped.`,
  OUT_FOR_DELIVERY: (name, id) => `${name}, order ${id} is out for delivery today.`,
  DELIVERED: (name, id) => `Order ${id} was delivered. Enjoy it, ${name}!`,
};

export function messageFor(status: OrderStatus, customerName: string, orderId: string): string {
  return MESSAGES[status](customerName, orderId);
}
