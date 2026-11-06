import { describe, expect, it } from 'vitest';
import {
  catalogueSearchQuerySchema,
  MAX_AMOUNT_MINOR,
  moneyMinorSchema,
  priceLabel,
  setPriceRequestSchema,
  withIndicativeVat,
} from './catalogue.js';
import { formatKes } from './money.js';

describe('catalogue money (E3)', () => {
  it('formats minor units deterministically, with cents only when present', () => {
    expect(formatKes(0)).toBe('KES 0');
    expect(formatKes(350_000)).toBe('KES 3,500');
    expect(formatKes(350_050)).toBe('KES 3,500.50');
    expect(formatKes(5)).toBe('KES 0.05');
    expect(formatKes(MAX_AMOUNT_MINOR)).toBe('KES 10,000,000,000');
  });

  it('round-trips every amount: the label always shows exactly the stored minor units', () => {
    // Property test over a deterministic spread of amounts (no RNG dependency).
    for (let i = 0; i < 5_000; i += 1) {
      const minor = (i * 7_919 * 104_729) % MAX_AMOUNT_MINOR;
      const text = formatKes(minor).replace('KES ', '').replace(/,/g, '');
      const [whole = '0', cents = '0'] = text.split('.');
      expect(Number(whole) * 100 + Number(cents.padEnd(2, '0'))).toBe(minor);
    }
  });

  it('refuses floats, negatives and unsafe integers', () => {
    expect(() => formatKes(1.5)).toThrow(RangeError);
    expect(() => formatKes(-1)).toThrow(RangeError);
    expect(moneyMinorSchema.safeParse(1.5).success).toBe(false);
    expect(moneyMinorSchema.safeParse(-1).success).toBe(false);
    expect(moneyMinorSchema.safeParse(Number.MAX_SAFE_INTEGER).success).toBe(false);
    expect(moneyMinorSchema.safeParse(MAX_AMOUNT_MINOR).success).toBe(true);
  });

  it('adds indicative VAT at 16%, rounded to the cent', () => {
    expect(withIndicativeVat(350_000)).toBe(406_000);
    expect(withIndicativeVat(1)).toBe(1);
    expect(withIndicativeVat(3)).toBe(3);
    expect(withIndicativeVat(4)).toBe(5);
  });

  it('labels every pricing model', () => {
    const base = { unit: null, minQuantity: 1 };
    expect(priceLabel({ ...base, model: 'FIXED', amountMinor: 350_000 })).toBe('KES 3,500');
    expect(priceLabel({ ...base, model: 'FROM', amountMinor: 1_500_000 })).toBe('From KES 15,000');
    expect(priceLabel({ ...base, model: 'QUOTE', amountMinor: null })).toBe('Price on quotation');
    expect(
      priceLabel({ model: 'PER_UNIT', amountMinor: 120_000, unit: 'DEVICE', minQuantity: 5 }),
    ).toBe('KES 1,200 per device (min. 5 devices)');
    expect(
      priceLabel({ model: 'PER_UNIT', amountMinor: 250_000, unit: 'POINT', minQuantity: 1 }),
    ).toBe('KES 2,500 per cabling point');
  });

  it('a price request carries exactly what its model needs', () => {
    expect(setPriceRequestSchema.safeParse({ model: 'QUOTE' }).success).toBe(true);
    expect(setPriceRequestSchema.safeParse({ model: 'FIXED' }).success).toBe(false);
    expect(setPriceRequestSchema.safeParse({ model: 'FIXED', amountMinor: 12.5 }).success).toBe(
      false,
    );
    expect(setPriceRequestSchema.safeParse({ model: 'PER_UNIT', amountMinor: 100 }).success).toBe(
      false,
    );
    expect(
      setPriceRequestSchema.parse({ model: 'PER_UNIT', amountMinor: 100, unit: 'HOUR' }),
    ).toEqual({ model: 'PER_UNIT', amountMinor: 100, unit: 'HOUR', minQuantity: 1 });
  });
});

describe('catalogue search query', () => {
  it('coerces numbers from the query string and enforces limits', () => {
    expect(catalogueSearchQuerySchema.parse({ minPrice: '1000', limit: '10' })).toEqual({
      minPrice: 1000,
      limit: 10,
    });
    expect(catalogueSearchQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(catalogueSearchQuerySchema.safeParse({ minPrice: '1.5' }).success).toBe(false);
    expect(catalogueSearchQuerySchema.safeParse({ q: 'x'.repeat(101) }).success).toBe(false);
    expect(catalogueSearchQuerySchema.safeParse({ category: 'Bad Slug' }).success).toBe(false);
  });
});
