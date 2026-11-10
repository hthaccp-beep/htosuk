import type {Supplier} from '../../types.ts';
import {deliveryDateBounds, validateDeliveryDate} from '../../utils/deliveryScheduler.ts';

/** The phone picker presents only dates accepted by the shared submission rules. */
export function mobileDeliveryDates(supplier: Supplier, branchId: string, now = new Date()) {
  const {min, max} = deliveryDateBounds(now);
  const date = new Date(`${min}T12:00:00Z`);
  const dates: {value: string; label: string}[] = [];
  for (let i = 0; i < 7; i++) {
    const value = date.toISOString().slice(0, 10);
    if (value <= max && validateDeliveryDate(value, supplier, branchId, now).valid) {
      dates.push({value, label: date.toLocaleDateString('en-GB', {
        timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short',
      })});
    }
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return dates;
}
