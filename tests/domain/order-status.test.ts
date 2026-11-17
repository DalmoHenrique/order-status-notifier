import { isNewer, messageFor, statusRank } from '../../src/domain/order-status';

describe('order status rules', () => {
  it('ranks statuses in delivery order', () => {
    expect(statusRank('ORDER_PLACED')).toBeLessThan(statusRank('SHIPPED'));
    expect(statusRank('SHIPPED')).toBeLessThan(statusRank('DELIVERED'));
  });

  it('treats any status as newer when nothing was sent yet', () => {
    expect(isNewer('ORDER_PLACED', undefined)).toBe(true);
  });

  it('rejects the same status and older ones', () => {
    expect(isNewer('SHIPPED', 'SHIPPED')).toBe(false);
    expect(isNewer('SHIPPED', 'OUT_FOR_DELIVERY')).toBe(false);
  });

  it('accepts a status further along the flow', () => {
    expect(isNewer('DELIVERED', 'SHIPPED')).toBe(true);
  });

  it('builds a customer message with the order id', () => {
    expect(messageFor('OUT_FOR_DELIVERY', 'Ana', 'ORD-1')).toContain('ORD-1');
  });
});
