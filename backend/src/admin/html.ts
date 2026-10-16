// HTML, with escaping as the default rather than something to remember.
//
// ── Why this exists instead of a template engine ────────────────────────────
//
// The admin panel renders user-supplied strings — display names, report text,
// room titles — into a page that a moderator is logged into. An XSS here is
// not a defaced page: it is script running in a session that can suspend
// accounts and read every host's photo.
//
// A template engine would do, but it is a dependency and a build step for four
// screens. A tagged template is enough, and it makes the safe thing automatic:
//
//     html`<p>${name}</p>`     escaped, always
//     html`<p>${raw(markup)}</p>`  not escaped, and visibly so at the call site
//
// This is the same principle as the LiveKit grants: the dangerous option has to
// be spelled out, so it cannot happen by forgetting.

/** Markup that is already safe. Only `html` and `raw` can produce one. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapes the five characters that matter in both element and attribute
 * contexts. Single quotes included, because `<a href='${x}'>` is a thing
 * somebody will write.
 */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

/**
 * Trusted markup, passed through unescaped.
 *
 * Only ever called with a string this file's own code produced. Never with
 * anything that came from a request, a database row, or a user.
 */
export function raw(markup: string): SafeHtml {
  return new SafeHtml(markup);
}

export type Renderable = SafeHtml | string | number | null | undefined | Renderable[];

function render(value: Renderable): string {
  if (value === null || value === undefined) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  // Numbers cannot carry markup; strings always can, so they are escaped.
  return typeof value === 'number' ? String(value) : escapeHtml(value);
}

export function html(strings: TemplateStringsArray, ...values: Renderable[]): SafeHtml {
  let out = strings[0]!;
  for (let i = 0; i < values.length; i += 1) {
    out += render(values[i]) + strings[i + 1]!;
  }
  return new SafeHtml(out);
}

/** A URL for an `href` or `src`, or `#` if it is not one we will emit. */
export function safeUrl(value: string | null | undefined): string {
  if (!value) return '#';
  // Blocks `javascript:` and `data:` — an attacker-supplied image URL is the
  // one place a stored string reaches an attribute that can execute.
  return /^https?:\/\//i.test(value) ? value : '#';
}
