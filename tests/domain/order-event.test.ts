import { parseOrderEvent } from '../../src/domain/order-event';
import { buildEvent } from '../fixtures';

describe('parseOrderEvent', () => {
  it('accepts a valid event', () => {
    const result = parseOrderEvent(buildEvent());
    expect(result.ok).toBe(true);
  });

  it('rejects an unknown status', () => {
    const result = parseOrderEvent({ ...buildEvent(), status: 'LOST_IN_SPACE' });
    expect(result.ok).toBe(false);
  });

  it('rejects a phone outside E.164', () => {
    const result = parseOrderEvent(buildEvent({ customer: { name: 'Ana', phone: '11 99999-0000' } }));
    expect(result).toEqual({ ok: false, errors: [expect.stringContaining('customer.phone')] });
  });

  it('rejects a field with the wrong type', () => {
    // Same field, different type: the kind of bug TypeScript alone won't catch at runtime.
    const result = parseOrderEvent({ ...buildEvent(), orderId: 1001 });
    expect(result.ok).toBe(false);
  });

  it('reports every missing field', () => {
    const result = parseOrderEvent({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
