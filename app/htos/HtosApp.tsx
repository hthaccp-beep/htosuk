import {usePhoneLayout} from './usePhoneLayout';
import {HtosRouter} from './HtosRouter';
import {AppRecovery} from '../../components/AppRecovery';
import {SafeUpdates,requestUpdateCheck} from './SafeUpdates';
import {SignOutConfirmation} from './SignOutConfirmation';
import {pendingWorkCount,subscribePendingWork} from '../../shared/pending-work';
import {databaseErrorMessage} from '../../shared/database-errors';
import {useDatabaseStatus} from '../../hooks/databaseStatus';
import React, { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HashRouter, NavLink, Route, Routes, Navigate, useNavigate, useLocation, Link } from 'react-router-dom';
import { onAuthStateChanged, signInWithEmailAndPassword, sendPasswordResetEmail, signOut } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { LayoutGrid, ShoppingBag, ClipboardList, ClipboardCheck, Truck, TrendingUp, LineChart, Settings2, PanelLeftOpen, PanelLeftClose, LogOut, Menu, X, Printer, ArrowUpRight, ArrowRight, Check, CircleHelp } from 'lucide-react';
import { auth, db } from '../../firebase-config';
import { useAppStore, can } from '../../store';
import { useAutoLogout } from '../../hooks/useAutoLogout';
import { useFirestoreSync } from '../../hooks/useFirestoreSync';
import {shareFirestore} from '../../hooks/sharedFirestore';
import {incomingSupplierBranches} from '../../shared/order-scope';
import type { User, Permission } from '../../types';
import { Button, Field, Heading, Panel, Empty, Tag, money, day, total, shortId, useAction, Modal } from './ui';
const HelpPanel=lazy(()=>import('./HelpPanel'));
const Checklists=lazy(()=>import('./Checklists'));
const NewOrder=lazy(()=>import('./Orders').then(m=>({default:m.NewOrder})));
const OrderBook=lazy(()=>import('./OrderHistory').then(m=>({default:m.OrderBook})));
import { EmailStatus,OrderEmail } from './OrderCommunication';
const DeliveryChecks=lazy(()=>import('./DeliveryChecks').then(m=>({default:m.DeliveryChecks})));
const PriceDesk=lazy(()=>import('./Catalogue').then(m=>({default:m.PriceDesk})));
const Administration=lazy(()=>import('./Administration').then(m=>({default:m.Administration})));
const Reports=lazy(()=>import('./Management').then(m=>({default:m.Reports})));
import release from '../../app-version.json';
import './htos.css';
import './responsive.css';
import './brand.css';
import './rail.css';
import './polish.css';
import './design5.css';
import './mobile-usability.css';
import './checklists.css';

function AppVersion({check=false}:{check?:boolean}){return <small className="h-app-version">Version {release.version}{check&&<button type="button" className="h-update-check" onClick={requestUpdateCheck}>Check for updates</button>}</small>;}

