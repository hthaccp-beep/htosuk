/**
 * Delivery Scheduler & Cutoff Clock Engine (Issue 9)
 *
 * Implements:
 * - Accurate supplier-specific and branch-specific delivery rules and cutoff times.
 * - Timezone-aware calculation for London ('Europe/London', accounting for GMT and BST).
 * - Lead time calculation, Sunday exclusions, and UK Bank Holiday blackout calendars.
 * - Live countdown calculations, cutoff status warnings (Approaching, Urgent, Passed).
 * - Validation of requested delivery dates to prevent placing orders for invalid or missed dates.
 */

import type { Supplier } from '../types.ts';

export const UK_BANK_HOLIDAYS = new Set([
  // 2025
  '2025-01-01',
  '2025-04-18',
  '2025-04-21',
  '2025-05-05',
  '2025-05-26',
  '2025-08-25',
  '2025-12-25',
  '2025-12-26',
  // 2026
  '2026-01-01',
  '2026-04-03',
  '2026-04-06',
  '2026-05-04',
  '2026-05-25',
  '2026-08-31',
  '2026-12-25',
  '2026-12-28',
  // 2027
  '2027-01-01',
  '2027-03-26',
  '2027-03-29',
  '2027-05-03',
  '2027-05-31',
  '2027-08-30',
  '2027-12-27',
  '2027-12-28',
]);

export interface ParsedSupplierSchedule {
  cutoffHour: number; // 0-23 (22 for 10pm, 17 for 5pm, 23 for 23:59)
  cutoffMinute: number; // 0-59
  leadDays: number; // 1 for next-day, 2 for 2-day lead
  allowedDeliveryDays: number[]; // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
  description: string;
}

export interface LondonDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0=Sun, 1=Mon..6=Sat
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm
}

/**
 * Returns current date and time components strictly in 'Europe/London' timezone (handling GMT and BST).
 */
export function getLondonDateTime(baseDate: Date = new Date()): LondonDateTime {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(baseDate);
  const findPart = (type: string) => parts.find((p) => p.type === type)?.value || '0';

  const year = parseInt(findPart('year'), 10);
  const month = parseInt(findPart('month'), 10);
  const day = parseInt(findPart('day'), 10);
  const hour = parseInt(findPart('hour'), 10);
  const minute = parseInt(findPart('minute'), 10);
  const second = parseInt(findPart('second'), 10);

  const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

  // Accurate day of week for the London date
  const londonDateObj = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = londonDateObj.getUTCDay();

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dayOfWeek,
    dateStr,
    timeStr,
  };
}

/**
 * Parses delivery schedule specifications for a supplier and optional branch.
 */
export function resolveSupplierSchedule(
  supplier?: Supplier | null,
  branchId?: string
): ParsedSupplierSchedule {
  if (!supplier) {
    return {
      cutoffHour: 22,
      cutoffMinute: 0,
      leadDays: 1,
      allowedDeliveryDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
      description: 'Standard Order Cutoff: 10:00 PM',
    };
  }

  // Branch-specific override or default
  const scheduleText =
    (branchId && supplier.deliverySchedules?.[branchId]) ||
    supplier.deliverySchedules?.['default'] ||
    '';

  const textLower = scheduleText.toLowerCase();

  // 1. Explicit deliveryRules on the supplier if configured
  let allowedDeliveryDays: number[] = [1, 2, 3, 4, 5, 6]; // Default Mon-Sat
  if (branchId && supplier.deliveryRules?.[branchId]?.length) {
    allowedDeliveryDays = [...supplier.deliveryRules[branchId]];
  } else if (supplier.deliveryRules?.['default']?.length) {
    allowedDeliveryDays = [...supplier.deliveryRules['default']];
  } else if (textLower.includes('mon/wed/fri') || textLower.includes('monday/wednesday/friday')) {
    allowedDeliveryDays = [1, 3, 5]; // Mon, Wed, Fri
  } else if (textLower.includes('mon-fri') || textLower.includes('weekday')) {
    allowedDeliveryDays = [1, 2, 3, 4, 5];
  }

  // 2. Cutoff time resolution
  let cutoffHour = 22; // Default 10pm
  let cutoffMinute = 0;
  let leadDays = 1;

  if (textLower.includes('5pm') || textLower.includes('17:00')) {
    cutoffHour = 17;
    cutoffMinute = 0;
  } else if (textLower.includes('10pm') || textLower.includes('22:00')) {
    cutoffHour = 22;
    cutoffMinute = 0;
  } else if (textLower.includes('midnight') || textLower.includes('23:59')) {
    cutoffHour = 23;
    cutoffMinute = 59;
  } else if (textLower.includes('4pm') || textLower.includes('16:00')) {
    cutoffHour = 16;
    cutoffMinute = 0;
  }

  // 3. Lead time resolution
  if (textLower.includes('2-3 days') || textLower.includes('2 days')) {
    leadDays = 2;
  }

  return {
    cutoffHour,
    cutoffMinute,
    leadDays,
    allowedDeliveryDays,
    description: scheduleText || `Order by ${formatCutoffTime(cutoffHour, cutoffMinute)}`,
  };
}

