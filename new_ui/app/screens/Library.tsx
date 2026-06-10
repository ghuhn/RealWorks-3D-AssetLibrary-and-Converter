import React, { useState, useEffect } from "react";
import { LayoutGrid, List as ListIcon, Info, FolderOpen, Calendar, Tag as TagIcon, FileType2 } from "lucide-react";
import { useAppContext, type Asset } from "../context/AppContext";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Library() {
  const { assets, searchQuery } = useAppContext();
  const libraryAssets = assets.filter(a => 
    a.status === "Library" && 
    (a.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
     a.category.toLowerCase().includes(searchQuery.toLowerCase()))
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);

  return (
    <div className="flex-1 flex overflow-hidden relative">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 border-b border-[#333] flex items-center justify-between px-4 shrink-0 bg-[#1e1e1e]">
          <div className="text-sm text-neutral-400">
            {libraryAssets.length} Assets
          </div>
          <div className="flex items-center gap-1 bg-[#111] p-1 rounded border border-[#333]">
            <button 
              onClick={() => setViewMode("grid")}
              className={cn("p-1.5 rounded transition-colors", viewMode === "grid" ? "bg-[#333] text-white" : "text-neutral-500 hover:text-neutral-300")}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setViewMode("list")}
              className={cn("p-1.5 rounded transition-colors", viewMode === "list" ? "bg-[#333] text-white" : "text-neutral-500 hover:text-neutral-300")}
            >
              <ListIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
          {viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
              {libraryAssets.map(asset => (
                <AssetCard 
                  key={asset.id} 
                  asset={asset} 
                  isSelected={selectedAsset?.id === asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  onDoubleClick={() => toast.info("Opening " + asset.name + " folder...")}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center px-4 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider border-b border-[#333] mb-2">
                <div className="w-10"></div>
                <div className="flex-1">Name</div>
                <div className="w-32">Category</div>
                <div className="w-24">Format</div>
              </div>
              {libraryAssets.map(asset => (
                <div 
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  onDoubleClick={() => toast.info("Opening " + asset.name + " folder...")}
                  className={cn(
                    "flex items-center px-4 py-2 rounded text-sm cursor-pointer border border-transparent transition-colors",
                    selectedAsset?.id === asset.id ? "bg-[#0066cc]/20 border-[#0066cc]" : "hover:bg-[#2a2a2a]"
                  )}
                >
                  <div className="w-10">
                    <img src={asset.thumbnail} alt={asset.name} className="w-6 h-6 object-cover rounded bg-[#111]" />
                  </div>
                  <div className="flex-1 truncate">{asset.name}</div>
                  <div className="w-32 text-neutral-400">{asset.category}</div>
                  <div className="w-24 text-neutral-500 font-mono text-xs">{asset.sourceFormat}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Details Panel */}
      <AnimatePresence>
        {selectedAsset && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-[#333] bg-[#1a1a1a] flex flex-col shrink-0 overflow-hidden"
          >
            <div className="w-[320px] h-full flex flex-col">
              <div className="h-12 border-b border-[#333] flex items-center justify-between px-4 shrink-0">
                <span className="font-semibold text-sm flex items-center gap-2">
                  <Info className="w-4 h-4 text-neutral-400" /> Details
                </span>
                <button 
                  onClick={() => setSelectedAsset(null)}
                  className="text-neutral-500 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6">
                <div className="aspect-video bg-[#111] rounded-lg border border-[#333] overflow-hidden relative group">
                  <img src={selectedAsset.thumbnail} alt={selectedAsset.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button 
                      onClick={() => toast.info("Opening folder...")}
                      className="flex items-center gap-2 bg-[#222] hover:bg-[#333] border border-[#444] px-3 py-1.5 rounded text-sm transition-colors"
                    >
                      <FolderOpen className="w-4 h-4" /> Open Folder
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-semibold truncate mb-4">{selectedAsset.name}</h2>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between py-1 border-b border-[#2a2a2a]">
                      <span className="text-neutral-500 flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Category</span>
                      <span className="text-neutral-200">{selectedAsset.category}</span>
                    </div>
                    
                    <div className="flex items-center justify-between py-1 border-b border-[#2a2a2a]">
                      <span className="text-neutral-500 flex items-center gap-2"><Calendar className="w-4 h-4" /> Added</span>
                      <span className="text-neutral-200">{new Date(selectedAsset.dateAdded).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <TagIcon className="w-3 h-3" /> Tags
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedAsset.tags.map(tag => (
                      <span key={tag} className="px-2 py-0.5 text-xs bg-[#2a2a2a] text-neutral-300 rounded border border-[#3d3d3d]">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Asset package</h3>
                  <div className="rounded p-2 font-sans text-xs text-neutral-300 overflow-x-auto select-none">
                    <details open className="group/root">
                      <summary className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 group-open/root:hidden"><path d="m9 18 6-6-6-6"/></svg>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 hidden group-open/root:block"><path d="m6 9 6 6 6-6"/></svg>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 fill-blue-400/20 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                        <span className="text-neutral-200 truncate">{selectedAsset.name}</span>
                      </summary>
                      
                      <div className="pl-4 ml-2.5 border-l border-[#333] flex flex-col mt-0.5 space-y-0.5">
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>
                          <span className="text-blue-400 truncate">asset.usd</span>
                        </div>
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400 shrink-0"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>
                          <span className="truncate">thumbnail.png</span>
                        </div>
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/></svg>
                          <span className="truncate">metadata.json</span>
                        </div>
                        
                        <details className="group/textures">
                          <summary className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 group-open/textures:hidden"><path d="m9 18 6-6-6-6"/></svg>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 hidden group-open/textures:block"><path d="m6 9 6 6 6-6"/></svg>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 fill-neutral-400/20 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>
                            <span className="truncate">textures</span>
                          </summary>
                          <div className="pl-4 ml-2.5 border-l border-[#333] flex flex-col mt-0.5 space-y-0.5">
                            <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default text-neutral-500 italic">
                              <div className="w-3.5 h-3.5 shrink-0" />
                              <div className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">floral_01.png</span>
                            </div>
                            <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default text-neutral-500 italic">
                              <div className="w-3.5 h-3.5 shrink-0" />
                              <div className="w-3.5 h-3.5 shrink-0" />
                              <span className="truncate">floral_02.png</span>
                            </div>
                  
                          </div>
                        </details>
                      </div>
                    </details>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 mt-2">Original Format</h3>
                  <div className="rounded p-2 font-sans text-xs text-neutral-300 overflow-x-auto select-none">
                    <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/></svg>
                      <span className="truncate text-neutral-200">
                        {selectedAsset.name}.{selectedAsset.sourceFormat.toLowerCase()}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssetCard({ asset, isSelected, onClick, onDoubleClick }: { asset: Asset, isSelected: boolean, onClick: () => void, onDoubleClick: () => void }) {
  const [isHovered, setIsHovered] = useState(false);
  let hoverTimeout: any;

  const handleMouseEnter = () => {
    hoverTimeout = setTimeout(() => setIsHovered(true), 1500); // 1.5s delay for preview
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout);
    setIsHovered(false);
  };

  return (
    <div 
      className={cn(
        "group relative flex flex-col rounded-md border bg-[#222] overflow-hidden cursor-pointer select-none transition-colors",
        isSelected ? "border-[#0066cc] ring-1 ring-[#0066cc]" : "border-[#333] hover:border-[#555]"
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="aspect-square bg-[#111] relative overflow-hidden">
        <img src={asset.thumbnail} alt={asset.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" draggable={false} />
        
        {/* Lightweight hover preview overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 bg-black/80 backdrop-blur p-2 text-xs flex flex-col gap-1 border-t border-white/10"
            >
              <div className="text-neutral-300 font-mono">{asset.sourceFormat}</div>
              <div className="flex flex-wrap gap-1">
                {asset.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] bg-white/10 px-1 rounded text-neutral-300">{tag}</span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="p-2 flex flex-col gap-0.5 border-t border-[#333]">
        <span className="text-sm font-medium truncate" title={asset.name}>{asset.name}</span>
        <span className="text-xs text-neutral-500 truncate">{asset.category}</span>
      </div>
    </div>
  );
}
