export interface HelpImage {mimeType:'image/jpeg'|'image/png'; data:string}
export interface HelpReport {title:string; description:string; steps:string; expected:string; page:string; version:string; aiConsent:boolean; images:HelpImage[]}
export interface HelpAnalysis {summary:string; likelyCause:string; checks:string; workaround:string; uncertainty:string}
export interface RepairProposal {summary:string; tests:string; risks:string; revision:string; baseVersion:string; targetVersion:string; hash:string; proposedAt:string}
export interface HelpIssue extends Omit<HelpReport,'images'> {
  id:string; reporterName:string; createdAt:string; sortKey:string; status:'new'|'analysed'|'awaiting_approval'|'approved'|'closed';
  imageCount:number; analysis?:HelpAnalysis; analysisAt?:string; analysisError?:string;
  proposal?:RepairProposal; approval?:{hash:string; by:string; at:string}; closeReason?:string;
}
export type HelpRequest=(body:Record<string,unknown>)=>Promise<any>;
export const HELP_IMAGE_LIMIT=200_000;
export const HELP_IMAGE_COUNT=2;
export function laterVersion(next:string,current:string){
  if(!/^\d{1,3}\.\d{2}$/.test(next)||!/^\d{1,3}\.\d{2}$/.test(current))return false;
  const [a,b]=next.split('.').map(Number),[c,d]=current.split('.').map(Number);
  return a>c||a===c&&b>d;
}
