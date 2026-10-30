import pino, { type Logger } from 'pino';

export function createLogger(level: string, service: string, pretty = false): Logger {
  return pino({
    level,
    base: { service },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.body.password',
        'req.body.refreshToken',
        '*.accessToken',
        '*.refreshToken',
      ],
      censor: '[redacted]',
    },
    ...(pretty ? { transport: { target: 'pino-pretty', options: { singleLine: true } } } : {}),
  });
}
