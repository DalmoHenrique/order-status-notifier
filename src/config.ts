function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

export const config = {
  get queueUrl() {
    return required('QUEUE_URL');
  },
  get tableName() {
    return required('TABLE_NAME');
  },
  // I read this on every call so I can switch notifications off without a redeploy.
  get notificationsEnabled() {
    return process.env.NOTIFICATIONS_ENABLED !== 'false';
  },
  get messageProvider() {
    return process.env.MESSAGE_PROVIDER ?? 'simulator';
  },
};
