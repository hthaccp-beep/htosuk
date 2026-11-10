import React, {useState} from 'react';
import type {Branch, Supplier} from '../../types';
import './supplier-details.css';

type Section = 'details' | 'ordering' | 'branches';
// Keep an empty amount while typing; convert it to zero only when saving.
export type SupplierDetailsDraft = Omit<Supplier, 'minimumOrderAmount'> & {minimumOrderAmount?: number | ''};
const sections: {id: Section; label: string}[] = [
  {id: 'details', label: 'Details'}, {id: 'ordering', label: 'Ordering'}, {id: 'branches', label: 'Branches'},
];

/** Presentation only: all edits remain in the parent's protected supplier draft. */
export function SupplierDetailsFields({supplier, branches, onChange, disabled}: {
  supplier: SupplierDetailsDraft; branches: Branch[]; onChange: (supplier: SupplierDetailsDraft) => void; disabled: boolean;
}) {
  const [section, setSection] = useState<Section>('details');
  const change = (patch: Partial<SupplierDetailsDraft>) => onChange({...supplier, ...patch});
  const allBranches = supplier.allBranches ?? true;
  const minimum = supplier.minimumOrderAmount || 0;
  const money = (value: number) => new Intl.NumberFormat('en-GB', {style: 'currency', currency: 'GBP'}).format(value);
  // Native validation still reaches required/invalid fields in another section.
  const revealInvalid = (event: React.InvalidEvent<HTMLFieldSetElement>) => {
    const target = event.target as unknown;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) return;
    const panel = target.closest<HTMLElement>('[data-supplier-section]');
    if (panel?.hidden || target.closest('details:not([open])')) {
      event.preventDefault();
      if (panel) setSection(panel.dataset.supplierSection as Section);
      let parent = target.parentElement;
      while (parent) { if (parent instanceof HTMLDetailsElement) parent.open = true; parent = parent.parentElement; }
      requestAnimationFrame(() => {target.focus(); target.reportValidity();});
    }
  };
  return <>
    <nav className="supplier-sections" aria-label="Supplier sections">
      {sections.map(item => <button key={item.id} type="button" aria-pressed={section === item.id} aria-controls={`supplier-section-${item.id}`} disabled={disabled} onClick={() => setSection(item.id)}>{item.label}</button>)}
    </nav>
    <fieldset disabled={disabled} onInvalidCapture={revealInvalid} className="supplier-fields">
      <section id="supplier-section-details" data-supplier-section="details" hidden={section !== 'details'}>
        <h4>Name and contact</h4>
        <div className="supplier-grid">
          <label className="supplier-wide">Supplier name<input aria-label="Supplier name" required value={supplier.name} onChange={e => change({name: e.target.value})}/></label>
          <label className="supplier-wide">Order email addresses<textarea aria-label="Order Email(s)" rows={2} value={supplier.email || ''} onChange={e => change({email: e.target.value})} placeholder="orders@example.com, accounts@example.com"/><small>Separate addresses with commas. These receive the order.</small></label>
          <label>Sales contact<input aria-label="Contact Name" value={supplier.contactName || ''} onChange={e => change({contactName: e.target.value})}/></label>
          <label>Contact phone<input aria-label="Phone" type="tel" value={supplier.contactPhone || ''} onChange={e => change({contactPhone: e.target.value})}/></label>
        </div>
        <label className="supplier-check supplier-status"><input type="checkbox" checked={supplier.active ?? true} onChange={e => change({active: e.target.checked})}/>Supplier active</label>
      </section>
      <section id="supplier-section-ordering" data-supplier-section="ordering" hidden={section !== 'ordering'}>
        <h4>Ordering defaults</h4>
        <p>Used by every branch unless you enter a different value under Branches.</p>
        <div className="supplier-grid">
          <label>Account code<input aria-label="Global Account Code" value={supplier.globalAccountCode || ''} onChange={e => change({globalAccountCode: e.target.value})} placeholder="Optional"/></label>
          <label>Minimum order · £ excl. VAT<input aria-label="Default minimum order amount" type="number" min="0" max="1000000" step="0.01" value={supplier.minimumOrderAmount ?? 0} onChange={e => change({minimumOrderAmount: e.target.value === '' ? '' : Number(e.target.value)})}/><small>Blank or 0 means no minimum. Below-minimum orders can still be sent and are flagged in Order history.</small></label>
          <label className="supplier-wide">Delivery instructions<input aria-label="Default Schedule" value={supplier.deliverySchedules?.default || ''} onChange={e => change({deliverySchedules: {...supplier.deliverySchedules, default: e.target.value}})} placeholder="e.g. Order by 10 pm for next-day delivery"/><small>Set delivery-day restrictions under Branches.</small></label>
          <label>Send orders by<select aria-label="Preferred Method" value={supplier.preferredMethod || 'EMAIL'} onChange={e => change({preferredMethod: e.target.value as Supplier['preferredMethod']})}><option value="EMAIL">Email only</option><option value="WHATSAPP">WhatsApp only</option><option value="BOTH">Email and WhatsApp</option></select></label>
          {(supplier.preferredMethod === 'WHATSAPP' || supplier.preferredMethod === 'BOTH') && <label>WhatsApp number<input aria-label="WhatsApp Number (Required)" type="tel" required value={supplier.mobileNumber || ''} onChange={e => change({mobileNumber: e.target.value})}/><small>Required for WhatsApp orders.</small></label>}
          <label className="supplier-wide">Supplier type<select aria-label="Internal supplying branch" value={supplier.linkedBranchId || ''} onChange={e => change({linkedBranchId: e.target.value})}><option value="">External supplier</option>{branches.filter(b => b.actsAsSupplier).map(b => <option key={b.id} value={b.id}>Internal — {b.name}</option>)}</select></label>
        </div>
      </section>
      <section id="supplier-section-branches" data-supplier-section="branches" hidden={section !== 'branches'}>
        <h4>Branch access and exceptions</h4>
        <label className="supplier-check"><input type="checkbox" checked={allBranches} onChange={e => change({allBranches: e.target.checked, availableBranchIds: e.target.checked ? [] : (supplier.availableBranchIds || [])})}/>Available at all branches</label>
        <p>{allBranches ? 'All branches are included. Open a branch only if its details differ.' : 'Tick the branches that can order. Open a branch to change its details.'} Admins and General Managers can order from all active suppliers across branches.</p>
        <p className="supplier-default-note">Blank fields use the supplier default. Minimum order: <strong>{money(minimum)}</strong>. Enter 0 for no minimum.</p>
        <div className="supplier-branch-list" aria-label="Serviced branches">
          {branches.map(branch => {
            const included = allBranches || (supplier.availableBranchIds || []).includes(branch.id);
            const code = supplier.branchAccountCodes?.[branch.id];
            const amount = supplier.branchMinimumOrderAmounts?.[branch.id];
            const schedule = supplier.deliverySchedules?.[branch.id];
            const days = supplier.deliveryRules?.[branch.id] || [];
            const custom = !!code || amount !== undefined || !!schedule || days.length > 0;
            return <div className="supplier-branch-row" key={branch.id}>
              {!allBranches && <label className="supplier-branch-access"><input type="checkbox" aria-label={`Allow orders from ${branch.name}`} checked={included} onChange={e => {
                const ids = supplier.availableBranchIds || [];
                change({availableBranchIds: e.target.checked ? [...ids, branch.id] : ids.filter(id => id !== branch.id)});
              }}/></label>}
              <details>
                <summary><span><strong>{branch.name}</strong><small>{branch.code}{!included ? ' · Not selected' : ''} · {custom ? 'Custom settings' : 'Uses defaults'}</small></span><span className="supplier-branch-minimum">{money(amount ?? minimum)}<small>Minimum</small></span></summary>
                <div className="supplier-branch-fields">
                  <div className="supplier-grid">
                    <label>Account code<input aria-label={`Account code for ${branch.name}`} value={code || ''} placeholder={supplier.globalAccountCode ? `Default: ${supplier.globalAccountCode}` : 'Use default'} onChange={e => change({branchAccountCodes: {...supplier.branchAccountCodes, [branch.id]: e.target.value}})}/></label>
                    <label>Minimum order · £ excl. VAT<input aria-label={`Minimum order for ${branch.name}`} type="number" min="0" max="1000000" step="0.01" value={amount ?? ''} placeholder={`Default: ${money(minimum)}`} onChange={e => {
                      const amounts = {...supplier.branchMinimumOrderAmounts};
                      if (e.target.value === '') delete amounts[branch.id]; else amounts[branch.id] = Number(e.target.value);
                      change({branchMinimumOrderAmounts: amounts});
                    }}/></label>
                    <label className="supplier-wide">Delivery instructions<input aria-label={`Delivery instructions for ${branch.name}`} value={schedule || ''} placeholder={supplier.deliverySchedules?.default ? `Default: ${supplier.deliverySchedules.default}` : 'Use default'} onChange={e => change({deliverySchedules: {...supplier.deliverySchedules, [branch.id]: e.target.value}})}/></label>
                  </div>
                  <fieldset className="supplier-days"><legend>Allowed delivery days</legend><div>{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label, day) => <label key={day}><input type="checkbox" aria-label={`${label} delivery for ${branch.name}`} checked={days.includes(day)} onChange={e => {
                    const rules = {...supplier.deliveryRules};
                    const next = e.target.checked ? [...days, day] : days.filter(d => d !== day);
                    if (next.length) rules[branch.id] = next; else delete rules[branch.id];
                    change({deliveryRules: rules});
                  }}/>{label}</label>)}</div><small>No days ticked means no weekday restriction.</small></fieldset>
                </div>
              </details>
            </div>;
          })}
          {branches.length === 0 && <p>No branches are available.</p>}
        </div>
      </section>
    </fieldset>
  </>;
}
