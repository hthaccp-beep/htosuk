import React,{createContext,useContext,useEffect,useState} from 'react';
import {Button} from './ui';
import './invoice-review-layout.css';

export function focusInvoiceSection(id:string){const el=document.getElementById(id);if(!el)return;let parent:HTMLElement|null=el;while(parent){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}el.scrollIntoView({block:'start'});el.focus({preventScroll:true});}
const Navigation=createContext({open:focusInvoiceSection,activeTask:null as string|null,close:()=>{}});
export const useInvoiceReviewNavigation=()=>useContext(Navigation).open;
export function InvoiceReviewTask({id,title,children}:{id:string;title:string;children:React.ReactNode}){
 const nav=useContext(Navigation);
 return <section id={id} className="ic-focused-task" data-invoice-task={id} hidden={nav.activeTask!==id} tabIndex={-1} aria-label={title}><div className="ic-focused-title"><h2>{title}</h2><Button variant="quiet" onClick={nav.close}>Back to items</Button></div>{children}</section>;
}
export function InvoiceTaskActions({actions}:{actions:{id:string;label:string}[]}){const open=useInvoiceReviewNavigation();return <div className="ic-task-actions">{actions.map(a=><Button key={a.id} variant="secondary" onClick={()=>open(a.id)}>{a.label}</Button>)}</div>;}
type Stage='invoice'|'credits';
export function InvoiceReviewLayout({comparison,checks,followUp,history,document}:{comparison:React.ReactNode;checks:React.ReactNode;followUp:React.ReactNode;history:React.ReactNode;document:React.ReactNode}){
 const [stage,setStage]=useState<Stage>('invoice'),[showDocument,setShowDocument]=useState(false),[target,setTarget]=useState<string|null>(null),[activeTask,setTask]=useState<string|null>(null);
 const navigate=(id:string)=>{const el=window.document.getElementById(id),panel=el?.closest('[data-invoice-panel]')?.getAttribute('data-invoice-panel'),task=el?.closest('[data-invoice-task]')?.getAttribute('data-invoice-task');if(panel==='invoice'||panel==='credits')setStage(panel);setTask(task||null);setTarget(id);};
 useEffect(()=>{if(target){focusInvoiceSection(target);setTarget(null);}},[target,stage,activeTask]);
 const close=()=>{setTask(null);setTarget('ic-item-review');setStage('invoice');};
 const switchStage=(next:Stage)=>{setStage(next);setTask(null);};
 return <Navigation.Provider value={{open:navigate,activeTask,close}}><div className={'ic-review-layout'+(showDocument?' with-document':'')}>
  <div className="ic-workspace-bar"><nav aria-label="Invoice workflow"><Button variant={stage==='invoice'?'':'secondary'} aria-pressed={stage==='invoice'} aria-controls="ic-panel-invoice" onClick={()=>switchStage('invoice')}>Invoice check</Button><Button variant={stage==='credits'?'':'secondary'} aria-pressed={stage==='credits'} aria-controls="ic-panel-credits" onClick={()=>switchStage('credits')}>Credits & replacements</Button></nav><Button variant="secondary" aria-expanded={showDocument} aria-controls="ic-side-document" onClick={()=>setShowDocument(v=>!v)}>{showDocument?'Hide document':'View document'}</Button></div>
  <div className="ic-review-body"><div className="ic-review-primary">
   <section id="ic-panel-invoice" data-invoice-panel="invoice" aria-label="Invoice check" hidden={stage!=='invoice'}><div hidden={!!activeTask}>{comparison}</div>{checks}</section>
   <section id="ic-panel-credits" data-invoice-panel="credits" aria-label="Credits and replacements" hidden={stage!=='credits'}><h2>Credits & replacements</h2>{followUp}</section>
   {history}
  </div>{showDocument&&<aside id="ic-side-document" aria-label="Original invoice document"><h2>Original document</h2>{document}</aside>}</div>
 </div></Navigation.Provider>;
}
