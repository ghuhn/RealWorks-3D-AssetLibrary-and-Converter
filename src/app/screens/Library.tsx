import React, { useState, useEffect, useRef } from "react";
import { LayoutGrid, List as ListIcon, Info, FolderOpen, Calendar, Tag as TagIcon, FileType2, Box, Trash2, Search, ChevronRight, FilterX, Plus, X, HardDrive, ArrowDownUp, ShieldAlert, CheckCircle2, Brain, Wrench, AlertTriangle } from "lucide-react";
import { useAppContext, type Asset } from "../context/AppContext";
import { getAllNamesForCategory } from "../components/Layout";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast } from "sonner";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { readDir } from "@tauri-apps/plugin-fs";
import { getCurrentWindow } from "@tauri-apps/api/window";

function formatBytes(bytes: number, decimals = 1) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function ThumbnailImage({ src, alt, className }: { src?: string, alt: string, className?: string }) {
  const [error, setError] = useState(false);

  if (!src || error) {
    return (
      <div className={cn("flex items-center justify-center bg-[#111] text-neutral-600", className)}>
        <Box className="w-1/2 h-1/2 opacity-50" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => setError(true)}
    />
  );
}

const getVisibleTagsCount = (tags: string[], maxWidth: number = 155) => {
  if (tags.length === 0) return 0;
  let currentWidth = 0;
  let lines = 1;
  let count = 0;

  for (let i = 0; i < tags.length; i++) {
    const tagWidth = Math.min(tags[i].length * 6 + 14, 60) + 4;
    if (currentWidth + tagWidth > maxWidth) {
      lines++;
      currentWidth = tagWidth;
      if (lines > 2) {
        break;
      }
    } else {
      currentWidth += tagWidth;
    }
    count++;
  }

  if (count < tags.length) {
    while (count > 0 && currentWidth + 50 > maxWidth && lines === 2) {
      const tagWidth = Math.min(tags[count - 1].length * 6 + 14, 60) + 4;
      currentWidth -= tagWidth;
      if (currentWidth < 0) {
        lines = 1;
        currentWidth = maxWidth;
      }
      count--;
    }
  }
  return count === 0 ? 1 : count;
};

