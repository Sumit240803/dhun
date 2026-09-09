import { describe, expect, it } from 'vitest';
import { filterText } from '../src/modules/moderation/textFilter.js';

/**
 * The filter's whole job is catching the SAME word written many ways. A test
 * that only checks the canonical spelling proves nothing — that spelling is
 * the one case a plain wordlist would already handle.
 */
describe('filtering chat text', () => {
  it('leaves ordinary messages alone', () => {
    for (const text of [
      'hello everyone',
      'kaise ho aap sab',
      'नमस्ते दोस्तों',
      'good morning ☀️',
      'salaam bhai',
    ]) {
      expect(filterText(text).verdict, text).toBe('clean');
    }
  });

  it('catches a slur however it is spelled', () => {
    // Every one of these is the same word. A literal list catches the first
    // and misses the rest, which is worse than no filter — it looks like it
    // works right up until it does not.
    for (const text of [
      'bhosdike',
      'bhosadike',
      'bhosdk',
      'bhooosdike',
      'BhOsDiKe',
      'bh0sd1ke',
      'b.h.o.s.d.i.k.e',
      'b*h*o*s*d*i*k*e',
    ]) {
      expect(filterText(text).verdict, text).toBe('blocked');
    }
  });

  it('catches it in Devanagari', () => {
    // Same word, different script. Transliterating first is what makes one
    // list cover both, rather than two lists that drift apart.
    expect(filterText('मादरचोद').verdict).toBe('blocked');
  });

  it('catches it spaced out across the message', () => {
    // The first thing anyone tries. Testing each token alone would let this
    // straight through, which is why the whole message is folded too.
    expect(filterText('b h o s d i k e').verdict).toBe('blocked');
  });

  it('catches it inside a sentence', () => {
    expect(filterText('arre yaar tu bhosdike hai').verdict).toBe('blocked');
  });

  it('masks a milder word instead of dropping the message', () => {
    // Dropping a whole message for a mild word makes a room feel broken and
    // people repeat themselves, louder.
    const result = filterText('you are a sala idiot');
    expect(result.verdict).toBe('filtered');
    expect(result.body).not.toContain('sala');
    expect(result.body).toContain('idiot');
  });

  it('does not eat short words that merely look similar', () => {
    // A filter that swallows "salaam" out of a greeting is worse than one that
    // misses a word — it is visible to every innocent user, every day.
    for (const text of ['salaam bhai', 'sal', 'is it ok', 'a e i o u']) {
      expect(filterText(text).verdict, text).toBe('clean');
    }
  });

  it('returns the ORIGINAL text for a blocked message', () => {
    // The caller stores this. A moderator reviewing an appeal needs what was
    // actually typed, not a cleaned version of it.
    const result = filterText('bhosdike');
    expect(result.body).toBe('bhosdike');
  });
});
