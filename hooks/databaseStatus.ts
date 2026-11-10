import {create} from 'zustand';
import {DATABASE_QUOTA_MESSAGE,isDatabaseQuotaError} from '../shared/database-errors';
export const useDatabaseStatus=create<{quotaMessage:string;reset:()=>void}>(set=>({quotaMessage:'',reset:()=>set({quotaMessage:''})}));
export function reportDatabaseError(error:unknown){if(isDatabaseQuotaError(error))useDatabaseStatus.setState({quotaMessage:DATABASE_QUOTA_MESSAGE});}