export function Library() {
  const [sortBy, setSortBy] = useState<"recent" | "modified" | "all">("all");
  const { assets, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, selectedTags, setSelectedTags, deleteAsset, availableTags, addAvailableTag, updateAssetTags, importAssetByPath } = useAppContext();
  const libraryAssets = assets.filter(a => {
    if (a.status !== "Library") return false;

    if (sortBy === "recent") {
      const assetDate = new Date(a.dateAdded).getTime();
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      if (assetDate < threeDaysAgo) return false;
    }

    if (searchQuery) {
      const tokens = searchQuery.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
      
      const matchesAllTokens = tokens.every(token => {
        const inName = a.name.toLowerCase().includes(token);
        const inCategory = a.category.toLowerCase().includes(token);
        const inTags = a.tags.some(tag => tag.toLowerCase().includes(token));
        
        return inName || inCategory || inTags;
      });
      
      if (!matchesAllTokens) return false;
    }

    if (selectedCategory !== "All assets") {
      const allowedCategories = getAllNamesForCategory(selectedCategory);
      if (!allowedCategories.includes(a.category)) return false;
    }

    if (selectedTags.length > 0) {
      if (!selectedTags.every(t => a.tags.includes(t))) return false;
    }

    return true;
  }).sort((a, b) => {
    if (sortBy === "recent") {
      return new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime();
    } else if (sortBy === "modified") {
      return new Date(b.lastModified || b.dateAdded).getTime() - new Date(a.lastModified || a.dateAdded).getTime();
    }
    return 0;
  });
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ ids: string[]; label: string } | null>(null);
  const [openTagManagerId, setOpenTagManagerId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [textureFiles, setTextureFiles] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  
  const [isSortOpen, setIsSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(event.target as Node)) {
        setIsSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedAsset) {
      (async () => {
        try {
          const files: string[] = await invoke('get_texture_files', { category: selectedAsset.category, name: selectedAsset.name });
          setTextureFiles(files);
        } catch (e) {
          // Normal if textures folder does not exist
          setTextureFiles([]);
        }
      })();
    } else {
      setTextureFiles([]);
    }
  }, [selectedAsset]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setOpenTagManagerId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (selectedAsset) {
      const updated = assets.find(a => a.id === selectedAsset.id);
      if (updated && updated !== selectedAsset) {
        setSelectedAsset(updated);
      } else if (!updated) {
        setSelectedAsset(null);
      }
    }
  }, [assets, selectedAsset]);

  const middleWorkspaceRef = useRef<HTMLDivElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const SUPPORTED_EXTS = new Set(['fbx','obj','glb','gltf','blend','dae','stl','ply','usd','usda','usdz','max','dxf','igs','iges','stp','step','3ds']);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    getCurrentWindow().onDragDropEvent((event) => {
      const type = event.payload.type;
      if (type === 'enter' || type === 'over') {
        // Only activate if the cursor is over the drop zone element
        if (dropZoneRef.current) {
          const rect = dropZoneRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;
          const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          setIsDragOver(inside);
        }
      } else if (type === 'drop') {
        setIsDragOver(false);
        const paths: string[] = (event.payload as any).paths ?? [];
        if (dropZoneRef.current) {
          const rect = dropZoneRef.current.getBoundingClientRect();
          const { x, y } = event.payload.position;
          const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
          if (!inside) return;
        }
        paths.forEach(p => {
          const ext = p.split('.').pop()?.toLowerCase() ?? '';
          if (SUPPORTED_EXTS.has(ext)) {
            importAssetByPath(p);
          } else {
            const name = p.split('/').pop() ?? p;
            toast.error("Unsupported file", { description: `"${name}" is not a supported 3D asset format.` });
          }
        });
      } else if (type === 'leave') {
        setIsDragOver(false);
      }
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [importAssetByPath]);

  useEffect(() => {
    if (!middleWorkspaceRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.target.getBoundingClientRect();
        document.body.style.setProperty('--middle-workspace-width', `${rect.width}px`);
        document.body.style.setProperty('--middle-workspace-left', `${rect.left}px`);
      }
    });
    observer.observe(middleWorkspaceRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex-1 flex overflow-hidden relative min-h-0">
      <div id="middle-workspace" ref={middleWorkspaceRef} className="flex-1 flex flex-col min-w-0 min-h-0">
        <div className="h-14 border-b border-[#333] flex items-center justify-between px-4 shrink-0 bg-[#1e1e1e]">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <span>Categories</span>
            <ChevronRight className="w-4 h-4 text-neutral-600" />
            <span className="text-neutral-200 font-medium">{selectedCategory}</span>
            <span className="text-neutral-500 ml-1">({libraryAssets.length})</span>
          </div>

          <div className="flex items-center gap-4">
            {(searchQuery || selectedTags.length > 0 || sortBy !== "all") && (
              <button
                onClick={() => {
                  setSearchQuery("");
                  setSelectedTags([]);
                  setSortBy("all");
                }}
                className="flex items-center gap-2 px-2.5 py-1.5 text-sm bg-[#111] border border-[#333] text-neutral-400 hover:text-white hover:bg-[#222] hover:border-[#444] rounded transition-all"
                title="Clear all filters"
              >
                <FilterX className="w-4 h-4" />
                <span>Clear all</span>
              </button>
            )}
            <div className="relative group">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 group-focus-within:text-blue-400 transition-colors" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search assets..."
                className="w-64 bg-[#111] border border-[#333] rounded pl-9 pr-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-all placeholder:text-neutral-600"
              />
            </div>
            <div className="relative group flex items-center justify-center" ref={sortRef}>
              <button 
                onClick={() => setIsSortOpen(!isSortOpen)}
                className="p-1.5 rounded text-neutral-400 hover:text-white hover:bg-[#222] transition-colors" 
                title="Sort assets"
              >
                <ArrowDownUp className="w-4 h-4" />
              </button>
              
              <AnimatePresence>
                {isSortOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -5, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -5, scale: 0.95 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 top-full mt-1 w-48 bg-[#1a1a1a] border border-[#333] rounded shadow-xl z-20 py-1 overflow-hidden"
                  >
                    <button
                      onClick={() => { setSortBy("all"); setIsSortOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[#333]",
                        sortBy === "all" ? "text-[#0066cc] font-medium bg-[#0066cc]/10" : "text-neutral-300"
                      )}
                    >
                      All time
                    </button>
                    <button
                      onClick={() => { setSortBy("recent"); setIsSortOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[#333]",
                        sortBy === "recent" ? "text-[#0066cc] font-medium bg-[#0066cc]/10" : "text-neutral-300"
                      )}
                    >
                      Recently added
                    </button>
                    <button
                      onClick={() => { setSortBy("modified"); setIsSortOpen(false); }}
                      className={cn(
                        "w-full text-left px-4 py-2 text-sm transition-colors hover:bg-[#333]",
                        sortBy === "modified" ? "text-[#0066cc] font-medium bg-[#0066cc]/10" : "text-neutral-300"
                      )}
                    >
                      Recently modified
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
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
        </div>

        <div
          ref={dropZoneRef}
          className="flex-1 overflow-y-auto p-4 scrollbar-hide outline-none relative"
          tabIndex={0}
        >
          {isDragOver && (
            <div className="absolute inset-0 z-20 pointer-events-none rounded-lg border-2 border-dashed border-blue-500 bg-blue-500/5 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-blue-400">
                <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span className="text-sm font-medium">Drop to import</span>
              </div>
            </div>
          )}
          {viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4">
              {libraryAssets.map(asset => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  isSelected={selectedAsset?.id === asset.id}
                  onClick={() => setSelectedAsset(selectedAsset?.id === asset.id ? null : asset)}
                  onDoubleClick={() => toast.info("Opening Folder", { description: "Opening " + asset.name + " folder..." })}
                  onDelete={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({ ids: [asset.id], label: asset.name });
                  }}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-5 px-4 py-2 text-xs font-semibold text-neutral-500 uppercase tracking-wider border-b border-[#333] mb-2">
                <div className="w-8 flex items-center justify-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 shrink-0 cursor-pointer appearance-none border border-[#444] rounded hover:border-[#666] checked:bg-[#0066cc] checked:border-[#0066cc] flex items-center justify-center after:content-[''] after:hidden checked:after:block after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:-translate-y-[2px] transition-all"
                    checked={libraryAssets.length > 0 && libraryAssets.every(a => selectedForDelete.includes(a.id))}
                    onChange={(e) => {
                      if (e.target.checked) {
                        const newIds = new Set(selectedForDelete);
                        libraryAssets.forEach(a => newIds.add(a.id));
                        setSelectedForDelete(Array.from(newIds));
                      } else {
                        const currentIds = libraryAssets.map(a => a.id);
                        setSelectedForDelete(prev => prev.filter(id => !currentIds.includes(id)));
                      }
                    }}
                  />
                </div>
                <div className="w-8"></div>
                <div className="w-32">Name</div>
                <div className="w-32">Category</div>
                <div className="w-24">Size</div>
                <div className="w-32">Added on</div>
                <div className="w-48">Tags</div>
                <div className="flex-1 flex justify-end pr-2">
                  {selectedForDelete.length > 0 && (
                    <button
                      onClick={() => {
                        setDeleteTarget({ ids: [...selectedForDelete], label: `${selectedForDelete.length} assets` });
                      }}
                      className="text-red-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                      title="Delete Selected"
                    >
                      <Trash2 className="w-4 h-4" /> <span className="capitalize normal-case">Delete</span>
                    </button>
                  )}
                </div>
              </div>
              {libraryAssets.map(asset => (
                <motion.div
                  layout
                  key={asset.id}
                  onClick={() => setSelectedAsset(selectedAsset?.id === asset.id ? null : asset)}
                  onDoubleClick={() => toast.info("Opening Folder", { description: "Opening " + asset.name + " folder..." })}
                  className={cn(
                    "flex items-center gap-5 px-4 py-2 rounded text-sm cursor-pointer border border-transparent transition-colors group",
                    selectedAsset?.id === asset.id ? "bg-[#0066cc]/20 border-[#0066cc]" : "hover:bg-[#2a2a2a]",
                    selectedForDelete.includes(asset.id) && "bg-[#333]/40"
                  )}
                >
                  <div className="w-8 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="w-4 h-4 shrink-0 cursor-pointer appearance-none border border-[#444] rounded hover:border-[#666] checked:bg-[#0066cc] checked:border-[#0066cc] flex items-center justify-center after:content-[''] after:hidden checked:after:block after:w-1.5 after:h-2.5 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:-translate-y-[2px] transition-all"
                      checked={selectedForDelete.includes(asset.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedForDelete(prev => [...prev, asset.id]);
                        } else {
                          setSelectedForDelete(prev => prev.filter(id => id !== asset.id));
                        }
                      }}
                    />
                  </div>
                  <div className="w-8 flex-shrink-0">
                    <ThumbnailImage src={asset.thumbnail} alt={asset.name} className="w-6 h-6 object-cover rounded bg-[#111]" />
                  </div>
                  <div className="w-32 line-clamp-2 break-words" title={asset.name}>{asset.name}</div>
                  <div className="w-32 text-neutral-400 line-clamp-2 break-words">{asset.category}</div>
                  <div className="w-24 text-neutral-400">{asset.sizeBytes ? formatBytes(asset.sizeBytes) : "Unknown size"}</div>
                  <div className="w-32 text-neutral-400">{new Date(asset.dateAdded).toLocaleDateString()}</div>
                  <div className="w-48">
                    <AssetTagsManager
                      asset={asset}
                      readOnly={true}
                    />
                  </div>
                  <div className="flex-1 flex justify-end pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteTarget({ ids: [asset.id], label: asset.name });
                      }}
                      className="text-neutral-500 hover:text-red-500 transition-colors"
                      title="Delete Asset"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </motion.div>
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
            animate={{ width: 400, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
            className="border-l border-[#333] bg-[#1a1a1a] flex flex-col shrink-0 overflow-hidden min-h-0"
          >
            <div className="w-[400px] h-full flex flex-col min-h-0">
              <div className="h-14 border-b border-[#333] flex items-center justify-between px-4 shrink-0">
                <span className="font-semibold text-sm flex items-center gap-2">
                  Asset details
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setDeleteTarget({ ids: [selectedAsset.id], label: selectedAsset.name });
                    }}
                    className="text-red-500 transition-colors"
                    title="Delete Asset"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <div className="w-px h-4 bg-[#333] mx-1"></div>
                  <button
                    onClick={() => setSelectedAsset(null)}
                    className="text-neutral-500 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 scrollbar-hide space-y-6 outline-none" tabIndex={0}>
                <div className="aspect-square bg-[#111] rounded-lg border border-[#333] overflow-hidden relative group">
                  <ThumbnailImage src={selectedAsset.thumbnail} alt={selectedAsset.name} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <button
                      onClick={async () => {
                        try {
                          const settings: any = await invoke('get_settings');
                          const folderPath = await join(settings.library_path, selectedAsset.category, selectedAsset.name);
                          await invoke('open_folder', { path: folderPath });
                        } catch (e) {
                          console.error(e);
                          toast.error("Open Failed", { description: "Failed to open folder" });
                        }
                      }}
                      className="flex items-center gap-2 bg-[#222] hover:bg-[#333] border border-[#444] px-3 py-1.5 rounded text-sm transition-colors"
                    >
                      <FolderOpen className="w-4 h-4" /> Open Folder
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-lg font-semibold truncate mb-4" title={selectedAsset.name}>{selectedAsset.name}</h2>

                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between py-1 border-b border-[#2a2a2a]">
                      <span className="text-neutral-500 flex items-center gap-2"><FolderOpen className="w-4 h-4" /> Category</span>
                      <span className="text-neutral-200">{selectedAsset.category}</span>
                    </div>

                    <div className="flex items-center justify-between py-1 border-b border-[#2a2a2a]">
                      <span className="text-neutral-500 flex items-center gap-2"><HardDrive className="w-4 h-4" /> Size</span>
                      <span className="text-neutral-200">{selectedAsset.sizeBytes ? formatBytes(selectedAsset.sizeBytes) : "Unknown size"}</span>
                    </div>

                    <div className="flex items-center justify-between py-1 border-b border-[#2a2a2a]">
                      <span className="text-neutral-500 flex items-center gap-2"><Calendar className="w-4 h-4" /> Added on</span>
                      <span className="text-neutral-200">{new Date(selectedAsset.dateAdded).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Asset package</h3>
                  <div className="rounded p-2 font-sans text-xs text-neutral-300 overflow-x-auto select-none">
                    <details open className="group/root">
                      <summary className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 group-open/root:hidden"><path d="m9 18 6-6-6-6" /></svg>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 hidden group-open/root:block"><path d="m6 9 6 6 6-6" /></svg>
                        </div>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 fill-blue-400/20 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
                        <span className="text-neutral-200 truncate" title={selectedAsset.name}>{selectedAsset.name}</span>
                      </summary>

                      <div className="pl-4 ml-2.5 border-l border-[#333] flex flex-col mt-0.5 space-y-0.5">
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m10 13-2 2 2 2" /><path d="m14 17 2-2-2-2" /></svg>
                          <span className="text-blue-400 truncate" title="asset.usd">asset.usd</span>
                        </div>
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-purple-400 shrink-0"><rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" /></svg>
                          <span className="truncate" title="thumbnail.png">thumbnail.png</span>
                        </div>
                        <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                          <div className="w-3.5 h-3.5 shrink-0" />
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-yellow-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1" /><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1" /></svg>
                          <span className="truncate" title="metadata.json">metadata.json</span>
                        </div>

                        <details className="group/textures">
                          <summary className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                            <div className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 group-open/textures:hidden"><path d="m9 18 6-6-6-6" /></svg>
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-500 hidden group-open/textures:block"><path d="m6 9 6 6 6-6" /></svg>
                            </div>
                            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 fill-neutral-400/20 shrink-0"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>
                            <span className="truncate" title="textures">textures</span>
                          </summary>
                          <div className="pl-4 ml-2.5 border-l border-[#333] flex flex-col mt-0.5 space-y-0.5">
                            {textureFiles.length > 0 ? (
                              textureFiles.map(file => (
                                <div key={file} className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default text-neutral-500 italic">
                                  <div className="w-3.5 h-3.5 shrink-0" />
                                  <div className="w-3.5 h-3.5 shrink-0" />
                                  <span className="truncate" title={file}>{file}</span>
                                </div>
                              ))
                            ) : (
                              <div className="px-1 py-0.5 text-xs text-neutral-600 italic">No textures found</div>
                            )}
                          </div>
                        </details>
                      </div>
                    </details>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <TagIcon className="w-3 h-3" /> Tags
                  </h3>
                  <AssetTagsManager
                    asset={selectedAsset}
                    readOnly={true}
                    maxWidth={250}
                  />
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Brain className="w-3 h-3" /> Spatial Profile
                  </h3>
                  <AssetProfile asset={selectedAsset} />
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Wrench className="w-3 h-3" /> Material Sanitizations
                  </h3>
                  <MaterialSanitizations asset={selectedAsset} />
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 flex items-center gap-2">
                    <Wrench className="w-3 h-3" /> Material Anomalies
                  </h3>
                  <MaterialAnomalies asset={selectedAsset} />
                </div>

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 mt-2">Original Format</h3>
                  <div className="rounded p-2 font-sans text-xs text-neutral-300 overflow-x-auto select-none">
                    <div className="flex items-center gap-1.5 hover:bg-[#2a2a2a] px-1 py-0.5 rounded cursor-default">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neutral-400 shrink-0"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="m10 13-2 2 2 2" /><path d="m14 17 2-2-2-2" /></svg>
                      <span className="truncate text-neutral-200" title={`${selectedAsset.name}.${selectedAsset.sourceFormat.toLowerCase()}`}>
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

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {deleteTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setDeleteTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "tween", duration: 0.15 }}
              className="bg-[#1e1e1e] border border-[#333] rounded-lg shadow-2xl w-80 p-5 flex flex-col gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
                  <Trash2 className="w-4 h-4 text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">Delete asset{deleteTarget.ids.length > 1 ? "s" : ""}?</p>
                  <p className="text-xs text-neutral-400 mt-1">
                    <span className="text-neutral-200">"{deleteTarget.label}"</span> will be permanently removed.
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setDeleteTarget(null)}
                  className="px-3 py-1.5 text-xs rounded border border-[#444] text-neutral-300 hover:bg-[#2a2a2a] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    deleteTarget.ids.forEach(id => deleteAsset(id));
                    if (selectedAsset && deleteTarget.ids.includes(selectedAsset.id)) setSelectedAsset(null);
                    setSelectedForDelete(prev => prev.filter(id => !deleteTarget.ids.includes(id)));
                    setDeleteTarget(null);
                  }}
                  className="px-3 py-1.5 text-xs rounded bg-red-600 hover:bg-red-500 text-white transition-colors"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AssetCard({ asset, isSelected, onClick, onDoubleClick, onDelete }: { asset: Asset, isSelected: boolean, onClick: () => void, onDoubleClick: () => void, onDelete: (e: React.MouseEvent) => void }) {
  const [isHovered, setIsHovered] = useState(false);
  let hoverTimeout: any;

  const handleMouseEnter = () => {
    hoverTimeout = setTimeout(() => setIsHovered(true), 250); // 1.5s delay for preview
  };

  const handleMouseLeave = () => {
    clearTimeout(hoverTimeout);
    setIsHovered(false);
  };

  return (
    <motion.div
      layout
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
        <ThumbnailImage src={asset.thumbnail} alt={asset.name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />

        <button
          onClick={onDelete}
          className="absolute top-2 right-2 p-1.5 bg-black/60 text-white bg-red-500 rounded opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 backdrop-blur-sm"
          title="Delete Asset"
        >
          <Trash2 className="w-4 h-4" />
        </button>

        {asset.needsReview && (
          <div className="absolute top-2 left-2 flex items-center gap-1 bg-amber-500/90 text-black text-[10px] font-semibold px-1.5 py-0.5 rounded z-10">
            <ShieldAlert className="w-2.5 h-2.5" /> Review
          </div>
        )}

        {/* Lightweight hover preview overlay */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="absolute inset-x-0 bottom-0 bg-black/80 backdrop-blur p-2 text-xs flex flex-col gap-1 border-t border-white/10"
            >
              <span className="text-sm font-medium truncate" title={asset.name}>{asset.name}</span>
              <span className="text-xs text-neutral-500 truncate">{asset.category}</span>
              <div className="flex flex-wrap gap-1">
                {asset.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] bg-white/10 px-1 rounded text-neutral-300">{tag}</span>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

const PROFILE_SECTIONS = ["identity","geometry","orientation","placement","style","clearance","material","room","qa"] as const;
type ProfileSection = typeof PROFILE_SECTIONS[number];

const SECTION_LABELS: Record<ProfileSection, string> = {
  identity:    "Identity",
  geometry:    "Geometry",
  orientation: "Orientation",
  placement:   "Placement",
  style:       "Style",
  clearance:   "Clearance",
  material:    "Material",
  room:        "Room",
  qa:          "QA Rules",
};

function ProfileSectionSummary({ section, data }: { section: ProfileSection; data: any }) {
  switch (section) {
    case "identity":
      return <span>{data.category}{data.subcategory ? ` › ${data.subcategory}` : ""}</span>;
    case "geometry":
      return <span>{data.width_mm}×{data.depth_mm}×{data.height_mm} mm · {data.polycount?.toLocaleString()} polys</span>;
    case "orientation":
      return <span>Up {data.up_axis} · Front {data.forward_axis}</span>;
    case "placement":
      return <span>{data.surface} · {String(data.snap_mode ?? "").replace(/_/g, " ")}</span>;
    case "style":
      return <span>{data.primary_style} · {data.material_finish}</span>;
    case "clearance":
      return <span>{data.is_human_usable ? "Human usable" : "Decorative"}{data.min_clearance_front_mm ? ` · ${data.min_clearance_front_mm}mm front` : ""}</span>;
    case "material":
      return <span>{data.primary_material}{data.can_be_recoloured ? " · recolourable" : ""}</span>;
    case "room":
      return <span>{(data.appropriate_rooms ?? []).slice(0, 3).join(", ")}</span>;
    case "qa": {
      const flags: string[] = [];
      if (data.must_touch_floor)  flags.push("touches floor");
      if (data.must_face_target)  flags.push("faces target");
      if (data.must_not_intersect) flags.push("no intersect");
      return <span>{flags.length ? flags.join(" · ") : "Standard rules"}</span>;
    }
    default: return null;
  }
}

function AssetProfile({ asset }: { asset: Asset }) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editingSection, setEditingSection] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, any>>({});

  useEffect(() => {
    setLoading(true);
    setProfile(null);
    setEditingSection(null);
    invoke<any>("get_asset_profile", { category: asset.category, name: asset.name })
      .then(p => setProfile(p))
      .catch(() => setProfile(null))
      .finally(() => setLoading(false));
  }, [asset.id]);

  const SKIP_FIELDS = new Set(["confidence", "needs_review"]);

  const saveSection = async (section: string, data: Record<string, any>, markReviewed: boolean) => {
    if (!profile) return;
    const updatedSection = { ...profile[section], ...data, ...(markReviewed ? { needs_review: false } : {}) };
    const updated = { ...profile, [section]: updatedSection };
    const remaining = PROFILE_SECTIONS.filter(s => s !== "geometry" && updated[s]?.needs_review);
    updated.needs_review  = remaining.length > 0;
    updated.review_fields = remaining;
    setProfile(updated);
    setEditingSection(null);
    try {
      await invoke("save_asset_profile", { category: asset.category, name: asset.name, profile: updated });
      toast.success(`${SECTION_LABELS[section as ProfileSection] ?? section} ${markReviewed ? "confirmed" : "saved"}`);
    } catch {
      toast.error("Failed to save profile");
    }
  };

  const startEdit = (section: string, sec: any) => {
    const draft: Record<string, any> = {};
    for (const [k, v] of Object.entries(sec)) {
      if (!SKIP_FIELDS.has(k)) draft[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
    }
    setEditDraft(draft);
    setEditingSection(section);
  };

  const commitEdit = (section: string, markReviewed: boolean) => {
    const parsed: Record<string, any> = {};
    const original = profile[section];
    for (const [k, v] of Object.entries(editDraft)) {
      const orig = original[k];
      if (typeof orig === "boolean") parsed[k] = v === "true";
      else if (typeof orig === "number") parsed[k] = Number(v);
      else if (Array.isArray(orig)) parsed[k] = String(v).split(",").map((s: string) => s.trim()).filter(Boolean);
      else parsed[k] = v;
    }
    saveSection(section, parsed, markReviewed);
  };

  if (loading) return <p className="text-xs text-neutral-600 italic">Loading profile…</p>;

  if (!profile) return (
    <p className="text-xs text-neutral-600 italic">
      No spatial profile yet. Profiles are generated automatically during conversion when an AI provider is configured.
    </p>
  );

  const overallPct = Math.round((profile.overall_confidence ?? 0) * 100);
  const reviewCount = (profile.review_fields ?? []).length;

  return (
    <div className="space-y-2">
      {/* Overall confidence bar */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex-1 bg-[#111] rounded-full h-1.5 overflow-hidden">
          <div
            className={cn(
              "h-1.5 rounded-full transition-all",
              overallPct >= 80 ? "bg-green-500" : overallPct >= 60 ? "bg-amber-400" : "bg-red-500"
            )}
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <span className="text-xs text-neutral-400 shrink-0">{overallPct}%</span>
        {profile.needs_review && (
          <span className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded shrink-0">
            {reviewCount} to review
          </span>
        )}
      </div>

      {/* Section rows */}
      {PROFILE_SECTIONS.map(section => {
        const sec = profile[section];
        if (!sec || typeof sec !== "object") return null;
        const conf      = typeof sec.confidence === "number" ? sec.confidence : 1;
        const flagged   = sec.needs_review === true;
        const confPct   = Math.round(conf * 100);
        const isGeometry = section === "geometry";

        const isEditing = editingSection === section;

        return (
          <div
            key={section}
            className={cn(
              "rounded p-2.5 text-xs border transition-colors",
              flagged ? "border-amber-500/40 bg-amber-500/5" : "border-[#2a2a2a] bg-[#111]"
            )}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-1 gap-2">
              <span className={cn("font-medium", flagged ? "text-amber-400" : "text-neutral-300")}>
                {SECTION_LABELS[section]}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {isGeometry ? (
                  <CheckCircle2 className="w-3 h-3 text-green-500" />
                ) : (
                  <span className="text-neutral-600">{confPct}%</span>
                )}
                {!isGeometry && !isEditing && (
                  <button
                    onClick={() => startEdit(section, sec)}
                    className="text-[10px] text-neutral-400 hover:text-white border border-[#444] hover:border-[#666] px-1.5 py-0.5 rounded transition-colors"
                  >
                    Edit
                  </button>
                )}
                {flagged && !isEditing && (
                  <button
                    onClick={() => saveSection(section, {}, true)}
                    className="text-[10px] text-amber-400 hover:text-white border border-amber-500/40 hover:border-amber-400 px-1.5 py-0.5 rounded transition-colors"
                  >
                    Confirm
                  </button>
                )}
              </div>
            </div>

            {/* Inline editor */}
            {isEditing ? (
              <div className="mt-2 space-y-1.5">
                {Object.entries(editDraft).map(([k, v]) => (
                  <div key={k} className="flex items-start gap-2">
                    <span className="text-neutral-600 w-28 shrink-0 pt-0.5 capitalize">{k.replace(/_/g, " ")}</span>
                    <input
                      type="text"
                      value={v as string}
                      onChange={e => setEditDraft(prev => ({ ...prev, [k]: e.target.value }))}
                      className="flex-1 bg-[#1a1a1a] border border-[#444] focus:border-blue-500 rounded px-1.5 py-0.5 text-[10px] text-neutral-200 outline-none transition-colors min-w-0"
                    />
                  </div>
                ))}
                <div className="flex gap-1.5 pt-1">
                  <button
                    onClick={() => commitEdit(section, false)}
                    className="text-[10px] bg-[#2a2a2a] hover:bg-[#333] border border-[#444] text-neutral-200 px-2 py-0.5 rounded transition-colors"
                  >
                    Save
                  </button>
                  {flagged && (
                    <button
                      onClick={() => commitEdit(section, true)}
                      className="text-[10px] bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-400 px-2 py-0.5 rounded transition-colors"
                    >
                      Save & Confirm
                    </button>
                  )}
                  <button
                    onClick={() => setEditingSection(null)}
                    className="text-[10px] text-neutral-500 hover:text-neutral-300 px-1.5 py-0.5 rounded transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-neutral-500 truncate">
                  <ProfileSectionSummary section={section} data={sec} />
                </div>

                {/* Anchors / Relations sub-list */}
                {section === "placement" && Array.isArray(profile.anchors) && profile.anchors.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[#222] space-y-0.5">
                    <span className="text-neutral-600 text-[10px] uppercase tracking-wide">Anchors</span>
                    {profile.anchors.map((a: any, i: number) => (
                      <div key={i} className="text-neutral-600 truncate">{a.name} — {a.description}</div>
                    ))}
                  </div>
                )}
                {section === "room" && Array.isArray(profile.relations) && profile.relations.length > 0 && (
                  <div className="mt-1.5 pt-1.5 border-t border-[#222] space-y-0.5">
                    <span className="text-neutral-600 text-[10px] uppercase tracking-wide">Relations</span>
                    {profile.relations.map((r: any, i: number) => (
                      <div key={i} className="text-neutral-600 truncate">{r.relation} {r.target} ({r.strength})</div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface Anomaly {
  material: string;
  property: string;
  current_value: number | number[];
  issue: string;
  suggested_fix: number | number[];
}

function MaterialAnomalies({ asset }: { asset: Asset }) {
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [loading, setLoading]     = useState(true);
  const [fixValues, setFixValues] = useState<Record<string, string>>({});
  const [applying, setApplying]   = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    invoke<Anomaly[]>("get_material_anomalies", { category: asset.category, name: asset.name })
      .then(a => {
        setAnomalies(a);
        const defaults: Record<string, string> = {};
        a.forEach(an => {
          const k = `${an.material}::${an.property}`;
          const fix = an.suggested_fix;
          defaults[k] = Array.isArray(fix)
            ? fix.map((v: number) => v.toFixed(3)).join(", ")
            : String(fix);
        });
        setFixValues(defaults);
      })
      .catch(() => setAnomalies([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [asset.id]);

  const applyFix = async (anomaly: Anomaly) => {
    const k = `${anomaly.material}::${anomaly.property}`;
    const raw = fixValues[k] ?? "";
    let value: number | number[];
    const parts = raw.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
    if (parts.length === 3) value = parts;
    else if (parts.length === 1) value = parts[0];
    else { toast.error("Invalid value"); return; }

    setApplying(prev => ({ ...prev, [k]: true }));
    try {
      await invoke("apply_material_fixes", {
        category: asset.category,
        name: asset.name,
        patches: [{ material: anomaly.material, property: anomaly.property, value }],
      });
      toast.success("Fix applied", { description: `${anomaly.material} · ${anomaly.property} → ${raw}` });
      load();
    } catch (e: any) {
      toast.error("Fix failed", { description: String(e) });
    } finally {
      setApplying(prev => ({ ...prev, [k]: false }));
    }
  };

  const applyAll = async () => {
    const patches = anomalies.map(an => {
      const k = `${an.material}::${an.property}`;
      const raw = fixValues[k] ?? "";
      const parts = raw.split(",").map(s => parseFloat(s.trim())).filter(n => !isNaN(n));
      const value: number | number[] = parts.length === 3 ? parts : parts[0] ?? an.suggested_fix;
      return { material: an.material, property: an.property, value };
    });
    try {
      await invoke("apply_material_fixes", { category: asset.category, name: asset.name, patches });
      toast.success("All fixes applied");
      load();
    } catch (e: any) {
      toast.error("Apply all failed", { description: String(e) });
    }
  };

  if (loading) return <p className="text-xs text-neutral-600 italic">Scanning materials…</p>;

  if (anomalies.length === 0) return (
    <p className="text-xs text-neutral-600 italic flex items-center gap-1.5">
      <CheckCircle2 className="w-3 h-3 text-green-500" /> No material anomalies detected.
    </p>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-amber-400 flex items-center gap-1">
          <AlertTriangle className="w-3 h-3" /> {anomalies.length} anomal{anomalies.length === 1 ? "y" : "ies"} found
        </span>
        <button
          onClick={applyAll}
          className="text-[10px] px-2 py-0.5 bg-blue-600/20 border border-blue-500/40 text-blue-400 hover:bg-blue-600/30 rounded transition-colors"
        >
          Fix all
        </button>
      </div>

      {anomalies.map(an => {
        const k = `${an.material}::${an.property}`;
        const busy = applying[k] ?? false;
        const curStr = Array.isArray(an.current_value)
          ? an.current_value.map((v: number) => v.toFixed(3)).join(", ")
          : String(an.current_value);

        return (
          <div key={k} className="rounded border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-amber-400 font-medium truncate">{an.property}</span>
              <span className="text-neutral-600 text-[10px] shrink-0 truncate max-w-[120px]" title={an.material}>{an.material}</span>
            </div>

            <p className="text-neutral-400 leading-snug">{an.issue}</p>

            <div className="flex items-center gap-1.5">
              <span className="text-neutral-600 text-[10px] shrink-0">was {curStr} → </span>
              <input
                type="text"
                value={fixValues[k] ?? ""}
                onChange={e => setFixValues(prev => ({ ...prev, [k]: e.target.value }))}
                className="flex-1 min-w-0 bg-[#111] border border-[#333] rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-blue-500"
                placeholder="new value"
              />
              <button
                onClick={() => applyFix(an)}
                disabled={busy}
                className="shrink-0 px-2 py-0.5 text-[10px] bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded transition-colors"
              >
                {busy ? "…" : "Apply"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface Sanitization {
  material: string;
  property: string;
  original_value: number | number[];
  sanitized_value: number | number[];
  reason: string;
}

function MaterialSanitizations({ asset }: { asset: Asset }) {
  const [sanitizations, setSanitizations] = useState<Sanitization[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = () => {
    setLoading(true);
    invoke<Sanitization[]>("get_material_sanitizations", { category: asset.category, name: asset.name })
      .then(s => setSanitizations(s))
      .catch(() => setSanitizations([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [asset.id]);

  const fmt = (v: number | number[]) =>
    Array.isArray(v) ? v.map(x => x.toFixed(3)).join(", ") : String(v);

  const revert = async (s: Sanitization) => {
    const k = `${s.material}::${s.property}`;
    setBusy(prev => ({ ...prev, [k]: true }));
    try {
      await invoke("revert_material_sanitization", {
        category: asset.category,
        name: asset.name,
        patches: [{ material: s.material, property: s.property, value: s.original_value }],
      });
      toast.success("Reverted", { description: `${s.material} · ${s.property} → ${fmt(s.original_value)}` });
      load();
    } catch (e: any) {
      toast.error("Revert failed", { description: String(e) });
    } finally {
      setBusy(prev => ({ ...prev, [k]: false }));
    }
  };

  const accept = async (keys: { material: string; property: string }[]) => {
    try {
      await invoke("accept_material_sanitizations", { category: asset.category, name: asset.name, keys });
      toast.success(keys.length === 0 ? "All corrections accepted" : "Correction accepted");
      load();
    } catch (e: any) {
      toast.error("Accept failed", { description: String(e) });
    }
  };

  if (loading) return <p className="text-xs text-neutral-600 italic">Checking sanitizations…</p>;

  if (sanitizations.length === 0) return (
    <p className="text-xs text-neutral-600 italic flex items-center gap-1.5">
      <CheckCircle2 className="w-3 h-3 text-green-500" /> No auto-corrections applied.
    </p>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-blue-400 flex items-center gap-1">
          <Info className="w-3 h-3" /> {sanitizations.length} value{sanitizations.length > 1 ? 's' : ''} auto-corrected
        </span>
        <button
          onClick={() => accept([])}
          className="text-[10px] px-2 py-0.5 bg-[#2a2a2a] border border-[#444] text-neutral-400 hover:text-white rounded transition-colors"
        >
          Accept all
        </button>
      </div>

      {sanitizations.map(s => {
        const k = `${s.material}::${s.property}`;
        return (
          <div key={k} className="rounded border border-blue-500/30 bg-blue-500/5 p-2.5 text-xs space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-blue-400 font-medium truncate">{s.property}</span>
              <span className="text-neutral-600 text-[10px] shrink-0 truncate max-w-[120px]" title={s.material}>{s.material}</span>
            </div>
            <p className="text-neutral-400 leading-snug">{s.reason}</p>
            <div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
              <span>{fmt(s.original_value)}</span>
              <span className="text-neutral-600">→</span>
              <span className="text-neutral-300">{fmt(s.sanitized_value)}</span>
            </div>
            <div className="flex gap-1.5 pt-0.5">
              <button
                onClick={() => revert(s)}
                disabled={busy[k]}
                className="px-2 py-0.5 text-[10px] bg-[#2a2a2a] hover:bg-[#333] border border-[#444] text-neutral-300 disabled:opacity-50 rounded transition-colors"
              >
                {busy[k] ? '…' : 'Revert'}
              </button>
              <button
                onClick={() => accept([{ material: s.material, property: s.property }])}
                className="px-2 py-0.5 text-[10px] bg-blue-600/20 border border-blue-500/40 text-blue-400 hover:bg-blue-600/30 rounded transition-colors"
              >
                Accept
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssetTagsManager({
  asset,
  managerId,
  openTagManagerId,
  setOpenTagManagerId,
  newTagInput,
  setNewTagInput,
  popoverRef,
  showAllTags = false,
  maxWidth = 155,
  readOnly = false
}: {
  asset: Asset,
  managerId?: string,
  openTagManagerId?: string | null,
  setOpenTagManagerId?: (id: string | null) => void,
  newTagInput?: string,
  setNewTagInput?: (val: string) => void,
  popoverRef?: React.RefObject<HTMLDivElement | null>,
  showAllTags?: boolean,
  maxWidth?: number,
  readOnly?: boolean
}) {
  const { availableTags, addAvailableTag, updateAssetTags } = useAppContext();
  const visibleTags = showAllTags ? asset.tags : asset.tags.slice(0, getVisibleTagsCount(asset.tags, maxWidth));
  const hiddenCount = showAllTags ? 0 : asset.tags.length - getVisibleTagsCount(asset.tags, maxWidth);

  return (
    <div
      ref={!readOnly && openTagManagerId === managerId ? popoverRef : null}
      className="flex-1 flex items-center gap-1 relative py-1"
      onClick={(e) => {
        if (!readOnly) e.stopPropagation();
      }}
    >
      <div className="flex-1 flex flex-wrap gap-1 content-start">
        {!readOnly && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpenTagManagerId?.(openTagManagerId === managerId ? null : managerId!);
              setNewTagInput?.("");
            }}
            className="w-5 h-5 flex items-center justify-center rounded border border-dashed border-[#555] bg-transparent hover:bg-[#333] hover:border-solid text-neutral-500 hover:text-white transition-all flex-shrink-0"
          >
            <Plus className="w-3 h-3" />
          </button>
        )}
        {visibleTags.map(tag => (
          <span key={tag} className="h-5 pl-1.5 pr-1 inline-flex items-center gap-1 justify-center text-[10px] bg-[#222] border border-[#333] text-neutral-400 rounded" title={tag}>
            <span>{tag}</span>
            {!readOnly && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  updateAssetTags(asset.id, asset.tags.filter(t => t !== tag));
                }}
                className="w-3 h-3 flex items-center justify-center rounded-sm hover:bg-[#444] hover:text-white text-neutral-500 transition-colors"
                title="Remove tag"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </span>
        ))}
        {hiddenCount > 0 && (
          <div className="relative group/tag flex items-center h-5">
            <span className="h-5 px-1.5 inline-flex items-center justify-center text-[10px] bg-[#222] border border-[#333] text-neutral-400 rounded cursor-default whitespace-nowrap">
              +{hiddenCount} more
            </span>
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover/tag:block z-50 w-48 bg-[#1a1a1a] border border-[#333] rounded p-2 shadow-xl">
              <div className="flex flex-wrap gap-1">
                {asset.tags.map(tag => (
                  <span key={tag} className="h-5 px-1.5 inline-flex items-center justify-center text-[10px] bg-[#222] border border-[#333] text-neutral-400 rounded">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      {!readOnly && managerId && openTagManagerId === managerId && (
        <div className="absolute top-full left-0 mt-1 z-20 w-56 bg-[#1a1a1a] border border-[#333] rounded shadow-xl p-3" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-2 gap-3">
            <input
              type="text"
              placeholder="Add new tag... (Enter)"
              value={newTagInput}
              onChange={(e) => setNewTagInput?.(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTagInput?.trim()) {
                  e.preventDefault();
                  const inputTags = newTagInput.split(',').map(t => t.trim()).filter(t => t);
                  const newTags = [...asset.tags];
                  let changed = false;

                  inputTags.forEach(rawTag => {
                    const existingAvailable = availableTags.find(t => t.toLowerCase() === rawTag.toLowerCase());
                    const tagToUse = existingAvailable || rawTag;
                    
                    if (!existingAvailable) {
                      addAvailableTag(tagToUse);
                    }
                    
                    if (!newTags.some(t => t.toLowerCase() === tagToUse.toLowerCase())) {
                      newTags.push(tagToUse);
                      changed = true;
                    }
                  });

                  if (changed) {
                    updateAssetTags(asset.id, newTags);
                  }
                  setNewTagInput?.("");
                }
              }}
              className="w-full bg-[#111] border border-[#333] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-500"
            />
            <button onClick={() => setOpenTagManagerId?.(null)} className="text-neutral-500 hover:text-white flex-shrink-0">
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="max-h-32 overflow-y-auto scrollbar-hide space-y-1">
            {availableTags.map(tag => {
              const hasTag = asset.tags.includes(tag);
              return (
                <label key={tag} className="flex items-center gap-2 text-xs text-neutral-400 hover:text-neutral-200 cursor-pointer p-1 rounded hover:bg-[#222]">
                  <input
                    type="checkbox"
                    checked={hasTag}
                    onChange={() => {
                      if (hasTag) {
                        updateAssetTags(asset.id, asset.tags.filter(t => t !== tag));
                      } else {
                        updateAssetTags(asset.id, [...asset.tags, tag]);
                      }
                    }}
                    className="w-3.5 h-3.5 shrink-0 cursor-pointer appearance-none bg-[#111] border border-[#444] rounded hover:border-[#666] checked:bg-[#0066cc] checked:border-[#0066cc] flex items-center justify-center after:content-[''] after:hidden checked:after:block after:w-1 after:h-2 after:border-r-2 after:border-b-2 after:border-white after:rotate-45 after:-translate-y-[1px] transition-all"
                  />
                  <span className="truncate">{tag}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
