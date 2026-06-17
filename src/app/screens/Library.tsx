import React, { useState, useEffect, useRef } from "react";
import { LayoutGrid, List as ListIcon, Info, FolderOpen, Calendar, Tag as TagIcon, FileType2, Box, Trash2, Search, ChevronRight, FilterX, Plus, X, HardDrive, ArrowDownUp } from "lucide-react";
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
  const { assets, searchQuery, setSearchQuery, selectedCategory, setSelectedCategory, selectedTags, setSelectedTags, deleteAsset } = useAppContext();
  const libraryAssets = assets.filter(a => {
    if (a.status !== "Library") return false;

    if (sortBy === "recent") {
      const assetDate = new Date(a.dateAdded).getTime();
      const threeDaysAgo = Date.now() - 3 * 24 * 60 * 60 * 1000;
      if (assetDate < threeDaysAgo) return false;
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      if (!a.name.toLowerCase().includes(query) && !a.category.toLowerCase().includes(query)) return false;
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
  const [openTagManagerId, setOpenTagManagerId] = useState<string | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [textureFiles, setTextureFiles] = useState<string[]>([]);
  const { availableTags, addAvailableTag, updateAssetTags } = useAppContext();
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

        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar outline-none" tabIndex={0}>
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
                    if (window.confirm(`Are you sure you want to move "${asset.name}" to the Recycle Bin?`)) {
                      deleteAsset(asset.id);
                      if (selectedAsset?.id === asset.id) setSelectedAsset(null);
                    }
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
                        if (window.confirm(`Are you sure you want to move ${selectedForDelete.length} items to the Recycle Bin?`)) {
                          selectedForDelete.forEach(id => deleteAsset(id));
                          setSelectedForDelete([]);
                          if (selectedAsset && selectedForDelete.includes(selectedAsset.id)) setSelectedAsset(null);
                        }
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
                        if (window.confirm(`Are you sure you want to move "${asset.name}" to the Recycle Bin?`)) {
                          deleteAsset(asset.id);
                          if (selectedAsset?.id === asset.id) setSelectedAsset(null);
                          setSelectedForDelete(prev => prev.filter(id => id !== asset.id));
                        }
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
                      if (window.confirm(`Are you sure you want to move "${selectedAsset.name}" to the Recycle Bin?`)) {
                        deleteAsset(selectedAsset.id);
                        setSelectedAsset(null);
                      }
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

              <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-6 outline-none" tabIndex={0}>
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
                    managerId={`details-${selectedAsset.id}`}
                    openTagManagerId={openTagManagerId}
                    setOpenTagManagerId={setOpenTagManagerId}
                    newTagInput={newTagInput}
                    setNewTagInput={setNewTagInput}
                    popoverRef={popoverRef}
                    maxWidth={250}
                  />
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
                  const inputTags = newTagInput.split(',').map(t => t.trim().toLowerCase()).filter(t => t);
                  const newTags = [...asset.tags];
                  let changed = false;

                  inputTags.forEach(tag => {
                    addAvailableTag(tag);
                    if (!newTags.includes(tag)) {
                      newTags.push(tag);
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
          <div className="max-h-32 overflow-y-auto custom-scrollbar space-y-1">
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
