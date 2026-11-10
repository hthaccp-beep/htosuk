import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLondonDateTime,
  resolveSupplierSchedule,
  getCutoffStatus,
  getNextAvailableDeliveryDate,
  validateDeliveryDate,
  UK_BANK_HOLIDAYS,
} from '../utils/deliveryScheduler.ts';
import type { Supplier } from '../types.ts';

describe('Delivery Scheduler and Cutoff Clock (Issue 9)', () => {
  // Test Suppliers
  const jfcSupplier: Supplier = {
    id: 's_jfc',
    name: 'JFC International',
    email: 'orders@jfc-eu.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {
      default: 'Order by 10pm for Next Day Delivery.',
      b2: 'Order by 5pm (Aldgate Special Route).',
    },
  };

  const tazakiSupplier: Supplier = {
    id: 's_tazaki',
    name: 'Tazaki Foods Ltd',
    email: 'japanesesales@tazakifoods-com.example',
    active: true,
    deliveryRules: {
      default: [1, 3, 5], // Monday, Wednesday, Friday
    },
    deliverySchedules: {
      default: 'Mon/Wed/Fri Delivery only. Cutoff 5pm Day Before.',
    },
  };

  const internalSupplier: Supplier = {
    id: 's_internal',
    name: 'HT Internal Warehouse',
    email: 'warehouse@ht-com.example',
    active: true,
    deliveryRules: {},
    deliverySchedules: {
      default: 'Internal Transfer (2-3 Days). Order by 4pm.',
    },
  };

  // =========================================================================
  // 1. LONDON TIMEZONE & DST COORDINATION
  // =========================================================================
  describe('London Timezone & DST Coordination', () => {
    it('computes correct London time in winter (GMT / UTC+0)', () => {
      // Jan 15 at 14:30 UTC = 14:30 London
      const winterDate = new Date('2026-01-15T14:30:00.000Z');
      const london = getLondonDateTime(winterDate);
      assert.equal(london.year, 2026);
      assert.equal(london.month, 1);
      assert.equal(london.day, 15);
      assert.equal(london.hour, 14);
      assert.equal(london.minute, 30);
      assert.equal(london.dateStr, '2026-01-15');
    });

    it('computes correct London time in summer (BST / UTC+1)', () => {
      // July 15 at 14:30 UTC = 15:30 London BST
      const summerDate = new Date('2026-07-15T14:30:00.000Z');
      const london = getLondonDateTime(summerDate);
      assert.equal(london.year, 2026);
      assert.equal(london.month, 7);
      assert.equal(london.day, 15);
      assert.equal(london.hour, 15); // +1 hr for BST!
      assert.equal(london.minute, 30);
      assert.equal(london.dateStr, '2026-07-15');
    });
  });

  // =========================================================================
  // 2. SUPPLIER SCHEDULE & BRANCH RESOLUTION
  // =========================================================================
  describe('Supplier Schedule Resolution', () => {
    it('resolves default schedule cutoff for JFC as 22:00 (10 PM)', () => {
      const schedule = resolveSupplierSchedule(jfcSupplier);
      assert.equal(schedule.cutoffHour, 22);
      assert.equal(schedule.cutoffMinute, 0);
      assert.equal(schedule.leadDays, 1);
    });

    it('resolves branch-specific override for JFC at Aldgate (b2) as 17:00 (5 PM)', () => {
      const schedule = resolveSupplierSchedule(jfcSupplier, 'b2');
      assert.equal(schedule.cutoffHour, 17);
      assert.equal(schedule.cutoffMinute, 0);
    });

    it('resolves Tazaki delivery days as Mon, Wed, Fri and cutoff as 17:00 (5 PM)', () => {
      const schedule = resolveSupplierSchedule(tazakiSupplier);
      assert.deepEqual(schedule.allowedDeliveryDays, [1, 3, 5]);
      assert.equal(schedule.cutoffHour, 17);
    });

    it('resolves internal warehouse lead time as 2 days and cutoff as 16:00 (4 PM)', () => {
      const schedule = resolveSupplierSchedule(internalSupplier);
      assert.equal(schedule.leadDays, 2);
      assert.equal(schedule.cutoffHour, 16);
    });
  });

  // =========================================================================
  // 3. CUTOFF CLOCK STATUS & COUNTDOWN
  // =========================================================================
  describe('Cutoff Clock Status & Urgency', () => {
    it('reports NORMAL urgency when more than 2 hours remain before cutoff', () => {
      // 14:00 London on Tuesday 2026-02-10 (Cutoff is 22:00, 8 hours left)
      const now = new Date('2026-02-10T14:00:00.000Z');
      const status = getCutoffStatus(jfcSupplier, undefined, now);
      assert.equal(status.cutoffPassedToday, false);
      assert.equal(status.urgency, 'NORMAL');
      assert.ok(status.badgeText.includes('8h 0m left'));
    });

    it('reports APPROACHING urgency when between 30 and 120 minutes remain', () => {
      // 20:30 London (Cutoff is 22:00, 90 mins left)
      const now = new Date('2026-02-10T20:30:00.000Z');
      const status = getCutoffStatus(jfcSupplier, undefined, now);
      assert.equal(status.cutoffPassedToday, false);
      assert.equal(status.urgency, 'APPROACHING');
      assert.ok(status.badgeText.includes('1h 30m remaining'));
    });

    it('reports URGENT urgency when 30 minutes or less remain', () => {
      // 21:45 London (Cutoff is 22:00, 15 mins left)
      const now = new Date('2026-02-10T21:45:00.000Z');
      const status = getCutoffStatus(jfcSupplier, undefined, now);
      assert.equal(status.cutoffPassedToday, false);
      assert.equal(status.urgency, 'URGENT');
      assert.ok(status.badgeText.includes('15m left'));
    });

    it('reports PASSED urgency when cutoff time has passed today', () => {
      // 22:05 London (Cutoff is 22:00, cutoff has passed!)
      const now = new Date('2026-02-10T22:05:00.000Z');
      const status = getCutoffStatus(jfcSupplier, undefined, now);
      assert.equal(status.cutoffPassedToday, true);
      assert.equal(status.urgency, 'PASSED');
      assert.ok(status.badgeText.includes('Cutoff passed'));
    });
  });

  // =========================================================================
  // 4. NEXT AVAILABLE DELIVERY DATE & SUNDAY/HOLIDAY AVOIDANCE
  // =========================================================================
  describe('Next Available Delivery Date Computation', () => {
    it('orders placed before cutoff on Tuesday get Wednesday delivery for JFC', () => {
      // Tuesday 2026-02-10 at 14:00 London
      const now = new Date('2026-02-10T14:00:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(jfcSupplier, undefined, now);
      assert.equal(nextDate.dateStr, '2026-02-11'); // Wednesday
    });

    it('orders placed AFTER cutoff on Tuesday get Thursday delivery for JFC', () => {
      // Tuesday 2026-02-10 at 22:15 London (Cutoff passed!)
      const now = new Date('2026-02-10T22:15:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(jfcSupplier, undefined, now);
      assert.equal(nextDate.dateStr, '2026-02-12'); // Thursday
    });

    it('skips Sunday delivery: Saturday before cutoff yields Monday delivery', () => {
      // Saturday 2026-02-14 at 10:00 London (JFC doesn't deliver Sunday)
      const now = new Date('2026-02-14T10:00:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(jfcSupplier, undefined, now);
      assert.equal(nextDate.dateStr, '2026-02-16'); // Monday (skips Sunday 2026-02-15)
    });

    it('skips non-delivery days for Tazaki (Mon/Wed/Fri only)', () => {
      // Monday 2026-02-09 before cutoff (14:00): next delivery is Wednesday
      const nowMon = new Date('2026-02-09T14:00:00.000Z');
      const nextWed = getNextAvailableDeliveryDate(tazakiSupplier, undefined, nowMon);
      assert.equal(nextWed.dateStr, '2026-02-11'); // Wednesday

      // Wednesday 2026-02-11 before cutoff: next delivery is Friday
      const nowWed = new Date('2026-02-11T14:00:00.000Z');
      const nextFri = getNextAvailableDeliveryDate(tazakiSupplier, undefined, nowWed);
      assert.equal(nextFri.dateStr, '2026-02-13'); // Friday

      // Friday 2026-02-13 before cutoff: next delivery is next Monday (skips Sat & Sun)
      const nowFri = new Date('2026-02-13T14:00:00.000Z');
      const nextMon = getNextAvailableDeliveryDate(tazakiSupplier, undefined, nowFri);
      assert.equal(nextMon.dateStr, '2026-02-16'); // Monday
    });

    it('skips UK Bank Holidays (e.g. Good Friday 2026-04-03)', () => {
      // Thursday 2026-04-02 before cutoff
      const now = new Date('2026-04-02T14:00:00.000Z');
      const nextDate = getNextAvailableDeliveryDate(jfcSupplier, undefined, now);
      // Good Friday 2026-04-03 is Bank Holiday; Saturday 2026-04-04 is next valid!
      assert.equal(nextDate.dateStr, '2026-04-04');
    });
  });

  // =========================================================================
  // 5. DELIVERY DATE VALIDATION
  // =========================================================================
  describe('Delivery Date Validation', () => {
    it('accepts valid next-day delivery date when ordered before cutoff', () => {
      const now = new Date('2026-02-10T14:00:00.000Z'); // Tuesday
      const res = validateDeliveryDate('2026-02-11', jfcSupplier, undefined, now);
      assert.equal(res.valid, true);
    });

    it('rejects next-day delivery date when ordered AFTER cutoff', () => {
      const now = new Date('2026-02-10T22:30:00.000Z'); // Tuesday 10:30 PM (Past 10pm cutoff)
      const res = validateDeliveryDate('2026-02-11', jfcSupplier, undefined, now);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('daily ordering cutoff'));
      assert.ok(res.error?.includes('Earliest available delivery'));
    });

    it('rejects past dates', () => {
      const now = new Date('2026-02-10T14:00:00.000Z');
      const res = validateDeliveryDate('2026-02-09', jfcSupplier, undefined, now);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('past'));
    });

    it('rejects same-day delivery dates', () => {
      const now = new Date('2026-02-10T14:00:00.000Z');
      const res = validateDeliveryDate('2026-02-10', jfcSupplier, undefined, now);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('Same-day delivery is not supported'));
    });

    it('rejects disallowed days of the week (e.g. Tazaki on Tuesday or Sunday)', () => {
      const now = new Date('2026-02-09T10:00:00.000Z'); // Monday
      // Tuesday 2026-02-10 is not allowed for Tazaki
      const resTue = validateDeliveryDate('2026-02-10', tazakiSupplier, undefined, now);
      assert.equal(resTue.valid, false);
      assert.ok(resTue.error?.includes('does not deliver on Tuesdays'));

      // Sunday 2026-02-15 is not allowed
      const resSun = validateDeliveryDate('2026-02-15', tazakiSupplier, undefined, now);
      assert.equal(resSun.valid, false);
    });

    it('rejects UK Bank Holidays (e.g. Christmas Day 2026-12-25)', () => {
      const now = new Date('2026-12-20T10:00:00.000Z');
      const res = validateDeliveryDate('2026-12-25', jfcSupplier, undefined, now);
      assert.equal(res.valid, false);
      assert.ok(res.error?.includes('Bank Holiday'));
    });
  });
});
