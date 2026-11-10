import React,{useEffect,useRef,useState,lazy,Suspense} from 'react';
import {onAuthStateChanged,signInWithEmailAndPassword,signOut,sendPasswordResetEmail} from 'firebase/auth';
import {BookOpen,LogOut,ArrowRight,RefreshCw} from 'lucide-react';
import {auth,configurationError} from '../../firebase-config';
import {Button,Field,api,useAction} from '../../app/htos/ui';
const MenuRecipes=lazy(()=>import('./MenuRecipes').then(m=>({default:m.MenuRecipes})));
import {MenuSessionProvider,type MenuSessionState} from './session';
import type {RecipeContent} from '../../shared/menu-recipes';
import './app.css';

export function MenuBrand(){return <div className="sm-brand"><span><BookOpen size={25} strokeWidth={1.6}/></span><div><strong>Standard Menu</strong><small>HARE &amp; TORTOISE</small></div></div>;}
export function MenuShell({session,onSignOut,preview=false,initialRecipe}: {session:MenuSessionState;onSignOut:()=>void;preview?:boolean;initialRecipe?:RecipeContent}) {
  return <MenuSessionProvider value={session}><div className="sm-app"><a className="h-skip-link" href="#menu-content">Skip to menu</a><header className="sm-header"><MenuBrand/><div className="sm-account"><span>{preview?'Preview · no live changes':'Linked to HTOS'}<span className="sm-person">{session.account.displayName}</span></span><Button variant="quiet" onClick={onSignOut}><LogOut size={16}/>{preview?'Reset preview':'Sign out'}</Button></div></header><main id="menu-content" tabIndex={-1}><Suspense fallback={<p role="status">Opening your recipes…</p>}><MenuRecipes initialRecipe={initialRecipe}/></Suspense></main><footer className="sm-footer">Hare &amp; Tortoise · Standard Menu <span>{preview?'N2 example · demo suppliers and products · changes reset on refresh':'Supplier catalogue and accounts shared with HTOS'}</span></footer></div></MenuSessionProvider>;
}
export function StandardMenuApp(){
  const [session,setSession]=useState<MenuSessionState|null>(null),[ready,setReady]=useState(false),[accountPresent,setPresent]=useState(false),[error,setError]=useState('');
  const [email,setEmail]=useState(''),[password,setPassword]=useState('');const action=useAction();const generation=useRef(0);
  async function bootstrap(cursor:string|null=null){
    const result=await api('/api/admin/workspace',{action:'menu-bootstrap',cursor});
    return result;
  }
  const loadMoreSuppliers=async()=>{
    // The functional update preserves any already-loaded suppliers without touching open recipe edits.
    const result=await bootstrap(session?.supplierCursor||null);
    setSession(s=>s?{...s,suppliers:[...new Map([...s.suppliers,...result.suppliers].map(x=>[x.id,x])).values()],supplierCursor:result.cursor}:s);
  };
  useEffect(()=>{
    if(!auth){setError(configurationError||'Standard Menu is not connected to HTOS yet.');setReady(true);return;}
    return onAuthStateChanged(auth,account=>{
      const current=++generation.current;setSession(null);setPresent(!!account);setError('');setReady(false);
      if(!account){setReady(true);return;}
      bootstrap().then(result=>{if(current===generation.current)setSession({account:result.account,suppliers:result.suppliers,supplierCursor:result.cursor,loadMoreSuppliers:async()=>{}});})
        .catch(e=>{if(current===generation.current)setError((e as Error).message);}).finally(()=>{if(current===generation.current)setReady(true);});
    });
  },[]);
  if(!ready)return <div className="sm-loading"><MenuBrand/><p role="status">Opening Standard Menu…</p></div>;
  if(session)return <MenuShell session={{...session,loadMoreSuppliers}} onSignOut={()=>{if(window.confirm('Sign out? Unsaved recipe changes will be lost.'))void signOut(auth);}}/>;
  return <div className="sm-login"><section className="sm-login-panel"><MenuBrand/><h1>Your recipes.<br/>One shared catalogue.</h1><p>Create standard recipe cards using your HTOS suppliers and products.</p><div className="sm-login-features"><span>Menu dishes &amp; preparation recipes</span><span>Preferred products &amp; alternatives</span><span>Supplier specifications</span></div></section><section className="sm-login-form"><h2>{accountPresent?'Menu access needed':'Sign in to Standard Menu'}</h2><p>{accountPresent?'Ask your HTOS administrator to grant Menu & Recipes access.':'Use your existing HTOS account.'}</p>{error&&<div className="h-notice error" role="alert">{error}</div>}{accountPresent?<><Button variant="secondary" busy={action.busy} onClick={()=>action.run(async()=>{const result=await bootstrap();setSession({account:result.account,suppliers:result.suppliers,supplierCursor:result.cursor,loadMoreSuppliers:async()=>{}});},'')}><RefreshCw size={16}/>Check access again</Button><Button variant="quiet" onClick={()=>void signOut(auth)}>Sign out</Button></>:<form onSubmit={e=>{e.preventDefault();void action.run(async()=>{try{await signInWithEmailAndPassword(auth,email.trim(),password);}catch(e:any){throw new Error(['auth/invalid-credential','auth/user-not-found','auth/wrong-password'].includes(e.code)?'The email or password is incorrect.':e.code==='auth/too-many-requests'?'Too many attempts. Please wait before trying again.':'Unable to sign in. Check your connection and try again.');}},'');}}><Field label="Email address"><input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/></Field><Field label="Password"><input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/></Field>{action.feedback}<Button type="submit" busy={action.busy} disabled={!auth}>Open Standard Menu<ArrowRight size={17}/></Button><button type="button" className="h-text-button" disabled={!auth||action.busy} onClick={()=>action.run(async()=>{if(!email.includes('@'))throw new Error('Enter your email address first.');await sendPasswordResetEmail(auth,email.trim());},'If an account exists, a reset link is on its way.')}>Forgot your password?</button></form>}</section></div>;
}