export function formatCutoffTime(hour: number, minute: number): string {
  if (hour === 23 && minute >= 55) return 'Midnight (23:59)';
  const period = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  const displayMinute = minute > 0 ? `:${String(minute).padStart(2, '0')}` : ':00';
  return `${displayHour}${displayMinute} ${period}`;
}

export interface CutoffStatus {
  cutoffPassedToday: boolean;
  minutesRemainingToday: number;
  cutoffTimeDisplay: string;
  urgency: 'NORMAL' | 'APPROACHING' | 'URGENT' | 'PASSED';
  badgeText: string;
  nextValidDeliveryDate: string;
  nextValidDeliveryLabel: string;
}

/**
 * Calculates live cutoff status and countdown for a supplier and branch at a given time.
 */
export function getCutoffStatus(
  supplier?: Supplier | null,
  branchId?: string,
  now: Date = new Date()
): CutoffStatus {
  const schedule = resolveSupplierSchedule(supplier, branchId);
  const londonNow = getLondonDateTime(now);

  const cutoffMinutesSinceMidnight = schedule.cutoffHour * 60 + schedule.cutoffMinute;
  const currentMinutesSinceMidnight = londonNow.hour * 60 + londonNow.minute;

  const minutesRemaining = cutoffMinutesSinceMidnight - currentMinutesSinceMidnight;
  const cutoffPassedToday = minutesRemaining <= 0;

  let urgency: CutoffStatus['urgency'] = 'NORMAL';
  let badgeText = '';

  const cutoffTimeDisplay = formatCutoffTime(schedule.cutoffHour, schedule.cutoffMinute);

  if (cutoffPassedToday) {
    urgency = 'PASSED';
    badgeText = `Cutoff passed (${cutoffTimeDisplay})`;
  } else if (minutesRemaining <= 30) {
    urgency = 'URGENT';
    const mins = Math.max(1, minutesRemaining);
    badgeText = `🚨 Urgent: ${mins}m left for cutoff (${cutoffTimeDisplay})!`;
  } else if (minutesRemaining <= 120) {
    urgency = 'APPROACHING';
    const hrs = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    const timeText = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
    badgeText = `⚠️ Cutoff approaching: ${timeText} remaining (${cutoffTimeDisplay})`;
  } else {
    urgency = 'NORMAL';
    const hrs = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    badgeText = `Cutoff today at ${cutoffTimeDisplay} (${hrs}h ${mins}m left)`;
  }

  const nextValid = getNextAvailableDeliveryDate(supplier, branchId, now);

  return {
    cutoffPassedToday,
    minutesRemainingToday: Math.max(0, minutesRemaining),
    cutoffTimeDisplay,
    urgency,
    badgeText,
    nextValidDeliveryDate: nextValid.dateStr,
    nextValidDeliveryLabel: nextValid.dayLabel,
  };
}

/**
 * Calculates the earliest possible valid delivery date, factoring in cutoff time,
 * supplier lead time, allowed days of week, and UK Bank Holidays.
 */
