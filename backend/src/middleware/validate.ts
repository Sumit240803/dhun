import { NextFunction, Request, Response } from 'express';
import { ZodError, ZodIssue, ZodTypeAny } from 'zod';
import { FieldIssue, UnsafePayloadError, ValidationError } from '../infra/errors.js';

/**
 * Property names a client may never send.
 *
 * Assigning to `__proto__` or `constructor.prototype` through a parsed body is
 * the classic prototype-pollution route, and it turns a harmless-looking JSON
 * field into a way to change the behaviour of every object in the process.
 */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function assertNoUnsafeKeys(value: unknown, depth = 0): void {
  if (depth > 20 || value === null || typeof value !== 'object') return;

  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) throw new UnsafePayloadError(key);
    assertNoUnsafeKeys((value as Record<string, unknown>)[key], depth + 1);
  }
}

/**
 * Turns a zod issue into something safe to send back.
 *
 * Zod's default messages for several codes echo the caller's own input — an enum
 * mismatch renders as `received 'whatever-they-sent'`. Reflecting input back is
 * how a JSON error becomes an XSS vector once some client renders it, so those
 * codes get fixed wording instead. The field PATH is always safe and is the only
 * part the user actually needs.
 */
function safeIssue(issue: ZodIssue): FieldIssue {
  const field = issue.path.length ? issue.path.join('.') : '(root)';

  switch (issue.code) {
    case 'invalid_enum_value':
      return { field, code: issue.code, message: 'Not one of the allowed values' };
    case 'invalid_literal':
      return { field, code: issue.code, message: 'Value is not permitted here' };
    case 'unrecognized_keys':
      return { field, code: issue.code, message: 'Unknown field' };
    case 'invalid_type':
      return { field, code: issue.code, message: `Expected ${issue.expected}` };
    case 'invalid_union':
      return { field, code: issue.code, message: 'Value does not match any allowed form' };
    case 'invalid_string':
      // `validation` is a fixed vocabulary (email/url/uuid/regex), never user input.
      return {
        field,
        code: issue.code,
        message:
          typeof issue.validation === 'string' && issue.validation !== 'regex'
            ? `Must be a valid ${issue.validation}`
            : truncate(issue.message),
      };
    default:
      // Remaining zod messages describe the CONSTRAINT ("String must contain at
      // least 8 character(s)"), not the value, so they are safe to pass through.
      return { field, code: issue.code, message: truncate(issue.message) };
  }
}

function truncate(message: string, max = 160): string {
  return message.length <= max ? message : `${message.slice(0, max - 1)}…`;
}

export function toFieldIssues(err: ZodError): FieldIssue[] {
  // Capped: a deeply nested body could otherwise produce hundreds of issues and
  // turn a bad request into an amplification vector.
  return err.issues.slice(0, 25).map(safeIssue);
}

export interface ValidationTargets {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Validates body, query and route params.
 *
 * Objects are made `.strict()` automatically, so an unknown key is REJECTED
 * rather than silently stripped. Silent stripping hides client bugs and, on a
 * money endpoint, hides the difference between "the field was ignored" and "the
 * field was applied".
 *
 * Accepts a bare schema as shorthand for `{ body }`.
 */
export function validate(targets: ValidationTargets | ZodTypeAny) {
  const spec: ValidationTargets =
    typeof (targets as ZodTypeAny)?.safeParse === 'function'
      ? { body: targets as ZodTypeAny }
      : (targets as ValidationTargets);

  const strict = (schema?: ZodTypeAny) => {
    if (!schema) return undefined;
    const s = schema as ZodTypeAny & { strict?: () => ZodTypeAny };
    return typeof s.strict === 'function' ? s.strict() : schema;
  };

  const bodySchema = strict(spec.body);
  const querySchema = strict(spec.query);
  const paramsSchema = strict(spec.params);

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (req.body !== undefined) assertNoUnsafeKeys(req.body);

      const issues: FieldIssue[] = [];

      if (bodySchema) {
        const result = bodySchema.safeParse(req.body ?? {});
        if (result.success) req.body = result.data;
        else issues.push(...toFieldIssues(result.error).map((i) => ({ ...i, field: `body.${i.field}` })));
      }

      if (querySchema) {
        const result = querySchema.safeParse(req.query ?? {});
        // req.query has only a getter on Express 5, so the parsed value is kept
        // beside it rather than assigned over it.
        if (result.success) req.validatedQuery = result.data as Record<string, unknown>;
        else issues.push(...toFieldIssues(result.error).map((i) => ({ ...i, field: `query.${i.field}` })));
      }

      if (paramsSchema) {
        const result = paramsSchema.safeParse(req.params ?? {});
        if (result.success) req.validatedParams = result.data as Record<string, unknown>;
        else issues.push(...toFieldIssues(result.error).map((i) => ({ ...i, field: `params.${i.field}` })));
      }

      if (issues.length) throw new ValidationError(issues);
      next();
    } catch (err) {
      next(err);
    }
  };
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      validatedQuery?: Record<string, unknown>;
      validatedParams?: Record<string, unknown>;
    }
  }
}
