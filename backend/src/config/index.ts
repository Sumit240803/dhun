import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // Behind a load balancer req.ip is the proxy unless this is set, and every
  // IP-based rate limit would then throttle the whole fleet as one caller.
  TRUST_PROXY: z.string().default('false'),
  // Comma-separated allowlist for the web portal and admin panel. No wildcard:
  // the API is credentialed, so '*' is both invalid and a genuine hole.
  CORS_ORIGINS: z.string().default(''),
  // Caps a runaway query so one bad plan cannot exhaust the pool.
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().default(10_000),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(20_000),
  MAX_BODY_BYTES: z.coerce.number().default(262_144),

  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

  // console = print the code to the log (development only).
  // msg91 = the real sender, which needs TRAI DLT registration completed first.
  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  // 'none' is deliberately the default: an unconfigured deploy should fail
  // loudly on the first send rather than silently swallow every verification.
  EMAIL_PROVIDER: z.enum(['console', 'none']).default('none'),
  EMAIL_CODE_TTL_MINUTES: z.coerce.number().default(30),
  EMAIL_CODES_PER_HOUR: z.coerce.number().default(5),
  OTP_TTL_MINUTES: z.coerce.number().default(10),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  OTP_PER_PHONE_PER_HOUR: z.coerce.number().default(5),

  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_SENDER_ID: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),

  // stub = accept a well-formed token without calling the store (dev/test only).
  // google_play = the real Play Developer API, needs a service account.
  IAP_PROVIDER: z.enum(['stub', 'google_play']).default('stub'),
  GOOGLE_PLAY_PACKAGE_NAME: z.string().optional(),
  GOOGLE_PLAY_SERVICE_ACCOUNT_JSON: z.string().optional(),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),

  RTC_APP_ID: z.string().optional(),
  RTC_SERVER_SECRET: z.string().optional(),
});

const env = schema.parse(process.env);

export const config = {
  nodeEnv: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  port: env.PORT,
  logLevel: env.LOG_LEVEL,

  trustProxy:
    env.TRUST_PROXY === 'true'
      ? true
      : /^\d+$/.test(env.TRUST_PROXY)
        ? Number(env.TRUST_PROXY)
        : env.TRUST_PROXY === 'false'
          ? false
          : env.TRUST_PROXY,
  corsOrigins: env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
  dbStatementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
  requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  maxBodyBytes: env.MAX_BODY_BYTES,

  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,

  auth: {
    jwtSecret: env.JWT_SECRET,
    accessTokenTtlMinutes: env.ACCESS_TOKEN_TTL_MINUTES,
    refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
  },

  email: {
    provider: env.EMAIL_PROVIDER,
    // Longer than an SMS code's ten minutes: an email sits in an inbox someone
    // checks on their own schedule, and a code that expires before they open it
    // just generates another send.
    codeTtlMinutes: env.EMAIL_CODE_TTL_MINUTES,
    codesPerHour: env.EMAIL_CODES_PER_HOUR,
  },

  otp: {
    provider: env.OTP_PROVIDER,
    ttlMinutes: env.OTP_TTL_MINUTES,
    maxAttempts: env.OTP_MAX_ATTEMPTS,
    perPhonePerHour: env.OTP_PER_PHONE_PER_HOUR,
  },

  msg91: {
    authKey: env.MSG91_AUTH_KEY,
    senderId: env.MSG91_SENDER_ID,
    templateId: env.MSG91_TEMPLATE_ID,
  },

  iap: {
    provider: env.IAP_PROVIDER,
    playPackageName: env.GOOGLE_PLAY_PACKAGE_NAME,
    playServiceAccountJson: env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON,
  },

  razorpay: {
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
  },

  rtc: { appId: env.RTC_APP_ID, serverSecret: env.RTC_SERVER_SECRET },
};
