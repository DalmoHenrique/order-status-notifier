import { z } from 'zod';
import { ORDER_STATUSES } from './order-status';

// Types alone don't protect me at runtime: the payload comes from another system,
// so I validate it before it ever reaches the queue.
export const orderEventSchema = z.object({
  eventId: z.string().min(1),
  orderId: z.string().min(1).max(64),
  status: z.enum(ORDER_STATUSES),
  occurredAt: z.iso.datetime(),
  customer: z.object({
    name: z.string().min(1).max(80),
    phone: z.string().regex(/^\+[1-9]\d{7,14}$/, 'phone must be in E.164 format, e.g. +5511999999999'),
  }),
});

export type OrderEvent = z.infer<typeof orderEventSchema>;

export type ParseResult =
  | { ok: true; event: OrderEvent }
  | { ok: false; errors: string[] };

export function parseOrderEvent(input: unknown): ParseResult {
  const result = orderEventSchema.safeParse(input);
  if (result.success) return { ok: true, event: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`),
  };
}
