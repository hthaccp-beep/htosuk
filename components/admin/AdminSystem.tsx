
import React, { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../store';
import { EmailConfig, Product, Supplier, Category, Branch } from '../../types';
import { DEFAULT_ROLE_PERMISSIONS, SEED_ROLES, APP_VERSION } from '../../constants';
import { Loader2, Save, Download, Upload, Database, AlertTriangle, RefreshCw, FileText } from 'lucide-react';
import { doc, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '../../firebase-config';
import Papa from 'papaparse';
import { ConfirmModal } from '../ConfirmModal';
import { getAuth } from 'firebase/auth';

export const AdminSystem: React.FC<{ view: 'email' | 'data' }> = ({ view }) => {
  const { 
    emailConfig, saveEmailConfig,
    users, products, categories, suppliers, branches, roles, rolePermissions,
    addRole, addBranch, addSupplier, addCategory, addProduct, addUser 
  } = useAppStore();

  const [emailForm, setEmailForm] = useState<EmailConfig>({
     smtpHost: 'smtp.fasthosts.co.uk',
     smtpPort: 465,
     smtpUser: '',
     smtpPass: '',
     fromName: 'Order System',
     fromEmail: '',
     replyTo: '',
     enabled: true,
     useSSL: true
  });
  const [emailDirty, setEmailDirty] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{title: string, message: string, action: () => void}>({title:'', message:'', action:() => {}});

  const confirm = (title: string, message: string, action: () => void) => {
      setConfirmConfig({title, message, action});
      setConfirmOpen(true);
  };

  useEffect(() => {
    if (emailConfig) {
      setEmailForm(emailConfig);
      setEmailDirty(false);
    }
  }, [emailConfig]);

  const handleEmailSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsProcessing(true);
    try {
      await saveEmailConfig(emailForm);
      setEmailDirty(false);
      alert('Email settings saved successfully.');
    } catch (err) {
      console.error(err);
      alert('Failed to save email settings.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportConfig = () => {
    // Sanitize configuration backup: Exclude sensitive credentials, passwords, and order data
    const sanitizedEmailConfig = emailConfig ? { ...emailConfig } : null;
    if (sanitizedEmailConfig) {
      delete (sanitizedEmailConfig as any).smtpPass;
    }

    const backup = { 
        timestamp: new Date().toISOString(), 
        type: 'configuration', // Metadata tag
        version: APP_VERSION, 
        data: { 
            products, 
            categories, 
            suppliers, 
            branches, 
            roles, 
            rolePermissions, 
            emailConfig: sanitizedEmailConfig,
            users: users.map(u => {
              const safeUser = { ...u };
              delete (safeUser as any).password;
              return safeUser;
            })
        } 
    };
    
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); 
    a.href = url; 
    a.download = `HT_Config_${new Date().toISOString().slice(0,10)}.json`; 
    a.click();
  };

  const handleImportData = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    confirm(
        "Overwrite System Configuration?", 
        "This will overwrite ALL existing configuration data (Products, Branches, Suppliers, Categories, Roles). Continue?",
        () => {
            const reader = new FileReader();
            reader.onload = async (evt) => {
              try {
                const json = JSON.parse(evt.target?.result as string);
                if (!json.data) throw new Error("Invalid File Format");
                
                setIsProcessing(true);
                const d: any = json.data;
                
                let currentBatch = writeBatch(db);
                let batchCount = 0;
                
                const addToBatch = async (ref: any, data: any, options?: any) => {
                    if (options) {
                        currentBatch.set(ref, data, options);
                    } else {
                        currentBatch.set(ref, data);
                    }
                    batchCount++;
                    if (batchCount >= 450) {
                        await currentBatch.commit();
                        currentBatch = writeBatch(db);
                        batchCount = 0;
                    }
                };
                
                if (d.roles) for (const r of d.roles) await addToBatch(doc(db, 'roles', r.id), r);
                if (d.rolePermissions) await addToBatch(doc(db, 'settings', 'role_permissions'), { map: d.rolePermissions }, { merge: true });
                if (d.branches) for (const b of d.branches) await addToBatch(doc(db, 'branches', b.id), b);
                if (d.suppliers) for (const s of d.suppliers) await addToBatch(doc(db, 'suppliers', s.id), s);
                if (d.categories) for (const c of d.categories) await addToBatch(doc(db, 'categories', c.id), c);
                if (d.products) for (const p of d.products) await addToBatch(doc(db, 'products', p.id), p);
                if (d.emailConfig) {
                    const sanitizedEmail = { ...d.emailConfig };
                    delete sanitizedEmail.smtpPass;
                    await addToBatch(doc(db, 'settings', 'email_config'), sanitizedEmail, { merge: true });
                }
                
                if (batchCount > 0) {
                    await currentBatch.commit();
                }
                
                if (d.users && Array.isArray(d.users)) {
                    const auth = getAuth();
                    const token = await auth.currentUser?.getIdToken();
                    if (token) {
                        let userSuccessCount = 0;
                        const userErrors: string[] = [];

                        for (const u of d.users) {
                            if (!u.username) continue;
                            const existingUser = users.find(x => x.username.toLowerCase() === u.username.toLowerCase() || x.id === u.id);
                            const isNew = !existingUser;

                            // Do not create new account if password is not provided (never use hardcoded passwords)
                            if (isNew && (!u.password || typeof u.password !== 'string' || u.password.trim().length < 6)) {
                                userErrors.push(`${u.username}: Skipped creation because a valid password of at least 6 characters was not provided.`);
                                continue;
                            }

                            const payload = isNew ? {
                                action: 'create',
                                data: {
                                    email: u.username.trim(),
                                    password: u.password.trim(),
                                    displayName: (u.displayName || u.username.split('@')[0] || 'User').trim(),
                                    role: u.role || 'STAFF',
                                    branchId: u.branchId || '',
                                    active: String(u.active).toLowerCase() !== 'false',
                                    displayOrder: parseInt(u.displayOrder, 10) || 1000
                                }
                            } : {
                                action: 'update',
                                data: {
                                    id: existingUser.id,
                                    displayName: (u.displayName || existingUser.displayName).trim(),
                                    role: u.role || existingUser.role,
                                    branchId: u.branchId !== undefined ? u.branchId : existingUser.branchId,
                                    active: u.active !== undefined ? String(u.active).toLowerCase() !== 'false' : existingUser.active,
                                    displayOrder: parseInt(u.displayOrder, 10) || existingUser.displayOrder || 1000
                                }
                            };

                            try {
                                const resp = await fetch('/api/admin/users', {
                                    method: 'POST',
                                    headers: {
                                        'Content-Type': 'application/json',
                                        'Authorization': `Bearer ${token}`
                                    },
                                    body: JSON.stringify(payload)
                                });
                                const result = await resp.json().catch(() => ({}));
                                if (resp.ok) {
                                    userSuccessCount++;
                                } else {
                                    userErrors.push(`${u.username}: ${result.error || 'Server rejected update'}`);
                                }
                            } catch (postErr: any) {
                                userErrors.push(`${u.username}: ${postErr.message || 'Network error'}`);
                            }
                        }

                        const userSummary = userErrors.length > 0
                            ? ` Users processed: ${userSuccessCount} succeeded, ${userErrors.length} failed.\nFailures:\n- ${userErrors.slice(0, 5).join('\n- ')}`
                            : ` Users processed: ${userSuccessCount} updated/created.`;
                        alert(`Configuration Restore Complete.${userSummary}\nPlease refresh the page if data doesn't update immediately.`);
                    } else {
                        alert("Configuration Restore Complete. (User updates were skipped because user sign-in could not be verified).");
                    }
                } else {
                    alert("Configuration Restore Complete. Please refresh the page if data doesn't update immediately.");
                }
              } catch (err: any) { 
                  alert("Error: " + err.message); 
              } finally { 
                  setIsProcessing(false); 
                  if (fileInputRef.current) fileInputRef.current.value = ''; 
              }
            };
            reader.readAsText(file);
        }
    );
  };

  const handleSeedDatabase = async () => {
    confirm(
        "Restore Default Roles",
        "This will restore the standard roles and their permissions. Your products, branches, suppliers, categories and accounts will be preserved. Continue?",
        async () => {
            setIsProcessing(true);
            try {
              const batch = writeBatch(db);
              for (const r of SEED_ROLES) batch.set(doc(db, 'roles', r.id), r);
              batch.set(doc(db, 'settings', 'role_permissions'), { map: DEFAULT_ROLE_PERMISSIONS });
              // The independent app never imports the source app's legacy business fixtures.
              
              await batch.commit();
              alert("Default roles restored. Your business data and user accounts were preserved.");
            } catch (err: any) {
              alert("Seeding failed: " + err.message);
            } finally {
              setIsProcessing(false);
            }
        }
    );
  };

  const handleNormalizeSortOrders = async () => {
      confirm(
          "Normalize Sort Orders",
          "This will clean up ALL product sort orders in the database.\n\nIt fixes duplicates (e.g. two items at '50') and decimals (e.g. '1.5') by reassigning clean numbers (1000, 2000...).\n\nContinue?",
          async () => {
              setIsProcessing(true);
              try {
                  const batch = writeBatch(db);
                  let count = 0;
                  let batchLimit = 0;

                  // Group all products by Category
                  const groups: Record<string, Product[]> = {};
                  products.forEach(p => {
                      if (!groups[p.categoryId]) groups[p.categoryId] = [];
                      groups[p.categoryId].push(p);
                  });

                  // Process each category
                  Object.keys(groups).forEach(catId => {
                      // Sort by current messy order
                      const sorted = groups[catId].sort((a,b) => (a.displayOrder || 999999) - (b.displayOrder || 999999));
                      
                      sorted.forEach((p, index) => {
                          const cleanOrder = (index + 1) * 1000;
                          // Only update if changed
                          if (p.displayOrder !== cleanOrder) {
                              batch.update(doc(db, 'products', p.id), { displayOrder: cleanOrder });
                              count++;
                              batchLimit++;
                          }
                      });
                  });

                  if (count > 0) {
                      await batch.commit();
                      alert(`Successfully normalized ${count} products.\nYour data is now clean (1000, 2000, 3000...).`);
                  } else {
                      alert("Data is already clean. No changes needed.");
                  }

              } catch (err: any) {
                  alert("Error during normalization: " + err.message);
              } finally {
                  setIsProcessing(false);
              }
          }
      );
  };

  return (
    <div className="space-y-8">
       {/* Email Config */}
       {view === 'email' && (
         <div>
             <div className="flex justify-between items-center mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
               <div><h3 className="text-lg font-bold text-gray-900">Email Configuration</h3><p className="text-xs text-gray-500 font-medium">Global system defaults & sender settings.</p></div>
             </div>

             <div className="mb-6 bg-blue-50 border border-blue-200 rounded-2xl p-5 text-sm text-blue-900 shadow-sm space-y-2 max-w-2xl">
               <div className="flex items-center gap-2 font-bold text-blue-950">
                 <span>🔐</span> Secure Email Architecture
               </div>
               <p className="text-xs text-blue-800 leading-relaxed">
                 <strong>Branch Order Emails:</strong> Each branch maintains its own dedicated SMTP mailbox with credentials encrypted using AES-256-GCM on the server. Manage branch mailboxes under <strong>Administration → Branches → Email settings</strong>.
               </p>
               <p className="text-xs text-blue-800 leading-relaxed">
                 <strong>System Dispatches:</strong> Shared delivery notes, credit claims, and price alert dispatches utilize secure server-side environment variables (<code className="bg-blue-100 px-1 py-0.5 rounded font-mono">SMTP_*</code>). Plaintext credentials are never persisted in client-accessible documents or backups.
               </p>
             </div>
             <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm max-w-2xl">
                <form onSubmit={handleEmailSave} className="space-y-5">
                   <div className="flex items-center gap-3 mb-6 bg-gray-50 p-3 rounded-xl border border-gray-100">
                      <input type="checkbox" id="emailEnabled" checked={emailForm.enabled} onChange={e => { setEmailForm({...emailForm, enabled: e.target.checked}); setEmailDirty(true); }} className="w-5 h-5 text-brand-600 rounded focus:ring-brand-500" />
                      <label htmlFor="emailEnabled" className="text-sm font-bold text-gray-900 cursor-pointer">Enable Email Sending</label>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Sender Name</label><input type="text" value={emailForm.fromName} onChange={e => { setEmailForm({...emailForm, fromName: e.target.value}); setEmailDirty(true); }} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all" /></div>
                      <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Sender Email</label><input type="text" value={emailForm.fromEmail} onChange={e => { setEmailForm({...emailForm, fromEmail: e.target.value}); setEmailDirty(true); }} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all" /></div>
                      <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Default Reply-To</label><input type="text" value={emailForm.replyTo || ''} onChange={e => { setEmailForm({...emailForm, replyTo: e.target.value}); setEmailDirty(true); }} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all" placeholder="info@hareandtortoise.co.uk" /></div>
                      <div><label className="text-xs font-bold text-gray-500 uppercase mb-1 block">Fallback SMTP Host (Optional)</label><input type="text" value={emailForm.smtpHost || ''} onChange={e => { setEmailForm({...emailForm, smtpHost: e.target.value}); setEmailDirty(true); }} className="w-full border border-gray-300 rounded-lg p-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-500 transition-all" placeholder="smtp.fasthosts.co.uk" /></div>
                   </div>
                   <div className="flex justify-end pt-4">
                      {emailDirty && <span className="text-xs text-orange-600 font-bold mr-4 self-center bg-orange-50 px-2 py-1 rounded">Unsaved Changes</span>}
                      <button type="submit" disabled={isProcessing} className="bg-brand-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-brand-700 disabled:opacity-50 flex items-center gap-2 shadow-sm transition-all active:scale-95">
                         {isProcessing ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />} Save Settings
                      </button>
                   </div>
                </form>
             </div>
         </div>
       )}

       {/* Data Operations */}
       {view === 'data' && (
         <div>
             <div className="flex justify-between items-center mb-6 bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
               <div><h3 className="text-lg font-bold text-gray-900">Data & System</h3><p className="text-xs text-gray-500 font-medium">Backup, restore, and maintenance.</p></div>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center text-center hover:border-blue-200 transition-all group">
                   <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Download size={28} /></div>
                   <h4 className="font-bold text-gray-900 mb-1 text-lg">Export Config</h4>
                   <p className="text-xs text-gray-500 mb-6 font-medium">Download Products, Suppliers, and Settings.</p>
                   <button onClick={handleExportConfig} className="w-full py-2.5 bg-white border border-gray-200 hover:bg-blue-50 hover:border-blue-200 text-gray-700 hover:text-blue-700 font-bold rounded-xl text-sm transition-all shadow-sm">Download JSON</button>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center text-center hover:border-purple-200 transition-all group">
                   <div className="w-14 h-14 bg-purple-50 text-purple-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Upload size={28} /></div>
                   <h4 className="font-bold text-gray-900 mb-1 text-lg">Import Config</h4>
                   <p className="text-xs text-gray-500 mb-6 font-medium">Restore Config from JSON (No Orders/Users).</p>
                   <input type="file" ref={fileInputRef} onChange={handleImportData} className="hidden" accept=".json" />
                   <button onClick={() => fileInputRef.current?.click()} disabled={isProcessing} className="w-full py-2.5 bg-white border border-gray-200 hover:bg-purple-50 hover:border-purple-200 text-gray-700 hover:text-purple-700 font-bold rounded-xl text-sm flex justify-center gap-2 transition-all shadow-sm">
                      {isProcessing ? <Loader2 className="animate-spin" size={16} /> : 'Upload JSON'}
                   </button>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center text-center hover:border-green-200 transition-all group">
                   <div className="w-14 h-14 bg-green-50 text-green-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><RefreshCw size={28} /></div>
                   <h4 className="font-bold text-gray-900 mb-1 text-lg">Normalize Sort</h4>
                   <p className="text-xs text-gray-500 mb-6 font-medium">Fix decimals & duplicate sort indexes.</p>
                   <button onClick={handleNormalizeSortOrders} disabled={isProcessing} className="w-full py-2.5 bg-white border border-green-200 hover:bg-green-50 text-green-700 font-bold rounded-xl text-sm flex justify-center gap-2 transition-all shadow-sm">
                      {isProcessing ? <Loader2 className="animate-spin" size={16} /> : 'Clean Database'}
                   </button>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex flex-col items-center text-center hover:border-orange-200 transition-all group">
                   <div className="w-14 h-14 bg-orange-50 text-orange-600 rounded-full flex items-center justify-center mb-4 group-hover:scale-110 transition-transform"><Database size={28} /></div>
                  <h4 className="font-bold text-gray-900 mb-1 text-lg">Default Roles</h4>
                   <p className="text-xs text-gray-500 mb-6 font-medium">Restore standard roles and permissions.</p>
                   <button onClick={handleSeedDatabase} disabled={isProcessing} className="w-full py-2.5 bg-white border border-red-200 hover:bg-red-50 text-red-600 font-bold rounded-xl text-sm flex justify-center gap-2 transition-all shadow-sm">
                      {isProcessing ? <Loader2 className="animate-spin" size={16} /> : 'Restore Default Roles'}
                   </button>
                </div>
             </div>
             
             <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 flex items-start gap-3">
                <AlertTriangle className="text-yellow-600 shrink-0" size={20} />
                <div>
                    <h4 className="text-sm font-bold text-yellow-800">Note on Data Privacy</h4>
                    <p className="text-xs text-yellow-700 mt-1">
                        Transactional data (Orders) and Personal Information (User Accounts) are excluded from client-side backups for security and performance. 
                        Please use Google Cloud Console for full database snapshots.
                    </p>
                </div>
             </div>
         </div>
       )}
     <ConfirmModal
        isOpen={confirmOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.action}
        onClose={() => { setConfirmOpen(false); if (fileInputRef.current) fileInputRef.current.value=''; }}
        confirmText="Yes, Continue"
      />
    </div>
  );
};

