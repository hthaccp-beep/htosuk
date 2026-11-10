
import React, { useState, useMemo } from 'react';
import { useAppStore, can } from '../store';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Calendar, Filter, FileSpreadsheet, DownloadCloud, Loader2, TrendingUp, Award, AlertCircle } from 'lucide-react';
import { LIVE_SYNC_DAYS } from '../constants';
import { calculateIngredientInflation } from '../utils/orderingEnhancements';
import { getUserAuthorizedBranches, isSupplierPermittedForUser, isSupplierAvailableAtBranch } from '../utils/accessControl';

export const Reports: React.FC = () => {
  const { orders, branches, suppliers, products, priceHistory, currentUser, fetchArchivedOrders } = useAppStore();
  
  // Permission Check
  const canViewGlobal = can(currentUser, 'view_global_data');

  // Updated tabs to match requested Report Types including Enhancements
  const [activeTab, setActiveTab] = useState<'overall' | 'branch' | 'item' | 'supplier' | 'inflation' | 'executive'>('overall');

  // Filters
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  
  const authorizedBranches = useMemo(() => {
    return getUserAuthorizedBranches(currentUser, branches);
  }, [currentUser, branches]);

  // Strict Initialization: Default to 'all' ONLY if has global view, otherwise first authorized branch
  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    if (canViewGlobal) return 'all';
    if (currentUser?.branchId && authorizedBranches.some(b => b.id === currentUser.branchId)) {
      return currentUser.branchId;
    }
    return authorizedBranches[0]?.id || '';
  });
  
  const [selectedSupplierId, setSelectedSupplierId] = useState('all');
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);

  const selectableSuppliers = useMemo(() => {
    return suppliers.filter(s => {
      if (!s.active) return false;
      if (selectedBranchId !== 'all') {
        if (!isSupplierAvailableAtBranch(s, selectedBranchId)) return false;
        return isSupplierPermittedForUser(currentUser, s, selectedBranchId);
      }
      // When 'all' branches is selected
      if (canViewGlobal) return true;
      return authorizedBranches.some(b => 
        isSupplierAvailableAtBranch(s, b.id) && isSupplierPermittedForUser(currentUser, s, b.id)
      );
    });
  }, [suppliers, selectedBranchId, currentUser, canViewGlobal, authorizedBranches]);

  // Check if data is missing based on dateFrom
  const isDataMissing = useMemo(() => {
      const fromDate = new Date(dateFrom);
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - LIVE_SYNC_DAYS);
      return fromDate < limitDate;
  }, [dateFrom]);

  const handleFetchMissing = async () => {
      setIsFetchingHistory(true);
      try {
          // Fetch from dateFrom to today-LIVE_SYNC_DAYS (since live handles the rest)
          const end = new Date();
          end.setDate(end.getDate() - LIVE_SYNC_DAYS);
          
          await fetchArchivedOrders(new Date(dateFrom).toISOString(), end.toISOString());
      } finally {
          setIsFetchingHistory(false);
      }
  };

  // Filtering Logic
  const filteredOrders = useMemo(() => {
    const from = new Date(dateFrom);
    from.setHours(0,0,0,0);
    const to = new Date(dateTo);
    to.setHours(23,59,59,999);

    return orders.filter(o => {
      // Exclude DRAFT orders from reports to ensure accuracy
      if (o.status === 'DRAFT') return false;

      const orderDate = new Date(o.createdAt);
      const isDateValid = orderDate >= from && orderDate <= to;
      
      const isBranchValid = selectedBranchId === 'all' 
        ? (canViewGlobal ? true : authorizedBranches.some(b => b.id === o.branchId))
        : o.branchId === selectedBranchId;

      if (!isBranchValid) return false;

      // Ensure user has access to this supplier
      const supplierObj = suppliers.find(s => s.id === o.supplierId);
      if (!canViewGlobal && !isSupplierPermittedForUser(currentUser, supplierObj, o.branchId)) {
        return false;
      }

      const isSupplierValid = selectedSupplierId === 'all' || o.supplierId === selectedSupplierId;
      return isDateValid && isSupplierValid;
    });
  }, [orders, dateFrom, dateTo, selectedBranchId, selectedSupplierId, canViewGlobal, authorizedBranches, suppliers, currentUser]);

  // Calculations
  const stats = useMemo(() => {
    let totalSpent = 0;
    let totalItems = 0;
    
    filteredOrders.forEach(o => {
      o.items.forEach(i => {
        totalItems += i.caseQty + i.packQty;
        // Robust price calculation handling missing values
        const caseCost = (i.casePriceSnapshot || 0) * i.caseQty;
        const packCost = (i.packPriceSnapshot || 0) * i.packQty;
        totalSpent += caseCost + packCost;
      });
      // Manual items (no price usually, just count)
      totalItems += o.manualItems.reduce((acc, m) => acc + m.caseQty + m.packQty, 0);
    });

    return { totalSpent, totalItems, count: filteredOrders.length };
  }, [filteredOrders]);

  const chartData = useMemo(() => {
    // Key by YYYY-MM-DD to allow correct sorting, display formatted date
    const dataMap: Record<string, { sortDate: string, displayDate: string, spend: number }> = {};
    
    filteredOrders.forEach(o => {
      const dateObj = new Date(o.createdAt);
      const sortDate = dateObj.toISOString().split('T')[0];
      const displayDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });

      if (!dataMap[sortDate]) {
        dataMap[sortDate] = { sortDate, displayDate, spend: 0 };
      }
      
      o.items.forEach(i => {
         const caseCost = (i.casePriceSnapshot || 0) * i.caseQty;
         const packCost = (i.packPriceSnapshot || 0) * i.packQty;
         dataMap[sortDate].spend += caseCost + packCost;
      });
    });
    
    // Sort chronologically using the ISO string key
    return Object.values(dataMap).sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  }, [filteredOrders]);

  // Aggregation for Branch Report
  const branchReport = useMemo(() => {
    const report: Record<string, { id: string, name: string, orderCount: number, spend: number }> = {};
    branches.forEach(b => {
      if (selectedBranchId !== 'all' && b.id !== selectedBranchId) return;
      report[b.id] = { id: b.id, name: b.name, orderCount: 0, spend: 0 };
    });

    filteredOrders.forEach(o => {
      if (report[o.branchId]) {
        report[o.branchId].orderCount++;
        let oSpend = 0;
        o.items.forEach(i => {
          const caseCost = (i.casePriceSnapshot || 0) * i.caseQty;
          const packCost = (i.packPriceSnapshot || 0) * i.packQty;
          oSpend += caseCost + packCost;
        });
        report[o.branchId].spend += oSpend;
      }
    });
    return Object.values(report).filter(r => r.orderCount > 0 || selectedBranchId !== 'all').sort((a,b) => b.spend - a.spend);
  }, [filteredOrders, branches, selectedBranchId]);

  // Aggregation for Supplier Report
  const supplierReport = useMemo(() => {
    const report: Record<string, { id: string, name: string, orderCount: number, spend: number }> = {};
    suppliers.forEach(s => {
      if (selectedSupplierId !== 'all' && s.id !== selectedSupplierId) return;
      report[s.id] = { id: s.id, name: s.name, orderCount: 0, spend: 0 };
    });

    filteredOrders.forEach(o => {
      if (report[o.supplierId]) {
        report[o.supplierId].orderCount++;
        let oSpend = 0;
        o.items.forEach(i => {
          const caseCost = (i.casePriceSnapshot || 0) * i.caseQty;
          const packCost = (i.packPriceSnapshot || 0) * i.packQty;
          oSpend += caseCost + packCost;
        });
        report[o.supplierId].spend += oSpend;
      }
    });
    return Object.values(report).filter(r => r.orderCount > 0 || selectedSupplierId !== 'all').sort((a,b) => b.spend - a.spend);
  }, [filteredOrders, suppliers, selectedSupplierId]);

  // Aggregation for Item Report
  const itemReport = useMemo(() => {
    const report: Record<string, { id: string, name: string, qty: number, spend: number }> = {};
    
    filteredOrders.forEach(o => {
      o.items.forEach(i => {
        if (!report[i.productId]) {
          report[i.productId] = { id: i.productId, name: i.productNameSnapshot, qty: 0, spend: 0 };
        }
        report[i.productId].qty += (i.caseQty + i.packQty);
        
        const caseCost = (i.casePriceSnapshot || 0) * i.caseQty;
        const packCost = (i.packPriceSnapshot || 0) * i.packQty;
        report[i.productId].spend += caseCost + packCost;
      });
    });

    return Object.values(report).sort((a,b) => b.qty - a.qty);
  }, [filteredOrders]);

  const inflationMetrics = useMemo(() => {
    return calculateIngredientInflation(priceHistory || [], products || []);
  }, [priceHistory, products]);

  const executiveKpis = useMemo(() => {
    const placedOrders = filteredOrders.filter(o => o.status === 'PLACED');
    const totalOrders = placedOrders.length;
    const totalSpend = stats.totalSpent;
    const avgOrderValue = totalOrders > 0 ? totalSpend / totalOrders : 0;
    
    // Total pending credit claims
    const ordersWithClaims = placedOrders.filter(o => o.creditNoteClaim);
    const totalClaimAmount = ordersWithClaims.reduce((acc, o) => acc + (o.creditNoteClaim?.totalClaimAmount || 0), 0);
    
    // Fulfillment stats
    const fulfilledOrders = placedOrders.filter(o => o.fulfillmentStatus === 'FULFILLED').length;
    const partialOrders = placedOrders.filter(o => o.fulfillmentStatus === 'PARTIAL').length;
    const fulfillmentRate = totalOrders > 0 ? ((fulfilledOrders + partialOrders * 0.5) / totalOrders) * 100 : 100;

    return {
      totalOrders,
      totalSpend,
      avgOrderValue,
      totalClaimAmount,
      claimsCount: ordersWithClaims.length,
      fulfillmentRate,
    };
  }, [filteredOrders, stats]);

  const handleExport = () => {
    let csv = '';
    const dateStr = new Date().toISOString().slice(0,10);

    if (activeTab === 'overall') {
       csv = `Report,Order Summary (Overall)\nDate Range,${dateFrom} to ${dateTo}\n\n`;
       csv += `Total Orders,${stats.count}\nTotal Items,${stats.totalItems}\nTotal Spend,${stats.totalSpent.toFixed(2)}\n\n`;
       csv += "Date,Daily Spend\n";
       chartData.forEach(d => {
         csv += `"${d.displayDate}",${d.spend.toFixed(2)}\n`;
       });
    } else if (activeTab === 'branch') {
       csv = "Branch,Orders,Total Spend\n";
       branchReport.forEach(r => {
         csv += `"${r.name}",${r.orderCount},${r.spend.toFixed(2)}\n`;
       });
       csv += `\nTOTAL,${stats.count},${stats.totalSpent.toFixed(2)}`;
    } else if (activeTab === 'supplier') {
       csv = "Supplier,Orders,Total Spend\n";
       supplierReport.forEach(r => {
         csv += `"${r.name}",${r.orderCount},${r.spend.toFixed(2)}\n`;
       });
       csv += `\nTOTAL,${stats.count},${stats.totalSpent.toFixed(2)}`;
    } else if (activeTab === 'item') {
       csv = "Product ID,Product Name,Total Qty,Total Spend\n";
       itemReport.forEach(r => {
         const product = products.find(p => p.id === r.id);
         const displayCode = product?.itemCode ? `#${product.itemCode}` : '';
         csv += `"${displayCode || r.id}","${r.name}",${r.qty},${r.spend.toFixed(2)}\n`;
       });
    } else if (activeTab === 'inflation') {
       csv = "Product Code,Product Name,Supplier,Earliest Price,Current Price,Price Delta,Inflation %\n";
       inflationMetrics.forEach(m => {
         csv += `"${m.itemCode || m.productId}","${m.productName}","${m.supplierName}",${m.earliestPrice.toFixed(2)},${m.currentPrice.toFixed(2)},${m.priceDelta.toFixed(2)},${m.percentInflation.toFixed(1)}%\n`;
       });
    } else if (activeTab === 'executive') {
       csv = `Report,Executive Weekly Purchasing Briefing\nDate Range,${dateFrom} to ${dateTo}\n\n`;
       csv += `Total Orders,${executiveKpis.totalOrders}\nTotal Spend,£${executiveKpis.totalSpend.toFixed(2)}\nAverage Order Value,£${executiveKpis.avgOrderValue.toFixed(2)}\nSupplier Fulfillment Rate,${executiveKpis.fulfillmentRate.toFixed(1)}%\nCredit Claims Value,£${executiveKpis.totalClaimAmount.toFixed(2)}\nClaims Count,${executiveKpis.claimsCount}\n`;
    }

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Report_${activeTab}_${dateStr}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6 pb-20 max-w-7xl mx-auto animate-fade-in">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-gray-900">Reports & Analytics</h2>
        
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-4 items-end md:items-center justify-between">
           <div className="flex flex-wrap gap-4 w-full md:w-auto">
             <div>
               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date From</label>
               <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500" />
             </div>
             <div>
               <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date To</label>
               <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-brand-500" />
             </div>
             
             {/* Show Branch Filter if user has Global View or multiple authorized branches */}
             {(canViewGlobal || authorizedBranches.length > 1) && (
               <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Branch</label>
                  <select 
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[140px] bg-white outline-none focus:ring-2 focus:ring-brand-500 font-semibold"
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                  >
                    <option value="all">{canViewGlobal ? 'All Branches' : 'All My Branches'}</option>
                    {(canViewGlobal ? branches : authorizedBranches).map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
               </div>
             )}

             <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Supplier</label>
                <select 
                  className="border border-gray-300 rounded px-2 py-1.5 text-sm min-w-[140px] bg-white outline-none focus:ring-2 focus:ring-brand-500 font-semibold"
                  value={selectedSupplierId}
                  onChange={e => setSelectedSupplierId(e.target.value)}
                >
                  <option value="all">All Eligible Suppliers</option>
                  {selectableSuppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
             </div>
           </div>
           
           <button onClick={handleExport} className="flex items-center gap-2 text-sm font-medium text-brand-700 bg-brand-50 px-4 py-2 rounded-lg hover:bg-brand-100 transition-colors">
             <FileSpreadsheet size={18} /> Export View
           </button>
        </div>
      </div>

      {isDataMissing && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                  <div className="bg-blue-100 p-2 rounded-lg text-blue-600"><DownloadCloud size={20} /></div>
                  <div>
                      <h4 className="text-sm font-bold text-blue-900">Historical Data Required</h4>
                      <p className="text-xs text-blue-700">The selected date range includes data older than {LIVE_SYNC_DAYS} days which is not loaded by default.</p>
                  </div>
              </div>
              <button 
                onClick={handleFetchMissing} 
                disabled={isFetchingHistory}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-blue-700 transition-colors flex items-center gap-2"
              >
                {isFetchingHistory ? <Loader2 className="animate-spin" size={14} /> : 'Load Data'}
              </button>
          </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex border-b border-gray-200 overflow-x-auto no-scrollbar">
        <button 
          onClick={() => setActiveTab('overall')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'overall' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Order Summary (Overall)
        </button>
        <button 
          onClick={() => setActiveTab('branch')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'branch' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Summary by Branch
        </button>
        <button 
          onClick={() => setActiveTab('item')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'item' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Summary by Item
        </button>
        <button 
          onClick={() => setActiveTab('supplier')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap ${activeTab === 'supplier' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          Summary by Supplier
        </button>
        <button 
          onClick={() => setActiveTab('inflation')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeTab === 'inflation' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <TrendingUp size={16} /> Cost Trends & Inflation
        </button>
        <button 
          onClick={() => setActiveTab('executive')}
          className={`px-6 py-3 text-sm font-bold border-b-2 transition-colors whitespace-nowrap flex items-center gap-1.5 ${activeTab === 'executive' ? 'border-brand-500 text-brand-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
        >
          <Award size={16} /> Executive Briefing
        </button>
      </div>

      {/* Content Area */}
      {activeTab === 'overall' && (
        <div className="space-y-6 animate-fade-in">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Orders Placed</p>
               <h3 className="text-3xl font-extrabold text-gray-900 mt-2">{stats.count}</h3>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Items Volume</p>
               <h3 className="text-3xl font-extrabold text-brand-600 mt-2">{stats.totalItems}</h3>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Total Spend</p>
               <h3 className="text-3xl font-extrabold text-gray-900 mt-2">£{stats.totalSpent.toFixed(2)}</h3>
               <p className="text-xs text-gray-400 mt-1">*Based on stored prices</p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-6">Spending Trend (Daily)</h3>
            <div className="h-80 w-full relative">
               <ResponsiveContainer width="100%" height="100%" minWidth={0}>
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis dataKey="displayDate" axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} dy={10} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#9ca3af', fontSize: 12}} tickFormatter={(val) => `£${val}`} />
                    <Tooltip 
                      cursor={{fill: '#f9fafb'}} 
                      contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'}}
                      formatter={(value: number) => [`£${value.toFixed(2)}`, 'Spend']}
                    />
                    <Bar dataKey="spend" fill="#0d9488" radius={[4, 4, 0, 0]} barSize={40} />
                  </BarChart>
                </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'branch' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
           <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-gray-200">
               <thead className="bg-gray-50">
                 <tr>
                   <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Branch</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Orders</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Total Spend</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-200">
                 {branchReport.map(r => (
                   <tr key={r.id} className="hover:bg-gray-50">
                     <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                     <td className="px-6 py-4 text-right text-gray-600">{r.orderCount}</td>
                     <td className="px-6 py-4 text-right font-mono text-gray-900">£{r.spend.toFixed(2)}</td>
                   </tr>
                 ))}
                 {branchReport.length === 0 && (
                   <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No data for selected filters.</td></tr>
                 )}
               </tbody>
             </table>
           </div>
        </div>
      )}

      {activeTab === 'supplier' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
           <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-gray-200">
               <thead className="bg-gray-50">
                 <tr>
                   <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Supplier</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Orders</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Total Spend</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-200">
                 {supplierReport.map(r => (
                   <tr key={r.id} className="hover:bg-gray-50">
                     <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                     <td className="px-6 py-4 text-right text-gray-600">{r.orderCount}</td>
                     <td className="px-6 py-4 text-right font-mono text-gray-900">£{r.spend.toFixed(2)}</td>
                   </tr>
                 ))}
                 {supplierReport.length === 0 && (
                   <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No data for selected filters.</td></tr>
                 )}
               </tbody>
             </table>
           </div>
        </div>
      )}

       {activeTab === 'item' && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden animate-fade-in">
           <div className="overflow-x-auto">
             <table className="min-w-full divide-y divide-gray-200">
               <thead className="bg-gray-50">
                 <tr>
                   <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Product</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Qty Sold (Units)</th>
                   <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Total Value</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-200">
                 {itemReport.map(r => {
                   // Lookup the product to display its item code instead of the internal ID
                   const product = products.find(p => p.id === r.id);
                   return (
                     <tr key={r.id} className="hover:bg-gray-50">
                       <td className="px-6 py-4">
                         <div className="font-medium text-gray-900">{r.name}</div>
                         {/* Display Item Code if available, otherwise nothing. Do NOT display r.id (UUID) */}
                         {product?.itemCode && (
                           <div className="text-xs text-gray-500 font-mono">#{product.itemCode}</div>
                         )}
                       </td>
                       <td className="px-6 py-4 text-right text-gray-600">{r.qty}</td>
                       <td className="px-6 py-4 text-right font-mono text-gray-900">£{r.spend.toFixed(2)}</td>
                     </tr>
                   );
                 })}
                 {itemReport.length === 0 && (
                   <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400">No data for selected filters.</td></tr>
                 )}
               </tbody>
             </table>
           </div>
        </div>
       )}

       {/* Inflation & Cost Trends Tab */}
       {activeTab === 'inflation' && (
         <div className="space-y-6 animate-fade-in">
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Tracked Price Changes</p>
               <h3 className="text-3xl font-extrabold text-gray-900 mt-2">{priceHistory?.length || 0}</h3>
               <p className="text-xs text-gray-400 mt-1">Across official supplier invoices</p>
             </div>
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Highest Price Increase</p>
               <h3 className="text-3xl font-extrabold text-rose-600 mt-2">
                 {inflationMetrics.length > 0 ? `+${inflationMetrics[0].percentInflation}%` : '0.0%'}
               </h3>
               <p className="text-xs text-gray-500 mt-1 truncate">
                 {inflationMetrics.length > 0 ? inflationMetrics[0].productName : 'No increases recorded'}
               </p>
             </div>
             <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
               <p className="text-sm font-bold text-gray-500 uppercase">Average Ingredient Volatility</p>
               <h3 className="text-3xl font-extrabold text-brand-600 mt-2">
                 {inflationMetrics.length > 0 
                   ? `+${(inflationMetrics.reduce((a, b) => a + b.percentInflation, 0) / inflationMetrics.length).toFixed(1)}%` 
                   : '0.0%'}
               </h3>
               <p className="text-xs text-gray-400 mt-1">Weighted against baseline pricing</p>
             </div>
           </div>

           <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
             <div className="p-4 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
               <div>
                 <h4 className="text-sm font-bold text-gray-900">Historical Price Movement by Product</h4>
                 <p className="text-xs text-gray-500">Track price shifts across supplier delivery notes & approved updates</p>
               </div>
               <span className="text-xs bg-brand-50 text-brand-700 font-bold px-2 py-1 rounded border border-brand-200">
                 {inflationMetrics.length} Items Audited
               </span>
             </div>
             <div className="overflow-x-auto">
               <table className="min-w-full divide-y divide-gray-200">
                 <thead className="bg-gray-50">
                   <tr>
                     <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Item Description</th>
                     <th className="px-6 py-3 text-left text-xs font-bold text-gray-500 uppercase">Supplier</th>
                     <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Earliest Price</th>
                     <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Current Price</th>
                     <th className="px-6 py-3 text-right text-xs font-bold text-gray-500 uppercase">Net Difference</th>
                     <th className="px-6 py-3 text-center text-xs font-bold text-gray-500 uppercase">Inflation Shift</th>
                   </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-200">
                   {inflationMetrics.map(m => {
                     const isIncrease = m.priceDelta > 0;
                     const isZero = m.priceDelta === 0;
                     return (
                       <tr key={m.productId} className="hover:bg-gray-50">
                         <td className="px-6 py-4">
                           <div className="font-medium text-gray-900">{m.productName}</div>
                           {m.itemCode && <div className="text-xs font-mono text-gray-400">#{m.itemCode}</div>}
                         </td>
                         <td className="px-6 py-4 text-sm text-gray-600">{m.supplierName}</td>
                         <td className="px-6 py-4 text-right font-mono text-sm text-gray-500">£{m.earliestPrice.toFixed(2)}</td>
                         <td className="px-6 py-4 text-right font-mono text-sm font-bold text-gray-900">£{m.currentPrice.toFixed(2)}</td>
                         <td className="px-6 py-4 text-right font-mono text-sm font-medium">
                           <span className={isIncrease ? 'text-rose-600' : isZero ? 'text-gray-400' : 'text-emerald-600'}>
                             {isIncrease ? '+' : ''}£{m.priceDelta.toFixed(2)}
                           </span>
                         </td>
                         <td className="px-6 py-4 text-center">
                           <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold ${
                             isIncrease 
                               ? 'bg-rose-100 text-rose-800' 
                               : isZero 
                               ? 'bg-gray-100 text-gray-700' 
                               : 'bg-emerald-100 text-emerald-800'
                           }`}>
                             {isIncrease ? '+' : ''}{m.percentInflation}%
                           </span>
                         </td>
                       </tr>
                     );
                   })}
                   {inflationMetrics.length === 0 && (
                     <tr>
                       <td colSpan={6} className="px-6 py-8 text-center text-gray-400">
                         No price adjustments recorded yet. Scan invoices in Price Management to detect movements.
                       </td>
                     </tr>
                   )}
                 </tbody>
               </table>
             </div>
           </div>
         </div>
       )}

       {/* Executive Briefing Tab */}
       {activeTab === 'executive' && (
         <div className="space-y-6 animate-fade-in">
           {/* Executive KPI Grid */}
           <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
             <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <p className="text-xs font-bold text-gray-500 uppercase">Purchasing Volume</p>
               <h3 className="text-2xl font-extrabold text-gray-900 mt-1">£{executiveKpis.totalSpend.toFixed(2)}</h3>
               <p className="text-xs text-gray-400 mt-1">{executiveKpis.totalOrders} total orders placed</p>
             </div>
             <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <p className="text-xs font-bold text-gray-500 uppercase">Average Order Size</p>
               <h3 className="text-2xl font-extrabold text-brand-600 mt-1">£{executiveKpis.avgOrderValue.toFixed(2)}</h3>
               <p className="text-xs text-gray-400 mt-1">Per branch delivery order</p>
             </div>
             <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <p className="text-xs font-bold text-gray-500 uppercase">Vendor Fulfillment</p>
               <h3 className={`text-2xl font-extrabold mt-1 ${executiveKpis.fulfillmentRate >= 95 ? 'text-emerald-600' : 'text-amber-600'}`}>
                 {executiveKpis.fulfillmentRate.toFixed(1)}%
               </h3>
               <p className="text-xs text-gray-400 mt-1">Delivery accuracy rate</p>
             </div>
             <div className="bg-white p-5 rounded-xl shadow-sm border border-gray-100">
               <p className="text-xs font-bold text-gray-500 uppercase">Credit Claims Active</p>
               <h3 className="text-2xl font-extrabold text-rose-600 mt-1">£{executiveKpis.totalClaimAmount.toFixed(2)}</h3>
               <p className="text-xs text-gray-400 mt-1">{executiveKpis.claimsCount} claims awaiting credit</p>
             </div>
           </div>

           {/* Executive Summary Narrative */}
           <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
             <div className="flex items-center gap-2 mb-4">
               <Award className="text-brand-600" size={20} />
               <h4 className="text-base font-bold text-gray-900">Executive Group Purchasing Digest</h4>
             </div>
             <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
               <p>
                 During the selected period (<b>{dateFrom}</b> to <b>{dateTo}</b>), Hare & Tortoise Restaurant Group placed 
                 <b> {executiveKpis.totalOrders} purchase orders</b> with a cumulative expenditure of 
                 <b> £{executiveKpis.totalSpend.toFixed(2)}</b> across active branches.
               </p>
               <p>
                 Supplier fulfillment tracking indicates an overall order completion rate of 
                 <b> {executiveKpis.fulfillmentRate.toFixed(1)}%</b>. 
                 {executiveKpis.claimsCount > 0 ? (
                   <> There are currently <b>{executiveKpis.claimsCount} disputed deliveries</b> representing <b>£{executiveKpis.totalClaimAmount.toFixed(2)}</b> in outstanding credit claims awaiting supplier credit notes.</>
                 ) : (
                   <> No active credit claims or disputed invoices are currently recorded for this window.</>
                 )}
               </p>
             </div>

             {/* Branch Spending Breakdown */}
             <div className="mt-6 pt-6 border-t border-gray-100">
               <h5 className="text-xs font-bold text-gray-500 uppercase mb-3">Branch Expenditure Share</h5>
               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                 {branchReport.map(b => (
                   <div key={b.id} className="p-3 rounded-lg bg-gray-50 border border-gray-200 flex justify-between items-center">
                     <div>
                       <p className="text-sm font-bold text-gray-800">{b.name}</p>
                       <p className="text-xs text-gray-500">{b.orderCount} orders</p>
                     </div>
                     <span className="font-mono text-sm font-bold text-gray-900">£{b.spend.toFixed(2)}</span>
                   </div>
                 ))}
               </div>
             </div>
           </div>
         </div>
       )}
    </div>
  );
};
