import React, { useState, useMemo } from 'react';
import { useAppStore } from '../../store';
import { PriceHistoryRecord } from '../../types';
import { Search, Filter, History, Download, Calendar, ArrowUpRight, ArrowDownRight, User, FileText, ChevronRight } from 'lucide-react';

export const PriceHistoryView: React.FC = () => {
  const { priceHistory, suppliers, products } = useAppStore();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('ALL');
  const [selectedProductId, setSelectedProductId] = useState<string>('ALL');
  const [sortField, setSortField] = useState<'approvedAt' | 'effectiveDate'>('approvedAt');

  // Filtered price history
  const filteredRecords = useMemo(() => {
    let list = [...priceHistory];

    if (selectedSupplierId !== 'ALL') {
      list = list.filter((r) => r.supplierId === selectedSupplierId);
    }

    if (selectedProductId !== 'ALL') {
      list = list.filter((r) => r.productId === selectedProductId);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.productName.toLowerCase().includes(q) ||
          (r.itemCode && r.itemCode.toLowerCase().includes(q)) ||
          r.supplierName.toLowerCase().includes(q) ||
          (r.invoiceRef && r.invoiceRef.toLowerCase().includes(q)) ||
          r.approvedByUserName.toLowerCase().includes(q)
      );
    }

    // Sort by latest first
    list.sort((a, b) => new Date(b[sortField] || 0).getTime() - new Date(a[sortField] || 0).getTime());

    return list;
  }, [priceHistory, selectedSupplierId, selectedProductId, searchQuery, sortField]);

  // Export CSV
  const handleExportCsv = () => {
    if (filteredRecords.length === 0) return;

    const headers = [
      'Product Name',
      'Item Code',
      'Supplier',
      'Previous Case Price (£)',
      'New Case Price (£)',
      'Price Difference (£)',
      'Effective Date',
      'Invoice / Note Ref',
      'Approved By',
      'Approval Date',
      'Notes',
    ];

    const rows = filteredRecords.map((r) => {
      const prev = r.previousCasePrice ?? r.oldCasePrice ?? 0;
      const current = r.newCasePrice ?? 0;
      const diff = (current - prev).toFixed(2);
      return [
        `"${r.productName.replace(/"/g, '""')}"`,
        `"${r.itemCode || ''}"`,
        `"${r.supplierName.replace(/"/g, '""')}"`,
        r.previousCasePrice !== undefined ? r.previousCasePrice.toFixed(2) : (r.oldCasePrice !== undefined ? r.oldCasePrice.toFixed(2) : '-'),
        r.newCasePrice !== undefined ? r.newCasePrice.toFixed(2) : '-',
        diff,
        r.effectiveDate,
        `"${r.invoiceRef || ''}"`,
        `"${r.approvedByUserName || ''}"`,
        r.approvedAt ? r.approvedAt.split('T')[0] : '',
        `"${(r.notes || '').replace(/"/g, '""')}"`,
      ].join(',');
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Price_History_Audit_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="flex-1 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by product, code, supplier, or invoice..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 text-xs border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-brand-500 bg-gray-50 focus:bg-white transition-colors"
            />
          </div>

          <select
            value={selectedSupplierId}
            onChange={(e) => setSelectedSupplierId(e.target.value)}
            className="text-xs border border-gray-200 rounded-xl px-3 py-2 bg-gray-50 outline-none focus:ring-2 focus:ring-brand-500 font-medium"
          >
            <option value="ALL">All Suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 self-end md:self-center">
          <button
            onClick={handleExportCsv}
            disabled={filteredRecords.length === 0}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-xl shadow-sm transition-all active:scale-95 disabled:opacity-50"
          >
            <Download size={14} className="text-gray-500" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Table / List */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
        {filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <History size={36} className="mx-auto text-gray-300 mb-2" />
            <p className="text-sm font-bold text-gray-600">No Price Revisions Found</p>
            <p className="text-xs text-gray-400 mt-0.5">
              Historical price revisions will appear here automatically when price updates are approved.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 font-bold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Effective Date</th>
                  <th className="py-3 px-4">Product</th>
                  <th className="py-3 px-4">Supplier</th>
                  <th className="py-3 px-4 text-right">Old Price</th>
                  <th className="py-3 px-4 text-right">New Price</th>
                  <th className="py-3 px-4 text-center">Change</th>
                  <th className="py-3 px-4">Invoice Ref</th>
                  <th className="py-3 px-4">Approved By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecords.map((record) => {
                  const prev = record.previousCasePrice ?? record.oldCasePrice ?? 0;
                  const current = record.newCasePrice ?? 0;
                  const isIncrease = current > prev;
                  const diff = current - prev;
                  const pct =
                    prev > 0
                      ? Math.round((diff / prev) * 1000) / 10
                      : 0;

                  return (
                    <tr key={record.id} className="hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 px-4 whitespace-nowrap font-medium text-gray-600">
                        {record.effectiveDate}
                      </td>
                      <td className="py-3 px-4">
                        <span className="font-bold text-gray-900 block truncate max-w-[220px]">
                          {record.productName}
                        </span>
                        {record.itemCode && (
                          <span className="text-[10px] font-mono text-gray-400">
                            {record.itemCode}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-700 font-medium">
                        {record.supplierName}
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-gray-400 line-through">
                        {record.previousCasePrice !== undefined || record.oldCasePrice !== undefined ? `£${prev.toFixed(2)}` : '-'}
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-gray-900">
                        {record.newCasePrice !== undefined ? `£${current.toFixed(2)}` : '-'}
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            isIncrease
                              ? 'bg-red-50 text-red-700'
                              : 'bg-green-50 text-green-700'
                          }`}
                        >
                          {isIncrease ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}
                          {diff > 0 ? `+£${diff.toFixed(2)}` : `-£${Math.abs(diff).toFixed(2)}`} ({pct > 0 ? `+${pct}%` : `${pct}%`})
                        </span>
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap font-mono text-gray-600">
                        {record.invoiceRef || '—'}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap text-gray-600">
                        <span className="font-medium text-gray-800">{record.approvedByUserName}</span>
                        {record.approvedAt && (
                          <span className="text-[10px] text-gray-400 block">
                            {record.approvedAt.split('T')[0]}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
