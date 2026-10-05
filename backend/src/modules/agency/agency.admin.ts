// Agency creation — admin only, never from the app.
//
// Registration is an email to the official address, a conversation, then
// manual onboarding. When the admin creates the row, the agency exists; there
// is no application table and no approval queue (build-plan M12, step 1).

import { uuidv7 } from 'uuidv7';
import { pool, withTransaction } from '../../infra/db.js';
import { AppError } from '../../infra/errors.js';
import { agentSeat, type AgencyRef, type AgentSeat } from './agency.service.js';

export interface CreateAgencyInput {
  ownerPublicId: number;
  name: string;
  contactEmail?: string;
  /** The single in-house agency for platform-seeded hosts. Earns no commission. */
  isHouse?: boolean;
}

/**
 * Grant or withdraw coin trading.
 *
 * Withdrawing it stops new transfers at once; it does not touch inventory the
 * agency has already paid for, which is theirs and is settled off-platform if
 * the relationship ends.
 */
export async function setCoinTrading(
  adminUserId: string,
  agencyId: string,
  enabled: boolean,
): Promise<AgencyRef> {
  const { rows } = await pool.query(
    `UPDATE agencies
        SET coin_trading_enabled_at = CASE WHEN $2 THEN now() END,
            coin_trading_enabled_by = CASE WHEN $2 THEN $3::uuid END
      WHERE id = $1
      RETURNING id, public_id, name, is_house`,
    [agencyId, enabled, adminUserId],
  );
  if (!rows[0]) throw new AppError('AGENCY_NOT_FOUND', 'That agency does not exist', 404);
  return {
    id: rows[0].id,
    publicId: Number(rows[0].public_id),
    name: rows[0].name,
    isHouse: rows[0].is_house,
  };
}

export async function createAgency(
  adminUserId: string,
  input: CreateAgencyInput,
): Promise<AgentSeat> {
  const { rows: owners } = await pool.query(
    "SELECT id FROM users WHERE public_id = $1 AND status = 'active'",
    [input.ownerPublicId],
  );
  const owner = owners[0];
  if (!owner) throw new AppError('OWNER_NOT_FOUND', 'No registered user has that User ID', 404);

  await withTransaction(async (c) => {
    await c.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [owner.id]);

    const { rows: seats } = await c.query('SELECT 1 FROM agents WHERE user_id = $1', [owner.id]);
    if (seats[0]) {
      throw new AppError('ALREADY_AN_AGENT', 'That user already holds an agent seat', 409);
    }
    // An agency owner cannot also be a host in someone else's agency: they
    // would be earning commission above themselves.
    const { rows: hosting } = await c.query(
      'SELECT 1 FROM host_agent_assignments WHERE host_user_id = $1 AND effective_to IS NULL',
      [owner.id],
    );
    if (hosting[0]) {
      throw new AppError(
        'OWNER_IS_HOST',
        'That user is a host in an agency and must leave it first',
        409,
      );
    }
    if (input.isHouse) {
      const { rows: house } = await c.query('SELECT 1 FROM agencies WHERE is_house');
      if (house[0])
        throw new AppError('HOUSE_AGENCY_EXISTS', 'The in-house agency already exists', 409);
    }

    const agencyId = uuidv7();
    const agentId = uuidv7();
    await c.query(
      `INSERT INTO agencies (id, name, owner_user_id, owner_agent_id, contact_email, is_house, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        agencyId,
        input.name,
        owner.id,
        agentId,
        input.contactEmail ?? null,
        input.isHouse ?? false,
        adminUserId,
      ],
    );
    await c.query(
      'INSERT INTO agents (id, user_id, can_manage_agents, created_by) VALUES ($1, $2, true, $3)',
      [agentId, owner.id, adminUserId],
    );
    await c.query(
      'INSERT INTO agent_agency_assignments (id, agent_id, agency_id, created_by) VALUES ($1, $2, $3, $4)',
      [uuidv7(), agentId, agencyId, adminUserId],
    );
    await c.query(
      `INSERT INTO role_assignments (id, user_id, role_code, scope_type, scope_id, granted_by, reason)
       VALUES ($1, $2, 'agency_owner', 'agency', $3, $4, 'agency created')`,
      [uuidv7(), owner.id, agencyId, adminUserId],
    );
  });

  const seat = await agentSeat(owner.id);
  if (!seat) throw new AppError('INTERNAL', 'Agency was created but could not be read back', 500);
  return seat;
}
