import { createProvider } from '../../src/providers';
import type { OutgoingMessage } from '../../src/providers/message-provider';
import { SimulatorProvider, setSimulatorOutage } from '../../src/providers/simulator-provider';
import { WhatsAppProvider, type WhatsAppConfig } from '../../src/providers/whatsapp-provider';

const message: OutgoingMessage = {
  to: '+5511999990000',
  customerName: 'Ana',
  orderId: 'ORD-1001',
  status: 'OUT_FOR_DELIVERY',
  text: 'Ana, order ORD-1001 is out for delivery today.',
};

const whatsAppConfig: WhatsAppConfig = {
  accessToken: 'token',
  phoneNumberId: '12345',
  templateName: 'order_update',
  templateLanguage: 'en_US',
  apiVersion: 'v21.0',
};

function fakeFetch(status: number, body: unknown) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as jest.MockedFunction<typeof fetch>;
}

describe('SimulatorProvider', () => {
  afterEach(() => setSimulatorOutage(false));

  it('returns a message id', async () => {
    const result = await new SimulatorProvider().send(message);
    expect(result.providerMessageId).toMatch(/^sim-/);
  });

  it('fails while an outage is forced', async () => {
    setSimulatorOutage(true);
    await expect(new SimulatorProvider().send(message)).rejects.toThrow('unavailable');
  });
});

describe('WhatsAppProvider', () => {
  it('sends a template message to the Cloud API', async () => {
    const fetchFn = fakeFetch(200, { messages: [{ id: 'wamid.1' }] });

    const result = await new WhatsAppProvider(whatsAppConfig, fetchFn).send(message);

    expect(result.providerMessageId).toBe('wamid.1');
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://graph.facebook.com/v21.0/12345/messages');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ to: '5511999990000', type: 'template', template: { name: 'order_update' } });
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      'Ana',
      'ORD-1001',
      'out for delivery',
    ]);
  });

  it('skips template variables for hello_world', async () => {
    const fetchFn = fakeFetch(200, { messages: [{ id: 'wamid.2' }] });

    await new WhatsAppProvider({ ...whatsAppConfig, templateName: 'hello_world' }, fetchFn).send(message);

    const body = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string);
    expect(body.template.components).toBeUndefined();
  });

  it('turns an API error into a failure the queue can retry', async () => {
    const fetchFn = fakeFetch(401, { error: { message: 'Invalid OAuth access token' } });

    await expect(new WhatsAppProvider(whatsAppConfig, fetchFn).send(message)).rejects.toThrow('401');
  });
});

describe('createProvider', () => {
  it('builds the simulator by name', () => {
    expect(createProvider('simulator').name).toBe('simulator');
  });

  it('refuses an unknown provider', () => {
    expect(() => createProvider('carrier-pigeon')).toThrow('Unknown MESSAGE_PROVIDER');
  });

  it('asks for credentials before using WhatsApp', () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    expect(() => createProvider('whatsapp')).toThrow('WHATSAPP_ACCESS_TOKEN');
  });
});
