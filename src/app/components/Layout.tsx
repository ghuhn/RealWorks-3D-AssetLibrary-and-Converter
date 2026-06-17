import React, { useState, useRef, useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { FolderPlus, FilePlus, Search, Box, ListVideo, Terminal, Settings as SettingsIcon, ChevronRight, ChevronDown, CheckCircle2, XCircle, Loader2, AlertCircle, Plus, Menu, Info, AlertTriangle, X } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Layout() {
  const { queue, processing, selectedLog, setSelectedLog } = useAppContext();
  const showQueuePanel = queue.length > 0 || processing.length > 0;
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mainRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (document.getElementById('middle-workspace')) return; // Let inner workspace handle it
      for (const entry of entries) {
        const rect = entry.target.getBoundingClientRect();
        document.body.style.setProperty('--middle-workspace-width', `${rect.width}px`);
        document.body.style.setProperty('--middle-workspace-left', `${rect.left}px`);
      }
    });
    observer.observe(mainRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="flex h-screen bg-[#141414] text-[#e0e0e0] font-sans overflow-hidden selection:bg-[#0066cc] selection:text-white">
      <Sidebar />
      
      <div className="flex flex-1 flex-col overflow-hidden relative border-l border-[#333] min-w-0 min-h-0">
        <main ref={mainRef} className="flex-1 flex flex-col relative bg-[#1e1e1e] overflow-hidden min-h-0">
          <Outlet />
          
          <AnimatePresence>
            {showQueuePanel && (
              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={cn(
                  "absolute bottom-0 left-0 right-0 bg-[#1a1a1a] border-t border-[#333] shadow-[0_-4px_20px_rgba(0,0,0,0.5)] z-40 flex flex-col",
                  isQueueExpanded ? "h-64" : "h-12"
                )}
              >
                <div 
                  className="flex items-center justify-between px-4 h-12 cursor-pointer hover:bg-[#222] transition-colors"
                  onClick={() => setIsQueueExpanded(!isQueueExpanded)}
                >
                  <div className="flex items-center gap-3">
                    {processing.length > 0 ? (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                    ) : (
                      <Box className="w-4 h-4 text-neutral-400" />
                    )}
                    <span className="text-sm font-medium">
                      {processing.length > 0 ? "Processing " + processing.length + " items..." : queue.length + " items in queue"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link to="/queue" className="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 rounded bg-[#0066cc]/10 hover:bg-[#0066cc]/20 transition-colors" onClick={(e) => e.stopPropagation()}>
                      View Queue
                    </Link>
                    {isQueueExpanded ? <ChevronDown className="w-4 h-4 text-neutral-500" /> : <ChevronRight className="w-4 h-4 text-neutral-500" />}
                  </div>
                </div>

                {isQueueExpanded && (
                  <div className="flex-1 overflow-y-auto border-t border-[#2a2a2a] p-2 space-y-1">
                    {[...processing, ...queue].map(asset => (
                      <div key={asset.id} className="flex items-center justify-between px-3 py-2 bg-[#222] rounded border border-[#333] text-sm">
                        <div className="flex items-center gap-3">
                          <Box className="w-4 h-4 text-neutral-500" />
                          <span className="truncate max-w-[200px]">{asset.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          {asset.status === "Processing" ? (
                            <div className="w-32 h-1.5 bg-[#111] rounded-full overflow-hidden">
                              <motion.div 
                                className="h-full bg-blue-500" 
                                initial={{ width: 0 }}
                                animate={{ width: asset.progress + "%" }}
                              />
                            </div>
                          ) : (
                            <span className="text-xs text-neutral-500">Queued</span>
                          )}
                          <span className="text-xs w-8 text-right font-mono">
                            {asset.status === "Processing" ? Math.round(asset.progress || 0) + "%" : ""}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {selectedLog && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
                onClick={() => setSelectedLog(null)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 10 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  className="bg-[#1a1a1a] border border-[#333] rounded-lg shadow-2xl w-full max-w-2xl flex flex-col max-h-[80vh] overflow-hidden pointer-events-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="h-14 border-b border-[#333] flex items-center justify-between px-6 shrink-0 bg-[#222]">
                    <h2 className="text-sm font-semibold text-neutral-200 flex items-center gap-2">
                      {selectedLog.severity === "Info" && <Info className="w-4 h-4 text-blue-400" />}
                      {selectedLog.severity === "Warning" && <AlertTriangle className="w-4 h-4 text-amber-400" />}
                      {selectedLog.severity === "Error" && <XCircle className="w-4 h-4 text-red-400" />}
                      Log Details
                    </h2>
                    <button
                      onClick={() => setSelectedLog(null)}
                      className="text-neutral-500 hover:text-white transition-colors"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-6">
                      <div>
                        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Timestamp</h3>
                        <div className="text-sm text-neutral-300 font-mono bg-[#111] border border-[#333] px-3 py-2 rounded">{selectedLog.timestamp}</div>
                      </div>
                      <div>
                        <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Asset</h3>
                        <div className="text-sm text-neutral-300 font-mono bg-[#111] border border-[#333] px-3 py-2 rounded truncate">{selectedLog.asset}</div>
                      </div>
                    </div>
                    <div>
                      <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2">Message</h3>
                      <div className="text-sm text-neutral-300 font-mono bg-[#111] border border-[#333] p-4 rounded whitespace-pre-wrap leading-relaxed">
                        {selectedLog.message}
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}

// Header removed

export type CategoryNode = {
  name: string;
  subcategories?: CategoryNode[];
};

export const categories: CategoryNode[] = [
  { name: "Furniture" },
  { name: "Vehicles" },
  { name: "Characters" },
  { name: "Nature" },
  { name: "Props" },
  { name: "Materials" },
  { name: "Uncategorized" }
];

export const getCategoryNames = (cat: CategoryNode): string[] => {
  let names = [cat.name];
  if (cat.subcategories) {
    cat.subcategories.forEach(sub => {
      names = names.concat(getCategoryNames(sub));
    });
  }
  return names;
};

export const getAllNamesForCategory = (name: string, list: CategoryNode[] = categories): string[] => {
  for (const cat of list) {
    if (cat.name === name) {
      return getCategoryNames(cat);
    }
    if (cat.subcategories) {
      const found = getAllNamesForCategory(name, cat.subcategories);
      if (found.length > 0) return found;
    }
  }
  return [];
};

function Sidebar() {
  const location = useLocation();
  const { assets, importAsset, importFolder, selectedCategory, setSelectedCategory, selectedTags, setSelectedTags, availableTags, addAvailableTag } = useAppContext();
  
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);

  const navItems = [
    { path: "/", icon: Box, label: "Library" },
    { path: "/queue", icon: ListVideo, label: "Queue" },
    { path: "/logs", icon: Terminal, label: "Logs" },
    { path: "/settings", icon: SettingsIcon, label: "Settings" },
  ];


  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ "Categories": true });

  const toggleCat = (catName: string) => {
    setExpandedCats(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  const getAssetCount = (cat: CategoryNode) => {
    return assets.filter(a => a.status === "Library" && a.category === cat.name).length;
  };

  const totalLibraryAssets = assets.filter(a => a.status === "Library").length;

  const renderCategory = (cat: CategoryNode) => {
    const count = getAssetCount(cat);
    
    return (
      <li key={cat.name}>
        <button 
          onClick={() => setSelectedCategory(cat.name)}
          className={cn(
            "w-full text-left px-2 py-1.5 text-xs rounded flex items-center justify-between group transition-colors",
            selectedCategory === cat.name 
              ? "bg-[#222] text-white font-semibold"
              : "text-neutral-400 hover:text-neutral-200 hover:bg-[#222] font-normal"
          )}
        >
          <span>{cat.name}</span>
          <span className={cn("text-xs", selectedCategory === cat.name ? "text-neutral-400" : "text-neutral-500")}>{count}</span>
        </button>
      </li>
    );
  };

  return (
    <motion.aside 
      animate={{ width: isCollapsed ? 64 : 196 }}
      transition={{ type: "tween", duration: 0.3, ease: "easeInOut" }}
      className="flex flex-col bg-[#141414] overflow-y-auto shrink-0 overflow-x-hidden"
    >
      <div className={cn("h-14 flex items-center shrink-0 transition-colors", isCollapsed ? "justify-center" : "gap-3 px-4")}>
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)} 
          className="p-1.5 rounded hover:bg-[#222] text-neutral-400 hover:text-white transition-colors"
          title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
        >
          <Menu className="w-5 h-5" />
        </button>
        {!isCollapsed && (
          <div className="flex items-center gap-2">
            <img src="/logo.png?v=3" alt="RealWorks Logo" className="w-5 h-5 object-contain" />
          </div>
        )}
      </div>
      <div className={cn("pb-2 pt-2 space-y-2", isCollapsed ? "px-2" : "px-3")}>
        <button 
          onClick={() => importAsset({})}
          className={cn(
            "flex items-center justify-center gap-2 py-2 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-neutral-200 rounded transition-colors font-medium",
            isCollapsed ? "w-full px-0" : "w-full px-3"
          )}
          title="Import Asset"
        >
          <FilePlus className="w-4 h-4 text-neutral-400" />
          {!isCollapsed && <span>Import Asset</span>}
        </button>
        <button 
          onClick={() => importFolder()}
          className={cn(
            "flex items-center justify-center gap-2 py-2 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-neutral-200 rounded transition-colors font-medium",
            isCollapsed ? "w-full px-0" : "w-full px-3"
          )}
          title="Import Folder"
        >
          <FolderPlus className="w-4 h-4 text-neutral-400" />
          {!isCollapsed && <span>Import Folder</span>}
        </button>
      </div>
      <nav className={cn("pt-1 space-y-1 border-b border-[#2a2a2a]", isCollapsed ? "p-2" : "p-3")}>
        {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={cn(
                "flex items-center rounded text-sm transition-colors font-semibold",
                isCollapsed ? "justify-center py-2" : "gap-3 px-3 py-2",
                isActive 
                  ? "bg-[#0066cc] text-white" 
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#222]"
              )}
              title={isCollapsed ? item.label : undefined}
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {!isCollapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      {location.pathname === "/" && (
        <div className={cn("flex-1 overflow-y-auto custom-scrollbar outline-none", isCollapsed ? "hidden" : "p-4")} tabIndex={0}>
          <div className="mb-6">
            <h3 
              onClick={() => toggleCat('Categories')}
              className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 flex items-center justify-between cursor-pointer hover:text-neutral-300 transition-colors group"
            >
              Categories
              <ChevronRight className={cn("w-3 h-3 transition-transform group-hover:text-neutral-400", expandedCats['Categories'] && "rotate-90")} />
            </h3>
            {expandedCats['Categories'] && (
              <ul className="space-y-0.5">
                <li>
                  <button 
                    onClick={() => setSelectedCategory("All assets")}
                    className={cn(
                      "w-full text-left px-2 py-1.5 text-xs rounded flex items-center justify-between group transition-colors",
                      selectedCategory === "All assets"
                        ? "bg-[#222] text-white font-semibold"
                        : "text-neutral-400 hover:text-neutral-200 hover:bg-[#222] font-normal"
                    )}
                  >
                    <span>All assets</span>
                    <span className={cn("text-xs", selectedCategory === "All assets" ? "text-neutral-400" : "text-neutral-500")}>{totalLibraryAssets}</span>
                  </button>
                </li>
                {categories.map(cat => renderCategory(cat))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 flex items-center justify-between">
              Tags
              <ChevronDown className="w-3 h-3" />
            </h3>
            <div className="flex flex-wrap gap-1 items-center">
            
              {availableTags.map(tag => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button 
                    key={tag} 
                    onClick={() => setSelectedTags(isSelected ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag])}
                    className={cn(
                      "h-5 px-1.5 inline-flex items-center justify-center text-[10px] border rounded transition-colors",
                      isSelected 
                        ? "bg-[#0066cc]/20 text-blue-400 border-blue-500/50" 
                        : "bg-[#222] text-neutral-400 border-[#333] hover:border-[#555] hover:text-neutral-200"
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
              {!isAddingTag ? (
                <button
                  onClick={() => setIsAddingTag(true)}
                  className="w-5 h-5 flex items-center justify-center rounded border border-dashed border-[#555] bg-transparent hover:bg-[#333] hover:border-solid text-neutral-500 hover:text-white transition-all flex-shrink-0"
                  title="Create new tag"
                >
                  <Plus className="w-3 h-3" />
                </button>
              ) : (
                <input
                  autoFocus
                  type="text"
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newTag.trim()) {
                      const tags = newTag.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
                      tags.forEach(t => addAvailableTag(t));
                      setNewTag("");
                      setIsAddingTag(false);
                    } else if (e.key === 'Escape') {
                      setIsAddingTag(false);
                      setNewTag("");
                    }
                  }}
                  onBlur={() => {
                    setIsAddingTag(false);
                    setNewTag("");
                  }}
                  className="h-5 w-20 px-1.5 text-[10px] bg-[#111] border border-[#333] text-white rounded focus:outline-none focus:border-blue-500"
                  placeholder="new tag"
                />
              )}
            </div>
          </div>
        </div>
      )}
    </motion.aside>
  );
}
