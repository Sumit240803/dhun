import { en } from '@/i18n/en';
import { hi } from '@/i18n/hi';
import {
  LANGUAGES,
  LANGUAGE_LABELS,
  MAX_LANGUAGES,
  isLanguage,
  languageFromLocale,
  pickerSections,
  toggleLanguage,
} from '@/features/language/languages';

describe('languages', () => {
  it('names every language the same way in both catalogues', () => {
    // A speaker looks for their own script, whatever language the app is in.
    for (const code of LANGUAGES) {
      const key = LANGUAGE_LABELS[code].split('.')[1] as keyof typeof en.language;
      expect(en.language[key]).toBeTruthy();
      expect(hi.language[key]).toBe(en.language[key]);
    }
  });

  it('puts the person’s own languages first, in their order, then the rest', () => {
    const { yours, more } = pickerSections(['ta', 'hi']);
    expect(yours).toEqual(['ta', 'hi']);
    expect(more).not.toContain('ta');
    expect(more).not.toContain('hi');
    expect(yours.length + more.length).toBe(LANGUAGES.length);
  });

  it('drops codes it does not know and repeats, so a stale session draws no blank chip', () => {
    expect(pickerSections(['xx', 'bho', 'bho']).yours).toEqual(['bho']);
    expect(isLanguage('xx')).toBe(false);
    expect(isLanguage('bho')).toBe(true);
  });

  it('adds up to three and refuses a fourth rather than dropping the first', () => {
    let list = toggleLanguage([], 'hi').next;
    list = toggleLanguage(list, 'bho').next;
    list = toggleLanguage(list, 'en').next;
    expect(list).toHaveLength(MAX_LANGUAGES);

    const fourth = toggleLanguage(list, 'ta');
    expect(fourth.refused).toBe(true);
    expect(fourth.next).toEqual(['hi', 'bho', 'en']);
  });

  it('always lets one be removed', () => {
    const result = toggleLanguage(['hi', 'bho', 'en'], 'bho');
    expect(result).toEqual({ next: ['hi', 'en'], refused: false });
  });

  it('guesses from the app language before the person has said', () => {
    expect(languageFromLocale('en')).toBe('en');
    expect(languageFromLocale('hi')).toBe('hi');
  });
});
