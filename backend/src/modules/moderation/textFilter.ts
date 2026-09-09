// Chat text filtering for Hindi, English and the Hinglish in between.
//
// ── Why a plain wordlist does not work here ─────────────────────────────────
//
// English profanity filtering is a set lookup. Hinglish is not, because the
// same word has no canonical spelling — it is a Hindi word written in Latin
// letters by someone typing fast on a phone keyboard. One word might arrive as
// any of a dozen spellings, or in Devanagari, or with the vowels dropped
// entirely. A literal list would catch the first spelling and miss the rest,
// which is worse than no filter: it looks like it works.
//
// So everything is NORMALISED to a skeleton before matching, and the list is
// written in skeleton form:
//
//   1. Devanagari is transliterated to Latin, so the script stops mattering.
//   2. Leetspeak folds — 0→o, 1→i, 3→e, @→a, $→s.
//   3. Separators between letters are stripped, so `b.e.n.c.h` collapses.
//   4. Repeated letters collapse, so `beeeenchod` and `benchod` are one word.
//   5. Vowels are dropped for the second pass, so spelling variants that differ
//      only in their vowels — which is most of them — land on one skeleton.
//
// ── What it deliberately does NOT do ────────────────────────────────────────
//
// No context, no sentiment, no ML. This catches slurs and abuse in a chat
// line; it does not catch harassment expressed politely, and it never will.
// That is what Hive (Track 0) and human review are for. Treating this as the
// whole of trust and safety would be the mistake.
//
// ── Where the list should live ──────────────────────────────────────────────
//
// ⚠️ The seed list below is a STARTER, not a policy. It belongs in
// `app_config` so the T&S team can update it without an app release or a
// deploy — day-1 non-negotiable #6 — and the loader should read it from there
// once someone owns it. Hard-coding a moderation policy in a source file means
// every update is an engineering ticket, which in practice means it never gets
// updated.

/** Devanagari → Latin, enough for the letters that appear in abuse. */
const DEVANAGARI: Record<string, string> = {
  अ: 'a', आ: 'a', इ: 'i', ई: 'i', उ: 'u', ऊ: 'u', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au',
  क: 'k', ख: 'kh', ग: 'g', घ: 'gh', च: 'ch', छ: 'chh', ज: 'j', झ: 'jh',
  ट: 't', ठ: 'th', ड: 'd', ढ: 'dh', ण: 'n', त: 't', थ: 'th', द: 'd', ध: 'dh', न: 'n',
  प: 'p', फ: 'ph', ब: 'b', भ: 'bh', म: 'm', य: 'y', र: 'r', ल: 'l', व: 'v',
  श: 'sh', ष: 'sh', स: 's', ह: 'h', ळ: 'l', क़: 'k', ख़: 'kh', ग़: 'g', ज़: 'z', ड़: 'd', ढ़: 'dh', फ़: 'f',
  // Vowel signs and the virama. Dropped rather than mapped: they modify the
  // preceding consonant and the skeleton does not care about vowels anyway.
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
  '्': '', 'ं': 'n', 'ँ': 'n', 'ः': '',
};

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i',
};

/**
 * Severe: blocked outright, never delivered.
 *
 * Written as SKELETONS — consonants only, repeats collapsed — because that is
 * what `skeleton()` produces. `bhosdike`, `bhosadike` and `bhsdk` all reduce to
 * `bhsdk`, so one entry covers the family.
 */
const BLOCK_SKELETONS = new Set([
  'bhsdk', 'mdrchd', 'bhnchd', 'lnd', 'gnd', 'rnd', 'chty', 'chd',
  'fk', 'fkr', 'fkng', 'cnt', 'nggr', 'rp', 'rpst',
]);

/**
 * Milder: delivered with the word masked.
 *
 * The message still arrives, because dropping it entirely for a mild word
 * makes a room feel broken — people repeat themselves, louder.
 */
const MASK_SKELETONS = new Set(['kty', 'kmn', 'hrmzd', 'bstrd', 'sht', 'btch', 'dck']);

/**
 * Short words, matched WITH their vowels.
 *
 * A test caught why this list has to exist separately. `sala` reduces to the
 * skeleton `sl` — and so do `salaam`, `sale`, `sail`, `soul` and `isle`. A
 * two-letter skeleton cannot tell a slur from a greeting, and a filter that
 * eats "salaam" out of every hello is far more damaging than one that misses a
 * mild word: it is wrong in front of innocent users, constantly.
 *
 * So anything whose skeleton is under three characters is matched on its
 * FLATTENED form instead, where the vowels still separate `sala` from `salaam`.
 * Written in flattened form: lower case, repeats collapsed, letters only.
 */
const MASK_EXACT = new Set(['sala', 'sale', 'kuta', 'kute', 'gadha', 'ulu']);

export type FilterVerdict = 'clean' | 'filtered' | 'blocked';

export interface FilterResult {
  verdict: FilterVerdict;
  /** What to deliver. Equals the input when clean; masked when filtered. */
  body: string;
}

/**
 * Folds one token to its comparison form.
 *
 * Two stages, because they answer different questions: `flatten` makes scripts
 * and lookalikes comparable, and dropping the vowels afterwards makes spelling
 * variants comparable.
 */
function flatten(token: string): string {
  const transliterated = [...token.toLowerCase()]
    .map((char) => DEVANAGARI[char] ?? LEET[char] ?? char)
    .join('');

  return (
    transliterated
      // Unicode decomposition, then strip the marks — turns é into e and
      // handles the accented lookalikes people paste to dodge filters.
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      // Anything that is not a letter. This is what collapses b.e.n.c.h and
      // b*e*n*c*h onto the same skeleton.
      .replace(/[^a-z]/g, '')
      // aaaa → a
      .replace(/(.)\1+/g, '$1')
  );
}

function skeleton(token: string): string {
  return flatten(token).replace(/[aeiou]/g, '');
}

/**
 * Checks one message.
 *
 * Every token is tested, and the WHOLE message is tested as one token as well —
 * otherwise `b h o s d i k e` typed with spaces walks straight through, which
 * is the first thing anyone tries.
 */
export function filterText(input: string): FilterResult {
  const tokens = input.split(/\s+/).filter(Boolean);
  const joined = skeleton(input);

  if (BLOCK_SKELETONS.has(joined)) {
    return { verdict: 'blocked', body: input };
  }

  let filtered = false;
  const output: string[] = [];

  for (const token of tokens) {
    const bones = skeleton(token);

    // Under three consonants the skeleton is ambiguous — see MASK_EXACT — so
    // those words are matched with their vowels still attached.
    const matched =
      bones.length >= 3
        ? BLOCK_SKELETONS.has(bones) || MASK_SKELETONS.has(bones)
        : MASK_EXACT.has(flatten(token));

    if (!matched) {
      output.push(token);
      continue;
    }

    if (bones.length >= 3 && BLOCK_SKELETONS.has(bones)) {
      return { verdict: 'blocked', body: input };
    }

    filtered = true;
    output.push('*'.repeat(token.length));
  }

  return filtered
    ? { verdict: 'filtered', body: output.join(' ') }
    : { verdict: 'clean', body: input };
}
