import {useLayoutEffect} from 'react';
import {protectUpdate} from '../shared/update-safety';

export function useUpdateProtection(unsafe: boolean) {
  useLayoutEffect(() => { if (unsafe) return protectUpdate(); }, [unsafe]);
}