export function Brand({light=false}:{light?:boolean}) {return <div className={`h-brand ${light?'light':''}`} role="img" aria-label="HTOS · Hare & Tortoise"><span className="h-brandmark" aria-hidden="true"><i/><i/><i/><i/></span><span className="h-brand-wordmark">htos<span className="h-brand-dot">.</span><small>HARE &amp; TORTOISE</small></span></div>;}
export function Login({notice}:{notice:string}) {
  const navigate=useNavigate();
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''); const action=useAction();
  const signIn=(event:React.FormEvent)=>{event.preventDefault();action.run(async()=>{
    try{await signInWithEmailAndPassword(auth,email.trim(),password);navigate('/',{replace:true});}catch(e:any){throw new Error(['auth/invalid-credential','auth/wrong-password','auth/user-not-found'].includes(e.code)?'The email or password is incorrect. Please try again or reset your password.':e.code==='auth/too-many-requests'?'Too many attempts. Please wait a few minutes.':'Unable to sign in. Check your connection and try again.');}
  },'');};
  return <div className="h-login"><section className="h-login-story"><Brand light/><div><span className="h-eyebrow">YOUR OPERATIONS, IN ORDER</span><h1>A better day<br/>starts here<span>.</span></h1><p>One place for your branches, suppliers and every order in between.</p><div className="h-login-steps"><span><i>01</i> Order with confidence</span><span><i>02</i> Keep deliveries on track</span><span><i>03</i> Know where every pound goes</span></div></div><footer>HTOS · Built around your working day</footer><div className="h-orbit" aria-hidden="true"/></section><section className="h-login-form"><div className="h-login-mobile"><Brand/></div><div className="h-login-card"><div id="htos-update-notice"/><span className="h-eyebrow">WELCOME TO YOUR WORKSPACE</span><h2>Let’s get to work.</h2><p>Sign in with your HTOS account.</p>{notice&&<div className="h-notice error">{notice}</div>}<form onSubmit={signIn}><Field label="Email address"><input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com"/></Field><Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} placeholder="Your password"/></Field>{action.feedback}<Button type="submit" busy={action.busy}>Open my workspace <ArrowRight size={18}/></Button><button type="button" className="h-text-button" disabled={action.busy} onClick={()=>action.run(async()=>{if(!email.includes('@'))throw new Error('Enter your email address first.');await sendPasswordResetEmail(auth,email.trim());},'If an account exists, a reset link is on its way. Check your inbox and spam folder.')}>Forgot your password?</button></form><div className="h-login-help"><CircleHelp size={16}/><span>New to the team? Ask your administrator for an account.</span></div><AppVersion check/></div></section></div>;
}
function Session() {
  const user=useAppStore(s=>s.currentUser),setUser=useAppStore(s=>s.setCurrentUser); const [ready,setReady]=useState(false),[notice,setNotice]=useState('');
  const location=useLocation();
  useFirestoreSync(user,location.pathname+location.search);
  useEffect(()=>{let stopProfile:(()=>void)|undefined;let generation=0; const stopAuth=onAuthStateChanged(auth,account=>{
    const current=++generation;stopProfile?.();setUser(null);useDatabaseStatus.getState().reset();
    if(!account){setReady(true);return;}
    stopProfile=shareFirestore('profile:'+account.uid,'profile',(next,error)=>onSnapshot(doc(db,'users',account.uid),snapshot=>next(snapshot.data()||null),error),(profile:any)=>{
      if(current!==generation)return;
      if(!profile || profile.active!==true){setNotice('Your account is not active. Please contact your administrator.');setReady(true);void signOut(auth);return;}
      setUser({...profile,id:account.uid} as User);setNotice('');setReady(true);
    },(error)=>{if(current!==generation)return;setUser(null);setNotice(databaseErrorMessage(error,'We could not verify your account. Check your connection and sign in again.'));setReady(true);});
  });return()=>{generation++;stopAuth();stopProfile?.();};},[setUser]);
  return <><SafeUpdates ready={ready}/>{!ready?<div className="h-loading"><Brand/><p>Opening your workspace…</p></div>:user?<Workspace/>:<Login notice={notice}/>}</>;
}
const navigation: {path:string;label:string;icon:React.ElementType;permission?:Permission}[]=[
  {path:'/',label:'Overview',icon:LayoutGrid},{path:'/new-order',label:'Place an order',icon:ShoppingBag,permission:'place_orders'},
  {path:'/checklists',label:'Order checklist',icon:Printer,permission:'place_orders'},
  {path:'/orders',label:'Order history',icon:ClipboardList,permission:'view_order_history'},
  {path:'/deliveries',label:'Incoming orders',icon:Truck,permission:'view_received_orders'},
  {path:'/checks',label:'Delivery & Invoice Check',icon:ClipboardCheck,permission:'scan_invoices'},
  {path:'/reports',label:'Insights',icon:LineChart,permission:'view_reports'},
  {path:'/settings',label:'Settings',icon:Settings2,permission:'admin_access'},
];
function Guard({permission,children}:{permission:Permission;children:React.ReactNode}) {const {currentUser:user,branches}=useAppStore();const assigned=permission!=='view_received_orders'||!!user&&incomingSupplierBranches(user,branches).length>0;return assigned&&(can(user,permission)||(permission==='scan_invoices'&&import.meta.env.VITE_ENABLE_INVOICE_CASES==='true'&&can(user,'review_invoices')&&can(user,'view_prices')))?<>{children}</>:<Empty title="This area is not part of your access">{permission==='view_received_orders'?'Incoming orders are available to users assigned to a supplying branch.':'Ask your administrator if your role needs this feature.'}</Empty>;}
export function Workspace() {
  const navigate=useNavigate();
  const [helpOpen,setHelpOpen]=useState(false);
  const [signOutOpen,setSignOutOpen]=useState(false);
  const pendingWork=useSyncExternalStore(subscribePendingWork,pendingWorkCount);
  useEffect(()=>{if(!pendingWork)return;const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn);},[pendingWork]);
  const quotaMessage=useDatabaseStatus(s=>s.quotaMessage);
  const {currentUser:user,logout,priceChangeNotices,branches}=useAppStore();const [expanded,setExpanded]=useState(false),[open,setOpen]=useState(false),[online,setOnline]=useState(navigator.onLine);
  const phone=usePhoneLayout();
  const location=useLocation();

  const phoneBottomPaths=['/','/new-order','/orders','/deliveries','/checks'];
  const phonePaths=[...phoneBottomPaths,'/checklists'];
  const incomingAssigned=!!user&&incomingSupplierBranches(user,branches).length>0;
  const availableNavigation=navigation.filter(n=>(!phone||phonePaths.includes(n.path))&&(!n.permission||can(user,n.permission)||(n.path==='/checks'&&import.meta.env.VITE_ENABLE_INVOICE_CASES==='true'&&can(user,'review_invoices')&&can(user,'view_prices')))&&(n.path!=='/deliveries'||incomingAssigned));
  const phoneHome=availableNavigation[0]?.path;
  const mobileRedirect=phone&&!phonePaths.includes(location.pathname);
  useEffect(()=>{const changed=()=>setOnline(navigator.onLine);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{window.removeEventListener('online',changed);window.removeEventListener('offline',changed);};},[]);
  const navRef=useRef<HTMLElement>(null),menuRef=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    if(!open)return;
    const previousOverflow=document.body.style.overflow;
    document.body.style.overflow='hidden';
    const nav=navRef.current;
    nav?.querySelector<HTMLElement>('button,a')?.focus();
    const keys=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();setOpen(false);}
      if(event.key!=='Tab'||!nav)return;
      const controls=Array.from(nav.querySelectorAll<HTMLElement>('a,button')).filter(el=>el.getClientRects().length&&!el.hasAttribute('disabled'));
      const first=controls[0],last=controls[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    const wide=window.matchMedia('(min-width:1101px)');
    const resized=()=>{if(wide.matches)setOpen(false);};
    document.addEventListener('keydown',keys);wide.addEventListener('change',resized);
    return()=>{document.body.style.overflow=previousOverflow;document.removeEventListener('keydown',keys);wide.removeEventListener('change',resized);menuRef.current?.focus();};
  },[open]);
  const session=useAutoLogout();
  const pending=priceChangeNotices.filter(p=>p.status==='PENDING').length;
  return <div className={`h-app ${expanded?'is-nav-expanded':''}`}><a className="h-skip-link" href="#main-content" onClick={e=>{e.preventDefault();document.getElementById('main-content')?.focus();}}>Skip to content</a>{helpOpen&&<Suspense fallback={<Modal title="Opening Help" onClose={()=>setHelpOpen(false)}><p role="status">Loading Help…</p></Modal>}><HelpPanel owner={user?.role==='CREATOR'} page={location.pathname} onClose={()=>setHelpOpen(false)}/></Suspense>}{signOutOpen&&<SignOutConfirmation onClose={()=>setSignOutOpen(false)} onSignOut={logout}/>} {session.isWarning&&<Modal title="Still working?" onClose={session.keepAlive}><p>Your session will close in {session.timeLeft} seconds.</p><p>Unsaved changes may be lost. Choose Keep working, then save your work.</p><Button onClick={session.keepAlive}>Keep working</Button></Modal>}<aside ref={navRef} id="workspace-navigation" aria-label="Workspace navigation" role={open?'dialog':undefined} aria-modal={open||undefined} className={`h-sidebar ${open?'open':''}`}><div className="h-sidebar-top"><Brand light/><button className="h-mobile-only h-icon-button" aria-label="Close navigation" onClick={()=>setOpen(false)}><X/></button></div><button type="button" className="h-rail-toggle" aria-controls="workspace-navigation" aria-expanded={expanded} aria-label={expanded?'Collapse menu':'Expand menu'} title={expanded?'Collapse menu':'Expand menu'} onClick={()=>setExpanded(v=>!v)}>{expanded?<PanelLeftClose size={20}/>:<PanelLeftOpen size={20}/>}<span>{expanded?'Collapse menu':'Expand menu'}</span></button><div className="h-workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation">{availableNavigation.map(({path,label,icon:Icon})=><NavLink key={path} to={path} aria-label={label} title={label} end={path==='/'} onClick={()=>setOpen(false)} className={({isActive})=>isActive?'active':''}><Icon size={19} aria-hidden="true"/><span>{label}</span></NavLink>)}</nav><div className="h-sidebar-bottom"><div className="h-account" title={user?.displayName}><span className="h-avatar">{user?.displayName.slice(0,2).toUpperCase()}</span><div><strong>{user?.displayName}</strong><small>{user?.role==='CREATOR'?'Workspace owner':user?.role.replace(/_/g,' ')}</small></div></div><button className="h-signout" aria-label="Sign out" title="Sign out" onClick={()=>{setOpen(false);setSignOutOpen(true);}}><LogOut size={17} aria-hidden="true"/><span>Sign out</span></button><AppVersion/></div></aside>{open&&<button className="h-nav-shade" aria-label="Close navigation" onClick={()=>setOpen(false)}/>}<div className="h-workspace" {...(open?{inert:''} as any:{})}><header className="h-topbar"><div><button ref={menuRef} className="h-mobile-only h-icon-button" aria-controls="workspace-navigation" aria-expanded={open} aria-label="Open navigation" onClick={()=>setOpen(true)}><Menu/></button><span className="h-workspace-caption">Operations workspace<AppVersion check/></span></div><div><button type="button" className="h-text-button" onClick={()=>setHelpOpen(true)}><CircleHelp size={18} aria-hidden="true"/> Help</button><span className={`h-connection ${online?'':'offline'}`}><i/>{quotaMessage?'Database limited':online?'Connected':'Offline'}</span><span className="h-top-date">{new Date().toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'long'})}</span></div></header><div id="htos-update-notice"/>{!online&&<div className="h-notice error">You’re offline. Reconnect before saving or submitting changes.</div>}{quotaMessage&&<div className="h-notice error" role="alert">{quotaMessage} Previously loaded lists may be out of date. Reload after the database is available again.</div>}<main id="main-content" tabIndex={-1} className="h-content"><AppRecovery resetKey={location.pathname+location.search} onOverview={()=>navigate('/')}><Suspense fallback={<div className="h-page-loading" role="status"><span className="h-loading-dot"/>Opening this screen…</div>}><Routes>{mobileRedirect?<Route path="*" element={phoneHome?<Navigate to={phoneHome} replace/>:<Empty title="No mobile workflows assigned">Ask your administrator for ordering access, or open HTOS on a tablet or computer.</Empty>}/>:<><Route path="/" element={<Overview/>}/><Route path="/checklists" element={<Guard permission="place_orders"><Checklists/></Guard>}/><Route path="/new-order" element={<Guard permission="place_orders"><NewOrder/></Guard>}/><Route path="/orders" element={<Guard permission="view_order_history"><OrderBook/></Guard>}/><Route path="/deliveries" element={<Guard permission="view_received_orders"><OrderBook incoming/></Guard>}/><Route path="/catalogue" element={<Navigate to="/settings?tab=products" replace/>}/><Route path="/prices" element={<Navigate to="/checks" replace/>}/><Route path="/checks" element={<Guard permission="scan_invoices"><DeliveryChecks/></Guard>}/><Route path="/catalogue-prices" element={<Guard permission="view_price_changes"><PriceDesk/></Guard>}/><Route path="/reports" element={<Guard permission="view_reports"><Reports/></Guard>}/><Route path="/settings" element={<Guard permission="admin_access"><Administration/></Guard>}/><Route path="*" element={<Navigate to="/" replace/>}/></>}</Routes></Suspense></AppRecovery></main><nav className="h-bottom-nav" aria-label="Quick navigation">{availableNavigation.filter(n=>phoneBottomPaths.includes(n.path)).map(({path,icon:Icon})=><NavLink key={path} to={path} end={path==='/'}><Icon size={21}/><span>{path==='/'?'Overview':path==='/new-order'?'Place order':path==='/orders'?'Order history':path==='/checks'?'Checks':'Incoming'}</span></NavLink>)}</nav></div></div>;
}
function Overview(){
  const {currentUser:user,orders,branches,suppliers,products,priceChangeNotices}=useAppStore();const navigate=useNavigate();
  const visibleOrders=orders.filter(o=>!o.archived);
  const placed=visibleOrders.filter(o=>o.status==='PLACED'),drafts=visibleOrders.filter(o=>o.status==='DRAFT');const awaiting=placed.filter(o=>o.receivedStatus!=='PROCESSED');
  const isOwner=can(user,'manage_branches');const setup=[{name:'Add your branches',detail:'Set up the locations you order for.',done:branches.length>0,to:'/settings?tab=branches'},{name:'Connect your suppliers',detail:'Add contacts and delivery preferences.',done:suppliers.length>0,to:'/settings?tab=suppliers'},{name:'Build your catalogue',detail:'Add products or import your supplier list.',done:products.length>0,to:'/settings?tab=products'}];
  return <><Heading eyebrow="THE BIG PICTURE" title="Overview" action={can(user,'place_orders')&&<div className="h-overview-actions"><Button variant="secondary" onClick={()=>navigate('/checklists')}><Printer size={18}/> Order checklist</Button><Button onClick={()=>navigate('/new-order')}>Place an order <ArrowUpRight size={18}/></Button></div>}>Here’s what’s happening across your workspace.</Heading><section className="h-metrics">{[{label:'Orders in view',value:placed.length,note:'Placed orders',icon:ClipboardList},{label:'Awaiting receipt',value:awaiting.length,note:'Ready to follow up',icon:Truck},{label:'Saved drafts',value:drafts.length,note:'Pick up where you left off',icon:ShoppingBag},{label:can(user,'view_prices')?'Order value':'Active suppliers',value:can(user,'view_prices')?money(placed.reduce((a,o)=>a+total(o),0)):suppliers.filter(s=>s.active).length,note:can(user,'view_prices')?'At the time of ordering':'Your supplier network',icon:TrendingUp}].map(({label,value,note,icon:Icon})=><div className="h-metric" key={label}><div><span>{label}</span><Icon size={18}/></div><strong>{value}</strong><small>{note}</small></div>)}</section>{isOwner&&setup.some(s=>!s.done)&&<section className="h-getstarted"><div><span className="h-eyebrow">MAKE IT YOURS</span><h2>Your workspace, ready for its first order.</h2><p>Start with the essentials. Your business data stays in your own HTOS database.</p></div><div className="h-setup-steps">{setup.map((step,i)=><button key={step.name} onClick={()=>navigate(step.to)}><span className={step.done?'done':''}>{step.done?<Check size={17}/>:`0${i+1}`}</span><div><strong>{step.name}</strong><small>{step.detail}</small></div><ArrowRight size={17}/></button>)}</div></section>}<div className="h-overview-grid"><Panel title="Latest activity" subtitle="Your most recent orders" action={<Link className="h-text-link" to="/orders">View history <ArrowRight size={16}/></Link>}>{visibleOrders.length?<div className="h-activity-list">{[...visibleOrders].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,6).map(order=><div className="h-activity-entry" key={order.id}><Link to={`/orders?order=${order.id}`}><span className="h-activity-icon"><ShoppingBag size={19}/></span><div><strong>{order.supplierNameSnapshot}</strong><small>{order.branchNameSnapshot} · {day(order.createdAt)} · #{shortId(order.id)}</small></div></Link><div className="h-activity-status"><EmailStatus order={order}/>{order.status==='PLACED'&&order.emailStatus!=='SENT'&&<OrderEmail order={order}/>}</div></div>)}</div>:<Empty title="A fresh start">Your first order will appear here. Set up your catalogue, then place an order when you’re ready.</Empty>}</Panel><Panel title="On your radar" subtitle="A little clarity for your day"><div className="h-radar"><Link to="/orders?status=DRAFT"><span>Orders to finish</span><b>{drafts.length}</b><ArrowUpRight size={17}/></Link>{can(user,'view_received_orders')&&user&&incomingSupplierBranches(user,branches).length>0&&<Link to="/deliveries"><span>Deliveries to receive</span><b>{awaiting.length}</b><ArrowUpRight size={17}/></Link>}<Link to="/catalogue-prices"><span>Catalogue price approvals</span><b>{priceChangeNotices.filter(p=>p.status==='PENDING').length}</b><ArrowUpRight size={17}/></Link></div><div className="h-tip"><span>GOOD TO KNOW</span><p>Order prices are saved when you place an order, so later catalogue changes don’t change your history.</p></div></Panel></div></>;
}
export default function HtosApp(){return <HtosRouter><Session/></HtosRouter>;}

