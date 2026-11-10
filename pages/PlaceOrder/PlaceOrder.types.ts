
import { ManualOrderItem } from '../../types';

export type { ManualOrderItem };

export interface OrderFormState {
  selectedBranchId: string;
  selectedSupplierId: string;
  deliveryDate: string;
  comments: string;
  emailOverride: string;
  manualItems: ManualOrderItem[];
}

export type SendMethod = 'EMAIL' | 'WHATSAPP' | 'BOTH';

export interface DateHelpers {
  todayStr: string;
  tomorrowStr: string;
  dayAfterStr: string;
  tomorrowLabel: string;
  dayAfterLabel: string;
}
