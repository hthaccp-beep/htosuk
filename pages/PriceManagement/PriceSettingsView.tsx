import React, { useState, useEffect } from 'react';
import { useAppStore, can } from '../../store';
import { PriceMonitoringSettings } from '../../types';
import { Settings, ShieldCheck, Bell, Sliders, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

export const PriceSettingsView: React.FC = () => {
  const { priceMonitoringSettings, savePriceMonitoringSettings, currentUser, showToast } = useAppStore();

  const [settings, setSettings] = useState<PriceMonitoringSettings>(priceMonitoringSettings);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (priceMonitoringSettings) {
      setSettings(priceMonitoringSettings);
    }
  }, [priceMonitoringSettings]);

  const canManage = can(currentUser, 'manage_price_monitoring') || currentUser?.role === 'CREATOR' || currentUser?.role === 'GM';

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage) {
      showToast('error', 'You do not have permission to change price monitoring settings.');
      return;
    }

    setIsSaving(true);
    try {
      await savePriceMonitoringSettings(settings);
      showToast('success', 'Price monitoring settings updated successfully.');
    } catch (err: any) {
      console.error('Failed to save price monitoring settings', err);
      showToast('error', `Failed to save settings: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm">
        <div className="flex items-center justify-between pb-5 border-b border-gray-100 mb-6">
          <div>
            <h3 className="text-lg font-bold text-gray-900">Price monitoring</h3>
            <p className="text-xs text-gray-500 font-medium">
              Configure automated invoice OCR detection, approval policies, and notification rules.
            </p>
          </div>
          <div className="w-10 h-10 rounded-xl bg-brand-50 text-brand-600 flex items-center justify-center flex-shrink-0">
            <Sliders size={20} />
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* Master Switch */}
          <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-gray-900">
                Invoice & Delivery Note Price Monitoring
              </h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Master switch for OCR scanning, discrepancy detection, and price notices.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage}
                checked={settings.enabled}
                aria-label="Enable price monitoring"
                onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-brand-600"></div>
            </label>
          </div>

          {/* Sub-Toggles */}
          <div className="space-y-4">
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
              Automated Detection Rules
            </h4>

            {/* Auto-detect price changes */}
            <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div>
                <p className="text-sm font-bold text-gray-800">Detect price differences</p>
                <p className="text-xs text-gray-500">
                  Compare invoiced prices against existing product catalog prices on document scan.
                </p>
              </div>
              <input
                type="checkbox"
                disabled={!canManage || !settings.enabled}
                checked={settings.autoDetectPriceChanges}
                aria-label="Automatic price difference detection"
                onChange={(e) => setSettings({ ...settings, autoDetectPriceChanges: e.target.checked })}
                className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-gray-300 cursor-pointer"
              />
            </div>

            {/* Auto-detect new items */}
            <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div>
                <p className="text-sm font-bold text-gray-800">Detect new or unrecognised items</p>
                <p className="text-xs text-gray-500">
                  Flag products that don't match existing catalog SKUs and trigger duplicate warnings.
                </p>
              </div>
              <input
                type="checkbox"
                disabled={!canManage || !settings.enabled}
                checked={settings.autoDetectNewItems}
                aria-label="New and unrecognised item detection"
                onChange={(e) => setSettings({ ...settings, autoDetectNewItems: e.target.checked })}
                className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-gray-300 cursor-pointer"
              />
            </div>

            {/* Require Manager Approval */}
            <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div>
                <p className="text-sm font-bold text-gray-800">Require manager or GM approval</p>
                <p className="text-xs text-gray-500">
                  Enforce manual authorisation before any price change or new product is added to the system.
                </p>
              </div>
              <input
                type="checkbox"
                disabled={!canManage || !settings.enabled}
                checked={settings.requireManagerApproval}
                aria-label="Require manager or GM approval"
                onChange={(e) => setSettings({ ...settings, requireManagerApproval: e.target.checked })}
                className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-gray-300 cursor-pointer"
              />
            </div>

            {/* Percentage Threshold */}
            <div className="p-3.5 bg-white rounded-xl border border-gray-200">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-gray-800">Price change alert threshold (%)</p>
                  <p className="text-xs text-gray-500">
                    Flag price increases or decreases exceeding this percentage with high-priority warnings.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max="100"
                    disabled={!canManage || !settings.enabled}
                    value={settings.alertOnPercentageThreshold}
                    aria-label="Price change alert threshold (%)"
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        alertOnPercentageThreshold: parseInt(e.target.value) || 5,
                      })
                    }
                    className="w-20 border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm font-bold text-gray-900 text-center outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm font-bold text-gray-500">%</span>
                </div>
              </div>
            </div>

            {/* Email Notifications */}
            <div className="flex items-center justify-between p-3.5 bg-white rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
              <div>
                <p className="text-sm font-bold text-gray-800">Manager email notifications</p>
                <p className="text-xs text-gray-500">
                  Send email alerts to the branch manager or admin when a price change is detected.
                </p>
              </div>
              <input
                type="checkbox"
                disabled={!canManage || !settings.enabled}
                checked={settings.enableEmailAlerts}
                aria-label="Manager email notifications"
                onChange={(e) => setSettings({ ...settings, enableEmailAlerts: e.target.checked })}
                className="w-5 h-5 rounded text-brand-600 focus:ring-brand-500 border-gray-300 cursor-pointer"
              />
            </div>
          </div>

          {/* Save Bar */}
          {canManage && (
            <div className="flex justify-end pt-4 border-t border-gray-100">
              <button
                type="submit"
                disabled={isSaving}
                className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white text-sm font-bold rounded-xl shadow-md flex items-center gap-2 transition-all disabled:opacity-50"
              >
                {isSaving ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Saving settings…</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} />
                    <span>Save settings</span>
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
