import { Router } from 'express';
import { z } from 'zod';
import { authGuard, optionalAuth } from '../../middleware/authGuard.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  createGuest,
  getSessionUser,
  updateProfile,
  verifyPhoneAndSignIn,
} from './auth.service.js';
import {
  confirmEmail,
  loginWithEmail,
  registerWithEmail,
  requestEmailVerification,
} from './email.service.js';
import { MAX_PASSWORD_LENGTH } from './password.js';
import { requestOtp } from './otp.service.js';
import { revokeRefreshTokens, rotateRefreshToken } from './tokens.js';

const deviceSchema = z.object({
  deviceId: z.string().min(8).max(128),
  platform: z.enum(['android', 'ios', 'web']),
  appVersion: z.string().max(32).optional(),
  pushToken: z.string().max(512).optional(),
});

const phoneSchema = z
  .string()
  .regex(/^\+[1-9]\d{7,14}$/, 'Phone must be E.164, e.g. +919876543210');

export function buildAuthRouter(): Router {
  const router = Router();

  // Anonymous session. Called on first launch, before any signup prompt.
  // Unlimited guest creation is free account minting — one script could fill the
  // users table and poison every device-based fraud signal. Capped per device
  // first (the tighter bound) and per IP second (for a rotating device id).
  router.post(
    '/guest',
    rateLimit({ scope: 'guest:device', limit: 5, windowMs: 3_600_000, by: 'device' }),
    rateLimit({ scope: 'guest:ip', limit: 30, windowMs: 3_600_000, by: 'ip' }),
    validate(z.object({ device: deviceSchema })),
    async (req, res, next) => {
      try {
        res.status(201).json(await createGuest(req.body.device));
      } catch (err) {
        next(err);
      }
    },
  );

  // The service already caps sends per PHONE. This caps them per IP, which is
  // what stops an attacker walking through numbers a few at a time each.
  router.post(
    '/otp/request',
    rateLimit({ scope: 'otp:send:ip', limit: 20, windowMs: 3_600_000, by: 'ip' }),
    validate(
      z.object({
        phone: phoneSchema,
        channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(await requestOtp(req.body.phone, req.body.channel));
      } catch (err) {
        next(err);
      }
    },
  );

  // optionalAuth: a guest sends their token so the account upgrades in place and
  // keeps its id. Without one, a fresh registered user is created instead.
  router.post(
    '/otp/verify',
    rateLimit({
      scope: 'otp:verify:ip',
      limit: 20,
      windowMs: 900_000,
      by: 'ip',
      failuresOnly: true,
    }),
    optionalAuth(),
    validate(
      z.object({
        phone: phoneSchema,
        code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
        device: deviceSchema,
      }),
    ),
    async (req, res, next) => {
      try {
        const result = await verifyPhoneAndSignIn({
          phoneE164: req.body.phone,
          code: req.body.code,
          device: req.body.device,
          guestUserId: req.userStatus === 'guest' ? req.userId : undefined,
        });
        res.json(result);
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Email
  //
  // The secondary path. Phone stays primary — it is what India signs up with
  // and what the payout identity is eventually tied to — but an account with
  // no recovery channel is one lost SIM away from an unresolvable ticket.
  //
  // Verification is DEFERRABLE: the account works immediately and confirming
  // the address happens whenever. What it gates is money, not access.
  // ---------------------------------------------------------------------

  const emailSchema = z.string().email().max(254).transform((value) => value.trim());
  // Bounded, because scrypt is deliberately slow: an unbounded password is an
  // unauthenticated denial of service costing the attacker one request.
  const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

  router.post(
    '/email/register',
    rateLimit({ scope: 'email:register:ip', limit: 10, windowMs: 3_600_000, by: 'ip' }),
    optionalAuth(),
    validate(
      z.object({ email: emailSchema, password: passwordSchema, device: deviceSchema }),
    ),
    async (req, res, next) => {
      try {
        res.status(201).json(
          await registerWithEmail({
            email: req.body.email,
            password: req.body.password,
            device: req.body.device,
            // A guest is upgraded IN PLACE, so nothing earned before signing up
            // is orphaned — the same rule as phone signup.
            guestUserId: req.userStatus === 'guest' ? req.userId : undefined,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/email/login',
    // failuresOnly, so a person typing one wrong password is not locked out by
    // their own successful retry. Per IP, because the attacker controls the
    // email field and would otherwise just rotate it.
    rateLimit({
      scope: 'email:login:ip',
      limit: 20,
      windowMs: 900_000,
      by: 'ip',
      failuresOnly: true,
    }),
    validate(z.object({ email: emailSchema, password: passwordSchema, device: deviceSchema })),
    async (req, res, next) => {
      try {
        res.json(
          await loginWithEmail({
            email: req.body.email,
            password: req.body.password,
            device: req.body.device,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/email/verify/request', authGuard(), async (req, res, next) => {
    try {
      await requestEmailVerification(req.userId!);
      res.status(202).json({ sent: true });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/email/verify',
    authGuard(),
    rateLimit({ scope: 'email:verify', limit: 20, windowMs: 900_000, by: 'user', failuresOnly: true }),
    validate(z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') })),
    async (req, res, next) => {
      try {
        res.json(await confirmEmail(req.userId!, req.body.code));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/refresh',
    rateLimit({ scope: 'refresh:ip', limit: 60, windowMs: 900_000, by: 'ip', failuresOnly: true }),
    validate(z.object({ refreshToken: z.string().min(20).max(256) })),
    async (req, res, next) => {
      try {
        res.json(await rotateRefreshToken(req.body.refreshToken));
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/logout',
    authGuard(),
    validate(z.object({ deviceId: z.string().optional(), allDevices: z.boolean().default(false) })),
    async (req, res, next) => {
      try {
        const revoked = await revokeRefreshTokens(
          req.userId!,
          req.body.allDevices ? undefined : req.body.deviceId,
        );
        res.json({ revoked });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get('/me', authGuard(), async (req, res, next) => {
    try {
      res.json({ user: await getSessionUser(req.userId!) });
    } catch (err) {
      next(err);
    }
  });

  router.patch(
    '/profile',
    authGuard(),
    validate(
      z.object({
        displayName: z.string().min(2).max(32).optional(),
        avatarUrl: z.string().url().max(512).optional(),
        bio: z.string().max(280).optional(),
        gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional(),
        dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json({ user: await updateProfile(req.userId!, req.body) });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
