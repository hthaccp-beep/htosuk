import {HELP_IMAGE_COUNT,HELP_IMAGE_LIMIT,laterVersion} from '../shared/help.ts';
import type {HelpAnalysis,HelpImage,HelpReport} from '../shared/help.ts';
export class HelpError extends Error {status:number; constructor(message:string,status=400){super(message);this.status=status;}}
export function text(value:unknown,label:string,max:number,required=true){
  if(typeof value!=='string'||value.length>max||required&&!value.trim())throw new HelpError(`${label} is required and must be ${max} characters or fewer.`);
  return value.trim();
}
export function helpId(value:unknown){if(typeof value!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw new HelpError('Invalid report reference.');return value;}
export function validateImages(input:unknown):HelpImage[]{
  if(!Array.isArray(input)||input.length>HELP_IMAGE_COUNT)throw new HelpError('Attach up to two screenshots.');
  return input.map(image=>{
    if(!image||!['image/jpeg','image/png'].includes(image.mimeType)||typeof image.data!=='string'||image.data.length>Math.ceil(HELP_IMAGE_LIMIT/3)*4||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data))throw new HelpError('Screenshot format or size is not supported.');
    const bytes=Buffer.from(image.data,'base64');
    const valid=image.mimeType==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217;
    if(!valid||bytes.length>HELP_IMAGE_LIMIT)throw new HelpError('Choose a valid PNG or JPEG screenshot.');
    return {mimeType:image.mimeType,data:image.data};
  });
}
export function validateReport(input:any):HelpReport{
  if(!input||input.reviewed!==true)throw new HelpError('Check your report and remove sensitive information before sending.');
  const page=text(input.page,'Page',100),version=text(input.version,'Version',12);
  if(!/^\/[a-z0-9/-]*$/i.test(page)||!/^\d{1,3}\.\d{2}$/.test(version))throw new HelpError('Invalid page or app version.');
  return {title:text(input.title,'Summary',120),description:text(input.description,'What happened',3000),steps:text(input.steps,'Steps',2000,false),expected:text(input.expected,'Expected result',1000,false),page,version,aiConsent:input.aiConsent===true,images:validateImages(input.images)};
}
export function validateProposal(input:any,current:string){
  if(!input||input.baseVersion!==current||!laterVersion(input.targetVersion,current))throw new HelpError('Use the current base version and a higher target version for this repair. Refresh the issue if the app has changed.');
  const revision=text(input.revision,'Source revision',40).toLowerCase();if(!/^[a-f0-9]{40}$/.test(revision))throw new HelpError('Enter the full 40-character Git commit for the tested repair.');
  return {summary:text(input.summary,'Repair summary',3000),tests:text(input.tests,'Offline test evidence',3000),risks:text(input.risks,'Risks and rollback plan',2000),revision,baseVersion:current,targetVersion:input.targetVersion as string};
}
export function validateAnalysis(input:any):HelpAnalysis{
  if(!input||typeof input!=='object')throw new HelpError('AI could not return a usable analysis.');
  return {summary:text(input.summary,'AI summary',2000),likelyCause:text(input.likelyCause,'Possible cause',2000),checks:text(input.checks,'Suggested checks',3000),workaround:text(input.workaround,'Workaround',2000),uncertainty:text(input.uncertainty,'Uncertainty',2000)};
}
