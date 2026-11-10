
import React, { useEffect, useState } from 'react';
import { X, Trash2, Copy, AlertTriangle, Info, AlertCircle, Terminal } from 'lucide-react';
import { getLogs, subscribeLogs, clearLogs, LogEntry, LogType } from '../logger';

interface LogViewerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LogViewer: React.FC<LogViewerProps> = ({ isOpen, onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>(getLogs());
  const [filter, setFilter] = useState<LogType | 'all'>('all');

  useEffect(() => {
    if (!isOpen) return;
    setLogs(getLogs()); // Refresh on open
    const unsubscribe = subscribeLogs(() => setLogs([...getLogs()]));
    return () => { unsubscribe(); };
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredLogs = logs.filter(l => filter === 'all' || l.type === filter);

  const handleCopy = () => {
    const text = logs.map(l => `[${l.timestamp}] [${l.type.toUpperCase()}] ${l.message}`).join('\n');
    navigator.clipboard.writeText(text);
    alert('Logs copied to clipboard');
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-2xl h-[80vh] flex flex-col border border-gray-700 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900 rounded-t-xl">
          <div className="flex items-center gap-2 text-gray-100">
            <Terminal size={20} className="text-brand-500" />
            <h3 className="font-mono font-bold text-lg">System Logs</h3>
            <span className="text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">{logs.length} entries</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded hover:bg-gray-800 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2 p-3 bg-gray-800/50 border-b border-gray-800">
           <div className="flex bg-gray-800 rounded-lg p-1">
              {(['all', 'info', 'warn', 'error'] as const).map(type => (
                <button
                  key={type}
                  onClick={() => setFilter(type)}
                  className={`px-3 py-1 text-xs font-bold rounded-md transition-all uppercase ${
                    filter === type 
                      ? 'bg-gray-600 text-white shadow-sm' 
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                >
                  {type}
                </button>
              ))}
           </div>
           <div className="flex-1"></div>
           <button onClick={handleCopy} className="p-2 text-gray-400 hover:text-white bg-gray-800 hover:bg-gray-700 rounded-lg" title="Copy All">
             <Copy size={16} />
           </button>
           <button onClick={clearLogs} className="p-2 text-gray-400 hover:text-red-400 bg-gray-800 hover:bg-gray-700 rounded-lg" title="Clear Logs">
             <Trash2 size={16} />
           </button>
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-black font-mono text-sm custom-scrollbar">
           {filteredLogs.length === 0 ? (
             <div className="text-center text-gray-600 py-10 italic">No logs found.</div>
           ) : (
             filteredLogs.map(log => (
               <div key={log.id} className="flex gap-3 items-start group">
                  <span className="text-gray-600 text-xs shrink-0 mt-0.5 select-none w-16">{log.timestamp}</span>
                  <div className="shrink-0 mt-0.5">
                    {log.type === 'info' && <Info size={14} className="text-blue-500" />}
                    {log.type === 'warn' && <AlertTriangle size={14} className="text-yellow-500" />}
                    {log.type === 'error' && <AlertCircle size={14} className="text-red-500" />}
                  </div>
                  <span className={`break-all leading-snug ${
                    log.type === 'error' ? 'text-red-400' : 
                    log.type === 'warn' ? 'text-yellow-400' : 'text-gray-300'
                  }`}>
                    {log.message}
                  </span>
               </div>
             ))
           )}
        </div>
      </div>
    </div>
  );
};
