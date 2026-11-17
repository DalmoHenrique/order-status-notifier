type Level = 'info' | 'warn' | 'error';

// One JSON line per log entry, so CloudWatch Logs Insights can filter by any field.
function write(level: Level, message: string, fields: Record<string, unknown> = {}) {
  if (process.env.LOG_SILENT === 'true') return;
  const line = JSON.stringify({ level, message, time: new Date().toISOString(), ...fields });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => write('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write('error', message, fields),
};
