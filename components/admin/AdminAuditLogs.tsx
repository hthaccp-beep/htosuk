import React, { useState, useMemo } from 'react';
import { useAppStore, can } from '../../store';
import { ShieldCheck, Search, Filter, Clock, User, AlertCircle, FileText, Download } from 'lucide-react';
import {csv as downloadCsv} from '../../app/htos/ui';
import type { AuditLogEntry } from '../../types';

interface Props {
  auditLogs?: AuditLogEntry[];
}

export const AdminAuditLogs: React.FC<Props> = ({ auditLogs = [] }) => {
  const { currentUser } = useAppStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEntity, setSelectedEntity] = useState<string>('ALL');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  const canView = can(currentUser, 'view_audit_logs') || currentUser?.role === 'CREATOR' || currentUser?.role === 'GM';

  const filteredLogs = useMemo(() => {
    return auditLogs.filter((log) => {
      const matchesSearch = 
        log.action.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.userEmail.toLowerCase().includes(searchTerm.toLowerCase()) ||
        log.entityId.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesEntity = selectedEntity === 'ALL' || log.entityType === selectedEntity;

      return matchesSearch && matchesEntity;
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [auditLogs, searchTerm, selectedEntity]);

  if (!canView) {
    return (
      <div className="p-8 text-center bg-white rounded-2xl border border-gray-200">
        <AlertCircle className="mx-auto text-amber-500 mb-2" size={32} />
        <h3 className="text-lg font-bold text-gray-800">Access restricted</h3>
        <p className="text-sm text-gray-500">Only General Managers and Creators have permission to inspect system audit logs.</p>
      </div>
    );
  }

  const exportAuditCsv = () => {
    downloadCsv('HTOS-audit.csv',[
      ['Timestamp','Action','Entity','Record','User','Email','Details'],
      ...filteredLogs.map(l=>[l.timestamp,l.action,l.entityType,l.entityId,l.userName,l.userEmail,JSON.stringify(l.details||{})])
    ]);
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="text-brand-600" size={24} />
            <h3 className="text-lg font-bold text-gray-900">Audit history</h3>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Recorded account and branch mailbox administration events.
          </p>
        </div>
        <button
          onClick={exportAuditCsv}
          className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold text-gray-700 bg-gray-50 hover:bg-gray-100 rounded-lg border border-gray-200 transition-colors"
        >
          <Download size={14} /> Export Audit CSV
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
          <input
            type="text"
            placeholder="Search by action, user, email or record ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>
        <select aria-label="Filter audit events by action"
          value={selectedEntity}
          onChange={(e) => setSelectedEntity(e.target.value)}
          className="px-3 py-2 text-sm bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-brand-500 focus:outline-none font-medium text-gray-700"
        >
          <option value="ALL">All categories</option>
          <option value="USER">User accounts</option>
          <option value="PRICE">Price updates</option>
          <option value="ORDER">Orders</option>
          <option value="CREDIT_CLAIM">Credit Claims</option>
          <option value="BRANCH">Branches</option>
          <option value="SYSTEM">System & Settings</option>
        </select>
      </div>

      {/* Audit Log Table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Timestamp</th>
                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Action</th>
                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Entity</th>
                <th className="px-5 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wider">Operator</th>
                <th className="px-5 py-3 text-right text-xs font-bold text-gray-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredLogs.map((log) => {
                const date = new Date(log.timestamp);
                return (
                  <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-5 py-3.5 whitespace-nowrap text-xs text-gray-500 font-mono">
                      {date.toLocaleDateString('en-GB')} {date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-blue-50 text-blue-800 border border-blue-200 font-mono">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="text-xs font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                        {log.entityType}
                      </span>
                      <span className="ml-2 text-xs font-mono text-gray-400">
                        {log.entityId.slice(0, 10)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <div className="text-xs font-bold text-gray-900">{log.userName}</div>
                      <div className="text-[11px] text-gray-500">{log.userEmail}</div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-right">
                      <button
                        onClick={() => setSelectedLog(log)}
                        className="text-xs font-bold text-brand-600 hover:text-brand-800"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-sm">
                    No matching audit log entries found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Details Inspection Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-200">
            <div className="flex justify-between items-center pb-4 border-b border-gray-100">
              <h4 className="font-bold text-gray-900">Audit Record Details</h4>
              <button
                onClick={() => setSelectedLog(null)}
                className="text-gray-400 hover:text-gray-600 font-bold"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 bg-gray-50 rounded-xl">
                <div>
                  <span className="text-gray-400 uppercase font-bold block text-[10px]">Action</span>
                  <span className="font-bold text-gray-800">{selectedLog.action}</span>
                </div>
                <div>
                  <span className="text-gray-400 uppercase font-bold block text-[10px]">Timestamp</span>
                  <span className="text-gray-800 font-mono">{selectedLog.timestamp}</span>
                </div>
                <div>
                  <span className="text-gray-400 uppercase font-bold block text-[10px]">User</span>
                  <span className="text-gray-800">{selectedLog.userName} ({selectedLog.userEmail})</span>
                </div>
                <div>
                  <span className="text-gray-400 uppercase font-bold block text-[10px]">Target Record</span>
                  <span className="text-gray-800 font-mono">{selectedLog.entityType}: {selectedLog.entityId}</span>
                </div>
              </div>
              <div>
                <span className="text-gray-500 uppercase font-bold block text-[10px] mb-1">Payload Diff & Context</span>
                <pre className="p-3 bg-gray-900 text-gray-100 rounded-xl font-mono text-[11px] overflow-x-auto max-h-60">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
