import { Router } from 'express';
import { z } from 'zod';
import { authGuard, optionalAuth, requireRegistered } from '../../middleware/authGuard.js';
import { validate } from '../../middleware/validate.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import {
  createGuest,
  getSessionUser,
  signInWithWidgetToken,
  updateProfile,
  verifyPhoneAndSignIn,
} from './auth.service.js';
import { deleteAccount, listSessions, revokeSession } from './account.service.js';
import {
  changePassword,
  confirmEmail,
  loginWithEmail,
  registerWithEmail,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
} from './email.service.js';
import { MAX_PASSWORD_LENGTH } from './password.js';
import { requestOtp } from './otp.service.js';
import { confirmPhoneChange, requestPhoneChange } from './phone.service.js';
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

  // MSG91 widget sign-in.
  //
  // The app talks to MSG91 directly — the widget sends the code and checks it
  // client-side — so what arrives here is a string the client CLAIMS MSG91
  // gave it. This route is where that claim is confirmed with the account
  // authkey, which never leaves the server, before anything is trusted.
  //
  // Rate-limited despite the token being unforgeable: an attacker who cannot
  // mint a valid token can still make us call MSG91 on every request.
  router.post(
    '/otp/widget/verify',
    rateLimit({
      scope: 'widget:verify:ip',
      limit: 30,
      windowMs: 900_000,
      by: 'ip',
      failuresOnly: true,
    }),
    optionalAuth(),
    validate(
      z.object({
        // Bounded like every other client string. A JWT-shaped value is well
        // under this; anything larger is not a token.
        accessToken: z.string().min(10).max(2048),
        device: deviceSchema,
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await signInWithWidgetToken({
            accessToken: req.body.accessToken,
            device: req.body.device,
            // A guest is upgraded in place, exactly as in the OTP path.
            guestUserId: req.userStatus === 'guest' ? req.userId : undefined,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Password reset
  //
  // Without this a forgotten password is an unrecoverable account, which is
  // why it ships alongside email login rather than after it.
  // ---------------------------------------------------------------------

  router.post(
    '/email/password/forgot',
    // Per IP, because the attacker controls the address field. The per-address
    // limit lives in issueCode, so neither can be used to probe the other.
    rateLimit({ scope: 'password:forgot:ip', limit: 10, windowMs: 3_600_000, by: 'ip' }),
    validate(z.object({ email: emailSchema })),
    async (req, res, next) => {
      try {
        await requestPasswordReset(req.body.email);
        // 202 and an empty body, ALWAYS — whether or not the address exists.
        // Any difference here turns the form into an account-existence oracle.
        res.status(202).json({ sent: true });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/email/password/reset',
    rateLimit({
      scope: 'password:reset:ip',
      limit: 20,
      windowMs: 900_000,
      by: 'ip',
      failuresOnly: true,
    }),
    validate(
      z.object({
        email: emailSchema,
        code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
        password: passwordSchema,
      }),
    ),
    async (req, res, next) => {
      try {
        await resetPassword({
          email: req.body.email,
          code: req.body.code,
          password: req.body.password,
        });
        res.json({ reset: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // Changing a password requires the CURRENT one even though the caller is
  // signed in: a borrowed unlocked phone must not be able to lock the owner out.
  router.post(
    '/password/change',
    authGuard(),
    rateLimit({
      scope: 'password:change',
      limit: 10,
      windowMs: 900_000,
      by: 'user',
      failuresOnly: true,
    }),
    validate(
      z.object({
        currentPassword: passwordSchema,
        newPassword: passwordSchema,
        // Kept signed in. Changing a password should not sign you out of the
        // device in your hand — that reads as a failure, not as security.
        keepDeviceId: z.string().min(8).max(128).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        await changePassword({
          userId: req.userId!,
          currentPassword: req.body.currentPassword,
          newPassword: req.body.newPassword,
          keepDeviceId: req.body.keepDeviceId,
        });
        res.json({ changed: true });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Changing the phone number
  //
  // The number is the account's primary identity and eventually the thing a
  // payout hangs off, so this is deliberately the most guarded flow here: the
  // password when there is one, an OTP on the NEW number, and every other
  // device signed out afterwards. See phone.service.ts for why the code goes
  // to the new number rather than the old one.
  // ---------------------------------------------------------------------

  router.post(
    '/phone/change/request',
    authGuard(),
    requireRegistered(),
    // Tighter than sign-in on purpose. There is no legitimate reason to start
    // this more than a handful of times an hour, and each attempt sends an SMS
    // to a number the caller chose.
    rateLimit({ scope: 'phone:change:user', limit: 5, windowMs: 3_600_000, by: 'user' }),
    rateLimit({ scope: 'phone:change:ip', limit: 15, windowMs: 3_600_000, by: 'ip' }),
    validate(
      z.object({
        phone: phoneSchema,
        channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
        password: passwordSchema.optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        res.json(
          await requestPhoneChange({
            userId: req.userId!,
            phoneE164: req.body.phone,
            channel: req.body.channel,
            password: req.body.password,
          }),
        );
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/phone/change/verify',
    authGuard(),
    requireRegistered(),
    rateLimit({
      scope: 'phone:change:verify',
      limit: 20,
      windowMs: 900_000,
      by: 'user',
      failuresOnly: true,
    }),
    validate(
      z.object({
        phone: phoneSchema,
        code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
        // Kept signed in, like the password change. Signing you out of the
        // device you are holding reads as a failure, not as security.
        keepDeviceId: z.string().min(8).max(128).optional(),
      }),
    ),
    async (req, res, next) => {
      try {
        const result = await confirmPhoneChange({
          userId: req.userId!,
          phoneE164: req.body.phone,
          code: req.body.code,
          keepDeviceId: req.body.keepDeviceId,
        });
        res.json({ ...result, user: await getSessionUser(req.userId!) });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------
  // Sessions and account
  // ---------------------------------------------------------------------

  router.get(
    '/sessions',
    authGuard(),
    validate({
      query: z.object({ deviceId: z.string().min(8).max(128).optional() }).strict(),
    }),
    async (req, res, next) => {
      try {
        const { deviceId } = req.validatedQuery as { deviceId?: string };
        res.json({ sessions: await listSessions(req.userId!, deviceId) });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/sessions/:deviceId',
    authGuard(),
    validate({ params: z.object({ deviceId: z.string().min(8).max(128) }).strict() }),
    async (req, res, next) => {
      try {
        const { deviceId } = req.validatedParams as { deviceId: string };
        res.json({ revoked: await revokeSession(req.userId!, deviceId) });
      } catch (err) {
        next(err);
      }
    },
  );

  // Required by Google Play for any app with accounts, and by DPDP Act 2023.
  // Anonymises rather than deletes — see the note in account.service.ts.
  router.post(
    '/account/delete',
    authGuard(),
    rateLimit({ scope: 'account:delete', limit: 5, windowMs: 3_600_000, by: 'user' }),
    validate(z.object({ password: passwordSchema.optional() })),
    async (req, res, next) => {
      try {
        await deleteAccount({ userId: req.userId!, password: req.body.password });
        res.json({ deleted: true });
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
