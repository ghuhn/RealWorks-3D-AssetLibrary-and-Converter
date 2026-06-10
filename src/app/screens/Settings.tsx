import React, { useState, useEffect } from "react";
import { Folder, HardDrive, Cpu, Save, Key } from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface AppSettings {
  blender_path: string;
  library_path: string;
  debug_blend_path: string;
  gemini_api_key: string;
}

export function Settings() {
  const [settings, setSettings] = useState<AppSettings>({
    blender_path: '',
    library_path: '',
    debug_blend_path: '',
    gemini_api_key: ''
  });
  const [theme, setTheme] = useState("Dark (Default)");
  const [defaultCat, setDefaultCat] = useState("Uncategorized");

  useEffect(() => {
    invoke<AppSettings>('get_settings').then(s => setSettings(s)).catch(console.error);
  }, []);

  const handleSave = async () => {
    try {
      await invoke('save_settings', { settings });
      toast.success("Settings saved successfully");
    } catch (e) {
      console.error(e);
      toast.error("Failed to save settings");
    }
  };

  const browseFolder = async (key: keyof AppSettings) => {
    try {
      const selected = await open({ directory: true });
      if (selected) {
        setSettings({ ...settings, [key]: selected as string });
      }
    } catch (e) {
      console.error(e);
    }
  };

  const browseFile = async (key: keyof AppSettings) => {
    try {
      const selected = await open({ multiple: false });
      if (selected) {
        setSettings({ ...settings, [key]: selected as string });
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#1e1e1e] overflow-y-auto custom-scrollbar">
      <div className="h-14 border-b border-[#333] flex items-center justify-between px-6 shrink-0 bg-[#1e1e1e] sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-neutral-200">Settings</h1>
        <button 
          onClick={handleSave}
          className="flex items-center gap-2 px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
        >
          <Save className="w-4 h-4" /> Save Changes
        </button>
      </div>

      <div className="p-8 max-w-4xl">
        <div className="space-y-10">
          
          {/* General Section */}
          <section>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 border-b border-[#333] pb-2 flex items-center gap-2">
              <HardDrive className="w-4 h-4" /> General
            </h2>
            <div className="space-y-6">
              <div className="grid grid-cols-[200px_1fr] gap-6 items-center">
                <label className="text-sm text-neutral-300">Theme</label>
                <select 
                  value={theme}
                  onChange={e => setTheme(e.target.value)}
                  className="bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 w-64"
                >
                  <option>Dark (Default)</option>
                  <option>Light</option>
                  <option>System</option>
                </select>
              </div>
              <div className="grid grid-cols-[200px_1fr] gap-6 items-center">
                <label className="text-sm text-neutral-300">Default Category</label>
                <select 
                  value={defaultCat}
                  onChange={e => setDefaultCat(e.target.value)}
                  className="bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 w-64"
                >
                  <option>Uncategorized</option>
                  <option>Props</option>
                  <option>Furniture</option>
                </select>
              </div>
            </div>
          </section>

          {/* Library Section */}
          <section>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 border-b border-[#333] pb-2 flex items-center gap-2">
              <Folder className="w-4 h-4" /> Library
            </h2>
            <div className="space-y-6">
              <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
                <div className="pt-2 text-sm text-neutral-300">Library Path</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={settings.library_path}
                      onChange={e => setSettings({...settings, library_path: e.target.value})}
                      placeholder="D:\3D_Assets\Universal_Library"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button onClick={() => browseFolder('library_path')} className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">The root directory where all converted USD assets and metadata will be stored.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Blender Integration Section */}
          <section>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 border-b border-[#333] pb-2 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> External Tools
            </h2>
            <div className="space-y-6">
              <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
                <div className="pt-2 text-sm text-neutral-300">Blender Executable Path</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={settings.blender_path}
                      onChange={e => setSettings({...settings, blender_path: e.target.value})}
                      placeholder="C:\Program Files\Blender Foundation\Blender 4.0\blender.exe"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button onClick={() => browseFile('blender_path')} className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">Required for advanced conversion tasks involving Blender scripts.</p>
                </div>
              </div>
              <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
                <div className="pt-2 text-sm text-neutral-300">Debug Blend Save Path</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      value={settings.debug_blend_path}
                      onChange={e => setSettings({...settings, debug_blend_path: e.target.value})}
                      placeholder="D:\Blend_files\3D_Assets"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button onClick={() => browseFolder('debug_blend_path')} className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">The root directory where all Blend files are saved.</p>
                </div>
              </div>
              <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
                <div className="pt-2 text-sm text-neutral-300">Gemini API Key</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="password" 
                      value={settings.gemini_api_key}
                      onChange={e => setSettings({...settings, gemini_api_key: e.target.value})}
                      placeholder="AIzaSy..."
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>
                  <p className="text-xs text-neutral-500">Optional, used for AI texture mapping.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Output Section */}
          <section>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider mb-4 border-b border-[#333] pb-2 flex items-center gap-2">
              <Save className="w-4 h-4" /> Output Preferences
            </h2>
            <div className="space-y-4">
              
              <label className="flex items-center gap-3">
                <input type="checkbox" defaultChecked className="w-4 h-4 rounded border-[#333] bg-[#111] text-blue-500 focus:ring-blue-500/20" />
                <span className="text-sm text-neutral-300">Extract Textures to separate folder</span>
              </label>
              <label className="flex items-center gap-3">
                <input type="checkbox" className="w-4 h-4 rounded border-[#333] bg-[#111] text-blue-500 focus:ring-blue-500/20" />
                <span className="text-sm text-neutral-300">Compress USD files (.usdz)</span>
              </label>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
