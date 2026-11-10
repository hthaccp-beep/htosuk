import {useEffect, useState} from 'react';

// Include short, touch-operated landscape screens without changing desktop layouts.
export const PHONE_LAYOUT_QUERY = '(max-width:620px), (pointer:coarse) and (max-width:1000px) and (max-height:500px)';

export function usePhoneLayout() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_LAYOUT_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(PHONE_LAYOUT_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}
