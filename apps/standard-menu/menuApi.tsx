import React, {createContext, useContext} from 'react';
import {api} from '../../app/htos/ui';

export type MenuApi = (body: Record<string,unknown>) => Promise<any>;
const MenuApiContext = createContext<MenuApi>(body => api('/api/admin/workspace',body));
// Local previews inject an in-memory adapter. Production always uses the authenticated server.
export const MenuApiProvider = MenuApiContext.Provider;
export function useMenuApi() { return useContext(MenuApiContext); }
export function fileBase64(file: File): Promise<string> {
  return new Promise((resolve,reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read. Select it again.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
}
export function downloadSpecification(file: {base64:string; mime:string; fileName:string}) {
  const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes],{type:file.mime}));
  const link = document.createElement('a');link.href = url;link.download = file.fileName;link.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
