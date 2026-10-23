// The shape of the two free-coin dials in app_config.
//
// Shared between the rewards module, which reads them on every claim, and the
// admin panel's catalog page, which writes them. One schema in one place, so
// what the panel accepts is exactly what the claim code will parse — a dial
// the panel can save but the service rejects would fall back to defaults
// silently, which is the worst of both.

import { z } from 'zod';

export const freeCoinsSchema = z.object({
  signup: z.number().int().min(0),
  checkinLadder: z.array(z.number().int().min(0)).length(7),
  watch: z.object({
    coins: z.number().int().min(0),
    minutes: z.number().int().min(1),
    dailyCap: z.number().int().min(0),
  }),
  referral: z.object({
    coins: z.number().int().min(0),
    minPurchasePaise: z.number().int().min(0),
    attachWindowDays: z.number().int().min(0),
  }),
});

export const newUserRewardsSchema = z.object({
  windowDays: z.number().int().min(0).max(90),
  tasks: z.object({
    follow: z.number().int().min(0),
    gift: z.number().int().min(0),
    chat: z.number().int().min(0),
  }),
});
