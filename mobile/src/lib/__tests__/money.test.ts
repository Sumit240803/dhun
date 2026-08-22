import {
  approximateRupeesFromUnits,
  formatCoins,
  formatCompact,
  formatGems,
  formatPackContents,
  formatPoints,
  formatRupees,
} from '@/lib/money';
import { coins, gems, paise, points } from '@/lib/units';

// Money formatting is tested harder than anything else in the client: a rounding
// or grouping bug here is wrong on every screen simultaneously, and it is the
// kind of thing users notice immediately and trust less afterwards.

describe('Indian digit grouping', () => {
  it('groups by the lakh system, not thousands', () => {
    // The whole point. Western grouping would give 164,945 and read as foreign.
    expect(formatCoins(coins(164_945))).toBe('1,64,945');
    expect(formatCoins(coins(549_945))).toBe('5,49,945');
    expect(formatCoins(coins(1_00_00_000))).toBe('1,00,00,000');
  });

  it('leaves small numbers ungrouped', () => {
    expect(formatCoins(coins(45))).toBe('45');
    expect(formatCoins(coins(999))).toBe('999');
  });

  it('groups the first thousand normally', () => {
    expect(formatCoins(coins(16_445))).toBe('16,445');
  });

  it('formats every currency the same way', () => {
    expect(formatGems(gems(3_300))).toBe('3,300');
    expect(formatPoints(points(11_700))).toBe('11,700');
  });
});

describe('rupees from paise', () => {
  it('drops the decimal when there is no remainder', () => {
    expect(formatRupees(paise(29_900))).toBe('₹299');
    expect(formatRupees(paise(999_900))).toBe('₹9,999');
  });

  it('shows paise when there is a remainder', () => {
    expect(formatRupees(paise(29_950))).toBe('₹299.50');
    expect(formatRupees(paise(1))).toBe('₹0.01');
  });

  it('pads a single-digit remainder', () => {
    // ₹299.5 would be wrong; money always shows two decimal places.
    expect(formatRupees(paise(29_905))).toBe('₹299.05');
  });

  it('can be forced to show paise', () => {
    expect(formatRupees(paise(29_900), { alwaysShowPaise: true })).toBe('₹299.00');
  });

  it('handles negatives with the sign outside the symbol', () => {
    expect(formatRupees(paise(-29_900))).toBe('-₹299');
  });

  it('groups large rupee amounts by lakh', () => {
    expect(formatRupees(paise(1_50_00_000))).toBe('₹1,50,000');
  });
});

describe('compact form', () => {
  it('uses Indian scale words', () => {
    // "12.5L" reads naturally to this audience; "1.2M" does not.
    expect(formatCompact(1_250_000)).toBe('12.5L');
    expect(formatCompact(15_000_000)).toBe('1.5Cr');
    expect(formatCompact(5_400)).toBe('5.4K');
  });

  it('trims a trailing zero', () => {
    expect(formatCompact(2_000)).toBe('2K');
    expect(formatCompact(100_000)).toBe('1L');
  });

  it('leaves small numbers alone', () => {
    expect(formatCompact(945)).toBe('945');
  });
});

describe('approximate rupee value', () => {
  it('uses the accounting face value, not the pack rate', () => {
    // 65 units = ₹1 is the ACCOUNTING rate. The pack rate is 55/₹, deliberately
    // different — this function is for display beside a balance, never pricing.
    expect(approximateRupeesFromUnits(65)).toBe(100);
    expect(formatRupees(approximateRupeesFromUnits(16_445))).toBe('₹253');
  });

  it('floors rather than rounding up', () => {
    // Never overstate what a balance is worth.
    expect(approximateRupeesFromUnits(1)).toBe(1);
    expect(approximateRupeesFromUnits(64)).toBe(98);
  });
});

describe('pack contents', () => {
  it('names both currencies', () => {
    expect(formatPackContents(coins(16_445), gems(5_355))).toBe('16,445 coins + 5,355 gems');
  });

  it('omits a zero side', () => {
    expect(formatPackContents(coins(2_000), gems(0))).toBe('2,000 coins');
    expect(formatPackContents(coins(0), gems(3_300))).toBe('3,300 gems');
  });
});
