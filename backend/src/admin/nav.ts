// What every admin page needs from the request, and who may do what.
//
// Lives apart from admin.routes.ts so the larger sections — agencies, the
// catalog — can be their own routers without reaching back into it.

import type { Request } from 'express';
import { queueCounts } from '../modules/verification/index.js';
import type { Nav } from './layout.js';

/** Suspend a host, decide an appeal. A moderator flags; a lead decides. */
export const CAN_SUSPEND = ['super_admin', 'ops_manager', 'ts_lead'];
/** The kill switches and the version floor. Ops, not moderation. */
export const CAN_SWITCH = ['super_admin', 'ops_manager'];
/** Agencies, prepays and the coin-trading grant — the same roles the JSON API requires. */
export const CAN_MANAGE_AGENCIES = ['super_admin', 'ops_manager'];
/** Prices and dials. Changing a gift price is changing what every user pays. */
export const CAN_EDIT_CATALOG = ['super_admin', 'ops_manager'];

export async function nav(req: Request, active: Nav['active']): Promise<Nav> {
  return {
    active,
    counts: await queueCounts(),
    staffName: req.staff!.name,
    csrf: req.staff!.csrf,
  };
}

/** Query strings and form fields are `string | string[] | ParsedQs`; this is the only shape we want. */
export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A form number: blank is undefined, anything else must be a whole number. */
export function asInt(value: unknown): number | undefined {
  const text = asText(value).trim().replace(/,/g, '');
  if (text === '') return undefined;
  return /^-?\d+$/.test(text) ? Number(text) : Number.NaN;
}

/** A checkbox: present means on. */
export function asFlag(value: unknown): boolean {
  return value === 'on' || value === 'true' || value === '1';
}
