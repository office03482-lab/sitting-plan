import React, { useState, useEffect } from 'react';
import { Settings, Save, RefreshCw, Building, Mail, Palette, FileText, Shield } from 'lucide-react';
import { useSettingsStore } from '../store/settings';
import { apiService } from '../services/api';
import { Alert } from '../components/Alert';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { getRuntimeDiagnostics } from '../lib/runtimeConfig';

const SettingsPage: React.FC = () => {
  const {
    settings,
    isLoading,
    updateSettings,
    updateBatchColor,
    resetSettings,
    setLoading
  } = useSettingsStore();

  const [saving, setSaving] = useState(false);
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const diagnostics = getRuntimeDiagnostics();

  useEffect(() => {
    // Only load from API if backend is available
    const loadSettingsFromAPI = async () => {
      try {
        setLoading(true);
        const response = await apiService.getSettings();
        // Update store with API data
        updateSettings(response.data);
      } catch (error) {
        console.warn('Backend not available, using local settings:', error);
        // Keep default settings, don't show error
      } finally {
        setLoading(false);
      }
    };

    loadSettingsFromAPI();
  }, []);

  const handleSaveSettings = async () => {
    try {
      setSaving(true);
      await apiService.updateSettings(settings);
      setAlert({ type: 'success', message: 'Settings saved successfully' });
    } catch (error) {
      console.warn('Backend not available, settings saved locally:', error);
      setAlert({ type: 'success', message: 'Settings saved locally (server not available)' });
    } finally {
      setSaving(false);
    }
  };

  const handleResetSettings = async () => {
    try {
      await apiService.resetSettings();
      resetSettings();
      setAlert({ type: 'success', message: 'Settings reset to defaults' });
    } catch (error) {
      console.warn('Backend not available, settings reset locally:', error);
      // Fall back to local reset
      resetSettings();
      setAlert({ type: 'success', message: 'Settings reset locally (server not available)' });
    }
  };

  if (isLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center">
          <Settings className="mr-2 h-6 w-6" />
          School Settings
        </h1>
        <div className="flex gap-2">
          <button
            onClick={handleResetSettings}
            className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
          >
            <RefreshCw size={16} />
            Reset to Defaults
          </button>
          <button
            onClick={handleSaveSettings}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>

      {alert && (
        <Alert
          type={alert.type}
          message={alert.message}
          onClose={() => setAlert(null)}
        />
      )}

      <div className="space-y-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Shield className="mr-2 h-5 w-5" />
            Runtime Connectivity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="font-semibold text-gray-900">API Mode</p>
              <p className="mt-1 text-gray-700">{diagnostics.apiMode}</p>
              <p className="mt-2 text-xs text-gray-500">Base: {diagnostics.apiBaseLabel}</p>
              <p className="mt-1 text-xs text-gray-500">Proxy Target: {diagnostics.proxyTargetLabel}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <p className="font-semibold text-gray-900">Supabase</p>
              <p className={`mt-1 ${diagnostics.supabaseConfigured ? 'text-green-700' : 'text-red-700'}`}>
                {diagnostics.supabaseConfigured ? 'Configured' : 'Missing env configuration'}
              </p>
              <p className="mt-2 text-xs text-gray-500">Host: {diagnostics.hostname || 'Unknown host'}</p>
            </div>
          </div>
          {diagnostics.warnings.length > 0 ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-900">Parity warnings</p>
              <ul className="mt-2 list-disc pl-5 text-sm text-amber-800">
                {diagnostics.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              Local/live connectivity envs healthy lag rahe hain.
            </div>
          )}
        </div>

        {/* School Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Building className="mr-2 h-5 w-5" />
            School Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                School Name *
              </label>
              <input
                type="text"
                value={settings.name}
                onChange={(e) => updateSettings({ name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter school name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Principal Name
              </label>
              <input
                type="text"
                value={settings.principal_name}
                onChange={(e) => updateSettings({ principal_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter principal name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Established Year
              </label>
              <input
                type="number"
                value={settings.established_year}
                onChange={(e) => updateSettings({ established_year: parseInt(e.target.value) })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                min="1900"
                max={new Date().getFullYear()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                type="url"
                value={settings.website}
                onChange={(e) => updateSettings({ website: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://www.school.edu"
              />
            </div>
          </div>
        </div>

        {/* Contact Information */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Mail className="mr-2 h-5 w-5" />
            Contact Information
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => updateSettings({ email: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="contact@school.edu"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={settings.phone}
                onChange={(e) => updateSettings({ phone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="+91-XXXXXXXXXX"
              />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Address
              </label>
              <textarea
                value={settings.address}
                onChange={(e) => updateSettings({ address: e.target.value })}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter complete school address"
              />
            </div>
          </div>
        </div>

        {/* System Preferences */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Shield className="mr-2 h-5 w-5" />
            System Preferences
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Timezone
              </label>
              <select
                value={settings.timezone}
                onChange={(e) => updateSettings({ timezone: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                <option value="Europe/London">Europe/London (GMT)</option>
                <option value="America/New_York">America/New_York (EST)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date Format
              </label>
              <select
                value={settings.date_format}
                onChange={(e) => updateSettings({ date_format: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Default Export Format
              </label>
              <select
                value={settings.export_format}
                onChange={(e) => updateSettings({ export_format: e.target.value as 'pdf' | 'excel' | 'both' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="pdf">PDF Only</option>
                <option value="excel">Excel Only</option>
                <option value="both">Both PDF and Excel</option>
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="auto_save"
                checked={settings.auto_save}
                onChange={(e) => updateSettings({ auto_save: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="auto_save" className="ml-2 text-sm text-gray-700">
                Enable auto-save for forms
              </label>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="conflict_detection"
                checked={settings.conflict_detection}
                onChange={(e) => updateSettings({ conflict_detection: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="conflict_detection" className="ml-2 text-sm text-gray-700">
                Enable timetable conflict detection
              </label>
            </div>
            <div className="flex items-center">
              <input
                type="checkbox"
                id="email_notifications"
                checked={settings.email_notifications}
                onChange={(e) => updateSettings({ email_notifications: e.target.checked })}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <label htmlFor="email_notifications" className="ml-2 text-sm text-gray-700">
                Enable email notifications (when implemented)
              </label>
            </div>
          </div>
        </div>

        {/* Batch Colors */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center">
            <Palette className="mr-2 h-5 w-5" />
            Batch Color Configuration
          </h2>
          <p className="text-sm text-gray-600 mb-4">
            Customize the colors used to represent different student batches in seating plans and visualizations.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(settings.default_batch_colors).map(([batch, color]) => (
              <div key={batch} className="flex items-center gap-3">
                <label className="text-sm font-medium text-gray-700 min-w-0 flex-1">
                  {batch}
                </label>
                <input
                  type="color"
                  value={color}
                  onChange={(e) => updateBatchColor(batch, e.target.value)}
                  className="w-12 h-8 border border-gray-300 rounded cursor-pointer"
                />
                <span className="text-xs text-gray-500 font-mono">{color}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Information Panel */}
        <div className="bg-blue-50 rounded-lg p-6">
          <h3 className="text-lg font-semibold text-blue-900 mb-2 flex items-center">
            <FileText className="mr-2 h-5 w-5" />
            Settings Information
          </h3>
          <ul className="text-sm text-blue-800 space-y-1">
            <li>• <strong>School Information:</strong> Basic details about your institution</li>
            <li>• <strong>Contact Details:</strong> Used in exported reports and communications</li>
            <li>• <strong>System Preferences:</strong> Regional settings and default behaviors</li>
            <li>• <strong>Batch Colors:</strong> Visual differentiation in seating plans and charts</li>
            <li>• <strong>Auto-save:</strong> Automatically saves form data as you type</li>
            <li>• <strong>Conflict Detection:</strong> Prevents scheduling overlaps in timetables</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
