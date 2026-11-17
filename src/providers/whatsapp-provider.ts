import type { MessageProvider, OutgoingMessage, SendResult } from './message-provider';

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  templateName: string;
  templateLanguage: string;
  apiVersion: string;
}

export function whatsAppConfigFromEnv(env: NodeJS.ProcessEnv = process.env): WhatsAppConfig {
  const accessToken = env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
  if (!accessToken || !phoneNumberId) {
    throw new Error('WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required for the WhatsApp provider');
  }
  return {
    accessToken,
    phoneNumberId,
    // hello_world comes pre-approved on Meta's test number, so it works before I get my own template approved.
    templateName: env.WHATSAPP_TEMPLATE_NAME ?? 'hello_world',
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en_US',
    apiVersion: env.WHATSAPP_API_VERSION ?? 'v21.0',
  };
}

// Business-initiated messages on WhatsApp have to use an approved template.
// My order template takes three variables: customer name, order id and status.
function templateComponents(config: WhatsAppConfig, message: OutgoingMessage) {
  if (config.templateName === 'hello_world') return undefined;
  return [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: message.customerName },
        { type: 'text', text: message.orderId },
        { type: 'text', text: message.status.replaceAll('_', ' ').toLowerCase() },
      ],
    },
  ];
}

export class WhatsAppProvider implements MessageProvider {
  readonly name = 'whatsapp';

  constructor(
    private readonly config: WhatsAppConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(message: OutgoingMessage): Promise<SendResult> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: this.config.templateName,
          language: { code: this.config.templateLanguage },
          components: templateComponents(this.config, message),
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WhatsApp API returned ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = (await response.json()) as { messages?: Array<{ id: string }> };
    const id = data.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp API response had no message id');
    return { providerMessageId: id };
  }
}
