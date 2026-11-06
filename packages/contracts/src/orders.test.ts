import { describe, expect, it } from 'vitest';
import {
  billingTermsSchema,
  submitServiceRequestSchema,
  documentTotals,
  lineTotals,
  recordPaymentSchema,
  vatOn,
} from './orders.js';

describe('order money (P7-6)', () => {
  it('rounds VAT half up to the cent', () => {
    expect(vatOn(0)).toBe(0);
    expect(vatOn(3)).toBe(0); // 0.48 → 0
    expect(vatOn(4)).toBe(1); // 0.64 → 1
    expect(vatOn(25)).toBe(4); // exactly 4.00
    expect(vatOn(350_000)).toBe(56_000);
    expect(() => vatOn(1.5)).toThrow(RangeError);
    expect(() => vatOn(-1)).toThrow(RangeError);
  });

  it('matches exact rational arithmetic for every amount (property test)', () => {
    for (let i = 0; i < 20_000; i += 1) {
      const net = (i * 104_729 + 7_919) % 100_000_000_000;
      // Reference: BigInt arithmetic, 16/100 with round half up.
      const exact = (BigInt(net) * 16n * 2n + 100n) / 200n;
      expect(vatOn(net), String(net)).toBe(Number(exact));
    }
  });

  it('totals are sums of the stored lines', () => {
    const lines = [
      lineTotals({ quantity: 3, unitAmountMinor: 333 }),
      lineTotals({ quantity: 1, unitAmountMinor: 1 }),
      lineTotals({ quantity: 10, unitAmountMinor: 250_000 }),
    ];
    expect(lines[0]).toEqual({ netMinor: 999, vatMinor: 160, totalMinor: 1_159 });
    const totals = documentTotals(lines);
    expect(totals).toEqual({
      subtotalMinor: 999 + 1 + 2_500_000,
      vatMinor: 160 + 0 + 400_000,
      totalMinor: 999 + 1 + 2_500_000 + 160 + 0 + 400_000,
    });
  });
});

describe('order contracts', () => {
  it('validates a request and its date window', () => {
    const base = {
      serviceSlug: 'home-wifi-setup',
      county: 'KE-30',
      address: 'Ngong Road, Nairobi',
      contactPhone: '+254712345678',
    };
    expect(submitServiceRequestSchema.parse(base)).toMatchObject({ quantity: 1, description: '' });
    expect(
      submitServiceRequestSchema.safeParse({
        ...base,
        preferredFrom: '2026-12-02',
        preferredTo: '2026-12-01',
      }).success,
    ).toBe(false);
    expect(submitServiceRequestSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false);
    expect(submitServiceRequestSchema.safeParse({ ...base, county: 'Nairobi' }).success).toBe(
      false,
    );
  });

  it('payments are positive integer minor units with a clean reference', () => {
    expect(
      recordPaymentSchema.safeParse({
        amountMinor: 0,
        method: 'BANK_TRANSFER',
        reference: 'TRX-001',
      }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({
        amountMinor: 10.5,
        method: 'BANK_TRANSFER',
        reference: 'TRX-001',
      }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({
        amountMinor: 100,
        method: 'MPESA_PAYBILL',
        reference: "x'; DROP",
      }).success,
    ).toBe(false);
    expect(
      recordPaymentSchema.safeParse({
        amountMinor: 100,
        method: 'MPESA_PAYBILL',
        reference: 'QJK7H2X9P1',
      }).success,
    ).toBe(true);
  });

  it('billing terms: postpaid needs net days, prepaid has none', () => {
    expect(billingTermsSchema.safeParse({ paymentTerms: 'POSTPAID', netDays: 30 }).success).toBe(
      true,
    );
    expect(billingTermsSchema.safeParse({ paymentTerms: 'POSTPAID', netDays: null }).success).toBe(
      false,
    );
    expect(billingTermsSchema.safeParse({ paymentTerms: 'PREPAY', netDays: 30 }).success).toBe(
      false,
    );
  });
});
