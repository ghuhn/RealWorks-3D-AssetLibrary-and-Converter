import React from "react";
import { Folder, HardDrive, Cpu, Save } from "lucide-react";
import { toast } from "sonner";

export function Settings() {
  const handleSave = () => {
    toast.success("Settings saved successfully");
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
                <select className="bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 w-64">
                  <option>Dark (Default)</option>
                  <option>Light</option>
                  <option>System</option>
                </select>
              </div>
              <div className="grid grid-cols-[200px_1fr] gap-6 items-center">
                <label className="text-sm text-neutral-300">Default Category</label>
                <select className="bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 w-64">
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
                      defaultValue="D:\3D_Assets\Universal_Library"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
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
                      defaultValue="C:\Program Files\Blender Foundation\Blender 4.0\blender.exe"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">Required for advanced conversion tasks involving Blender scripts.</p>
                </div>
              </div>
              <div className="grid grid-cols-[200px_1fr] gap-6 items-start">
                <div className="pt-2 text-sm text-neutral-300">Blend File Path</div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="text" 
                      defaultValue="D:\Blend_files\3D_Assets"
                      className="flex-1 bg-[#111] border border-[#333] text-sm rounded px-3 py-2 text-neutral-200 focus:outline-none focus:border-blue-500 font-mono"
                    />
                    <button className="px-3 py-2 bg-[#2a2a2a] hover:bg-[#333] border border-[#333] rounded text-sm transition-colors text-neutral-300">
                      Browse
                    </button>
                  </div>
                  <p className="text-xs text-neutral-500">The root directory where all Blend files are saved.</p>
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