export function getNextAvailableDeliveryDate(
  supplier?: Supplier | null,
  branchId?: string,
  now: Date = new Date()
): { dateStr: string; dayLabel: string } {
  const schedule = resolveSupplierSchedule(supplier, branchId);
  const londonNow = getLondonDateTime(now);

  const cutoffMinutes = schedule.cutoffHour * 60 + schedule.cutoffMinute;
  const currentMinutes = londonNow.hour * 60 + londonNow.minute;
  const cutoffPassedToday = currentMinutes >= cutoffMinutes;

  // If cutoff has passed today, we must add an extra day
  const effectiveLeadDays = cutoffPassedToday ? schedule.leadDays + 1 : schedule.leadDays;

  // Search forward from candidate date until a valid day is found
  let candidateDate = new Date(Date.UTC(londonNow.year, londonNow.month - 1, londonNow.day));
  candidateDate.setUTCDate(candidateDate.getUTCDate() + effectiveLeadDays);

  const allowedSet = new Set(schedule.allowedDeliveryDays);

  // Maximum forward search: 14 days to prevent infinite loops
  for (let i = 0; i < 14; i++) {
    const y = candidateDate.getUTCFullYear();
    const m = String(candidateDate.getUTCMonth() + 1).padStart(2, '0');
    const d = String(candidateDate.getUTCDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${d}`;
    const dayOfWeek = candidateDate.getUTCDay(); // 0=Sun..6=Sat

    const isAllowedDay = allowedSet.has(dayOfWeek);
    const isBankHoliday = UK_BANK_HOLIDAYS.has(dateStr);

    if (isAllowedDay && !isBankHoliday) {
      const dayLabel = candidateDate.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      });
      return { dateStr, dayLabel };
    }

    // Advance 1 day
    candidateDate.setUTCDate(candidateDate.getUTCDate() + 1);
  }

  // Fallback
  const fallbackStr = candidateDate.toISOString().split('T')[0];
  return { dateStr: fallbackStr, dayLabel: fallbackStr };
}

/** Calendar bounds in the workspace timezone, including across daylight-saving changes. */
export function deliveryDateBounds(now: Date = new Date()) {
  const london = getLondonDateTime(now);
  const at = (days: number) => new Date(Date.UTC(london.year, london.month - 1, london.day + days)).toISOString().slice(0, 10);
  return { min: at(1), max: at(7) };
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

/**
 * Validates a candidate delivery date against supplier cutoff, lead time,
 * allowed delivery days, and blackout dates.
 */
export function validateDeliveryDate(
  deliveryDateStr: string,
  supplier?: Supplier | null,
  branchId?: string,
  now: Date = new Date()
): ValidationResult {
  if (!deliveryDateStr) {
    return { valid: false, error: 'Delivery date is required.' };
  }

  const schedule = resolveSupplierSchedule(supplier, branchId);
  const londonNow = getLondonDateTime(now);

  const targetParts = deliveryDateStr.split('-').map((p) => parseInt(p, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDateStr) || targetParts.length !== 3 || targetParts.some(isNaN)) {
    return { valid: false, error: 'Invalid delivery date format (expected YYYY-MM-DD).' };
  }

  const [tYear, tMonth, tDay] = targetParts;
  const targetDateUtc = new Date(Date.UTC(tYear, tMonth - 1, tDay));
  if (targetDateUtc.toISOString().slice(0, 10) !== deliveryDateStr) return { valid: false, error: 'Choose a valid calendar date.' };
  const todayUtc = new Date(Date.UTC(londonNow.year, londonNow.month - 1, londonNow.day));

  const diffTime = targetDateUtc.getTime() - todayUtc.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

  // 1. Past Date check
  if (diffDays < 0) {
    return { valid: false, error: 'Delivery date cannot be in the past.' };
  }

  // 2. Same-Day check (unless leadDays == 0, which is not supported for warehouse wholesale)
  if (diffDays === 0) {
    return {
      valid: false,
      error: 'Same-day delivery is not supported. Please select tomorrow or later.',
    };
  }

  if (diffDays > 7) return { valid: false, error: 'Delivery must be within the next 7 days. Please choose a date no more than one week ahead.' };

  // 3. Bank Holiday / Blackout Date check
  if (UK_BANK_HOLIDAYS.has(deliveryDateStr)) {
    return {
      valid: false,
      error: `Selected date (${deliveryDateStr}) is a UK Bank Holiday / Supplier Blackout Date. Deliveries are closed.`,
    };
  }

  // 4. Allowed Delivery Days of the Week
  const targetDayOfWeek = targetDateUtc.getUTCDay(); // 0=Sun..6=Sat
  const allowedSet = new Set(schedule.allowedDeliveryDays);

  if (!allowedSet.has(targetDayOfWeek)) {
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const targetDayName = dayNames[targetDayOfWeek];
    const allowedDayNames = schedule.allowedDeliveryDays.map((d) => dayNames[d]).join(', ');
    return {
      valid: false,
      error: `${supplier?.name || 'Supplier'} does not deliver on ${targetDayName}s. Allowed delivery days: ${allowedDayNames}.`,
    };
  }

  // 5. Cutoff and Lead Time Validation
  const cutoffMinutes = schedule.cutoffHour * 60 + schedule.cutoffMinute;
  const currentMinutes = londonNow.hour * 60 + londonNow.minute;
  const cutoffPassedToday = currentMinutes >= cutoffMinutes;

  const minRequiredDays = cutoffPassedToday ? schedule.leadDays + 1 : schedule.leadDays;

  if (diffDays < minRequiredDays) {
    const cutoffTimeStr = formatCutoffTime(schedule.cutoffHour, schedule.cutoffMinute);
    const nextAvail = getNextAvailableDeliveryDate(supplier, branchId, now);
    return {
      valid: false,
      error: `The daily ordering cutoff for delivery on ${deliveryDateStr} was today at ${cutoffTimeStr}. Earliest available delivery is ${nextAvail.dayLabel} (${nextAvail.dateStr}).`,
    };
  }

  return { valid: true };
}
