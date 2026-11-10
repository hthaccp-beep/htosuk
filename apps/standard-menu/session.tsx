import React, {createContext,useContext} from 'react';

export interface MenuAccount {id:string;displayName:string;permissions:string[]}
export interface MenuSupplier {id:string;name:string}
export interface MenuSessionState {account:MenuAccount;suppliers:MenuSupplier[];supplierCursor:string|null;loadMoreSuppliers:()=>Promise<void>}
const MenuSessionContext=createContext<MenuSessionState|null>(null);
export const MenuSessionProvider=MenuSessionContext.Provider;
export function useMenuSession(){const state=useContext(MenuSessionContext);if(!state)throw new Error('Menu session is unavailable.');return state;}
export function canMenu(account:MenuAccount,permission:string){return account.permissions.includes(permission);}
