import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { 
  Users, MapPin, Truck, Package, Shield, Database, 
  Mail, Sliders, ShieldCheck, Tag, 
  Building2, Layers, Settings, ChevronRight, type LucideIcon
} from 'lucide-react';
import { AdminUsers } from '../components/admin/AdminUsers';
import { AdminRoles } from '../components/admin/AdminRoles';
import { AdminBranches } from '../components/admin/AdminBranches';
import { AdminSuppliers } from '../components/admin/AdminSuppliers';
import { AdminProducts } from '../components/admin/AdminProducts';
import { AdminCategories } from '../components/admin/AdminCategories';
import { AdminSystem } from '../components/admin/AdminSystem';
import { AdminAuditLogs } from '../components/admin/AdminAuditLogs';
import { PriceSettingsView } from './PriceManagement/PriceSettingsView';

export type AdminGroupKey = 'team' | 'network' | 'catalog' | 'system';

export interface AdminSubTab {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  component: React.ReactNode;
}

export interface AdminGroup {
  key: AdminGroupKey;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  description: string;
  tabs: AdminSubTab[];
}

export const Admin: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  const groups: AdminGroup[] = [
    {
      key: 'team',
      label: 'User',
      shortLabel: 'User',
      icon: Users,
      description: 'Staff accounts, roles, and branch access boundaries',
      tabs: [
        { id: 'users', label: 'Users', description: 'User accounts & branch permissions', icon: Users, component: <AdminUsers /> },
        { id: 'roles', label: 'Roles', description: 'System role definitions & capabilities', icon: Shield, component: <AdminRoles /> },
      ],
    },
    {
      key: 'network',
      label: 'Location',
      shortLabel: 'Location',
      icon: Building2,
      description: 'Restaurant locations, internal kitchens & supplier delivery schedules',
      tabs: [
        { id: 'branches', label: 'Branches', description: 'Store locations & supplier branch flags', icon: MapPin, component: <AdminBranches /> },
        { id: 'suppliers', label: 'Suppliers', description: 'External and internal vendors & schedules', icon: Truck, component: <AdminSuppliers /> },
      ],
    },
    {
      key: 'catalog',
      label: 'Products',
      shortLabel: 'Products',
      icon: Layers,
      description: 'Products, categories, price catalog and order reordering',
      tabs: [
        { id: 'categories', label: 'Categories', description: 'Product categories & display sequence', icon: Tag, component: <AdminCategories /> },
        { id: 'products', label: 'Products', description: 'Official items, prices, pack sizes & par levels', icon: Package, component: <AdminProducts /> },
      ],
    },
    {
      key: 'system',
      label: 'Setting',
      shortLabel: 'Setting',
      icon: Settings,
      description: 'Price monitoring, email credentials, audit logs, and data backup',
      tabs: [
        { id: 'prices', label: 'Price Monitoring', description: 'Invoice price detection & approval workflow', icon: Sliders, component: <PriceSettingsView /> },
        { id: 'email', label: 'Email Settings', description: 'SMTP email server setup & order dispatch alerts', icon: Mail, component: <AdminSystem view="email" /> },
        { id: 'audit', label: 'Audit Logs', description: 'Immutable activity & security audit trail', icon: ShieldCheck, component: <AdminAuditLogs /> },
        { id: 'system', label: 'Backup & Restore', description: 'Database export, restore, and demo seeding', icon: Database, component: <AdminSystem view="data" /> },
      ],
    },
  ];

  // Helper to find parent group of any tab id
  const findGroupByTabId = (tabId: string): AdminGroup => {
    for (const group of groups) {
      if (group.tabs.some(t => t.id === tabId)) {
        return group;
      }
    }
    return groups[0];
  };

  const initialTab = searchParams.get('tab') || 'users';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [activeGroupKey, setActiveGroupKey] = useState<AdminGroupKey>(() => findGroupByTabId(initialTab).key);

  // Sync state if URL searchParams changes externally
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && tabParam !== activeTab) {
      setActiveTab(tabParam);
      const parentGroup = findGroupByTabId(tabParam);
      setActiveGroupKey(parentGroup.key);
    }
  }, [searchParams]);

  const handleGroupChange = (groupKey: AdminGroupKey) => {
    setActiveGroupKey(groupKey);
    const targetGroup = groups.find(g => g.key === groupKey) || groups[0];
    
    // If current active tab is already in this group, keep it. Otherwise, switch to first tab of group.
    const isTabInGroup = targetGroup.tabs.some(t => t.id === activeTab);
    const newTabId = isTabInGroup ? activeTab : targetGroup.tabs[0].id;
    
    setActiveTab(newTabId);
    setSearchParams({ tab: newTabId }, { replace: true });
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    const parentGroup = findGroupByTabId(tabId);
    setActiveGroupKey(parentGroup.key);
    setSearchParams({ tab: tabId }, { replace: true });
  };

  const activeGroup = groups.find(g => g.key === activeGroupKey) || groups[0];
  const allTabs = groups.flatMap(g => g.tabs);
  const currentTabObj = allTabs.find(t => t.id === activeTab) || groups[0].tabs[0];

  return (
    <div className="max-w-7xl mx-auto pb-20">
      {/* Header */}
      <div className="mb-4">
        <div>
          <h2 className="text-2xl font-extrabold text-gray-900 tracking-tight">Administration</h2>
          <p className="text-gray-500 text-xs sm:text-sm font-medium mt-0.5">
            System configuration, user management, catalog settings, and data backup.
          </p>
        </div>
      </div>

      {/* Professional Grouped Navigation Bar (Tight & Compact) */}
      <div className="mb-6 bg-white rounded-2xl border border-gray-200/90 shadow-xs overflow-hidden">
        {/* Tier 1: 4 Domain Pillars */}
        <div className="bg-slate-50/90 px-2 sm:px-3 py-1.5 border-b border-gray-200/80 flex items-center justify-between gap-1 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 sm:gap-1.5">
            {groups.map(group => {
              const GroupIcon = group.icon;
              const isGroupActive = activeGroupKey === group.key;

              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => handleGroupChange(group.key)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all select-none whitespace-nowrap shrink-0 ${
                    isGroupActive
                      ? 'bg-white text-brand-700 shadow-xs border border-gray-200/90 ring-1 ring-brand-500/20'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-white/70'
                  }`}
                >
                  <GroupIcon 
                    size={14} 
                    className={isGroupActive ? 'text-brand-600' : 'text-gray-400'} 
                  />
                  <span className="hidden md:inline">{group.label}</span>
                  <span className="md:hidden">{group.shortLabel}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Tier 2: Sub-Tabs for Active Group */}
        <div className="px-2.5 sm:px-3.5 py-2 flex items-center justify-between flex-wrap gap-2 bg-white">
          <div className="flex items-center gap-1.5 flex-wrap">
            {activeGroup.tabs.map(tab => {
              const TabIcon = tab.icon;
              const isTabActive = activeTab === tab.id;

              return (
                <button
                  key={tab.id}
                  type="button"
                  id={`admin-tab-${tab.id}`}
                  onClick={() => handleTabChange(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all select-none ${
                    isTabActive
                      ? 'bg-brand-600 text-white shadow-xs'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/90'
                  }`}
                  title={tab.description}
                >
                  <TabIcon size={14} className={isTabActive ? 'text-white' : 'text-gray-400'} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Breadcrumb Indicator */}
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-gray-400 font-medium">
            <span className="text-gray-500 font-semibold">{activeGroup.label}</span>
            <ChevronRight size={12} className="text-gray-300" />
            <span className="text-brand-700 font-bold">{currentTabObj.label}</span>
          </div>
        </div>
      </div>

      {/* Main Tab Content View */}
      <div className="animate-fade-in">
        {currentTabObj.component}
      </div>
    </div>
  );
};
