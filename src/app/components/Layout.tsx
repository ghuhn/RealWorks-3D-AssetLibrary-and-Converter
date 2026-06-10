import React, { useState } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { FolderPlus, FilePlus, Search, Box, ListVideo, Terminal, Settings as SettingsIcon, ChevronRight, ChevronDown, CheckCircle2, XCircle, Loader2, AlertCircle } from "lucide-react";
import { useAppContext } from "../context/AppContext";
import { motion, AnimatePresence } from "motion/react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Layout() {
  const { queue, processing } = useAppContext();
  const showQueuePanel = queue.length > 0 || processing.length > 0;
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);

  return (
    <div className="flex h-screen bg-[#141414] text-[#e0e0e0] font-sans overflow-hidden selection:bg-[#0066cc] selection:text-white">
      <Sidebar />
      
      <div className="flex flex-1 flex-col overflow-hidden relative border-l border-[#333]">
        <main className="flex-1 flex flex-col relative bg-[#1e1e1e] overflow-hidden">
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
  { 
    name: "Furniture", 
    subcategories: [
      { name: "Chairs", subcategories: [{ name: "Armchairs" }, { name: "Stools" }, { name: "Sofas" }] }, 
      { name: "Tables" }, 
      { name: "Cabinets" }
    ] 
  },
  { 
    name: "Vehicles", 
    subcategories: [
      { name: "Four wheeler" }, 
      { name: "Two wheeler" }, 
      { name: "EV" }, 
      { name: "Aircraft" }, 
      { name: "Watercraft" }
    ] 
  },
  { name: "Characters", subcategories: [{ name: "Human" }, { name: "Creature" }, { name: "Robots" }] },
  { name: "Nature", subcategories: [{ name: "Trees" }, { name: "Rocks" }, { name: "Terrain" }] },
  { name: "Props", subcategories: [{ name: "Weapons" }, { name: "Tools" }, { name: "Electronics" }] },
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
  const { assets, importAsset, selectedCategory, setSelectedCategory, selectedTags, setSelectedTags, availableTags } = useAppContext();
  
  const navItems = [
    { path: "/", icon: Box, label: "Library" },
    { path: "/queue", icon: ListVideo, label: "Queue" },
    { path: "/logs", icon: Terminal, label: "Logs" },
    { path: "/settings", icon: SettingsIcon, label: "Settings" },
  ];


  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ "Categories": true, "Vehicles": true });

  const toggleCat = (catName: string) => {
    setExpandedCats(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  const getAssetCount = (cat: CategoryNode) => {
    const names = getCategoryNames(cat);
    return assets.filter(a => a.status === "Library" && names.includes(a.category)).length;
  };

  const totalLibraryAssets = assets.filter(a => a.status === "Library").length;

  const renderCategory = (cat: CategoryNode, level = 0) => {
    const hasSub = cat.subcategories && cat.subcategories.length > 0;
    const isExpanded = expandedCats[cat.name];
    const count = getAssetCount(cat);
    
    return (
      <li key={cat.name}>
        <button 
          onClick={() => {
            setSelectedCategory(cat.name);
            if (hasSub) toggleCat(cat.name);
          }}
          className={cn(
            "w-full text-left py-1.5 text-sm rounded flex items-center justify-between group transition-colors",
            selectedCategory === cat.name 
              ? "bg-[#0066cc]/20 text-blue-400 font-medium px-2"
              : level === 0 
                ? "text-neutral-400 hover:text-neutral-200 hover:bg-[#222] px-2" 
                : "text-neutral-500 hover:text-neutral-300 hover:bg-[#222] px-2"
          )}
          style={{ paddingLeft: level === 0 ? undefined : `${level * 12 + 8}px` }}
        >
          <div className="flex items-center gap-2">
            {level > 0 && !hasSub && <div className={cn("w-1 h-1 rounded-full mr-1", selectedCategory === cat.name ? "bg-blue-400" : "bg-[#444]")} />}
            <span>{cat.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={cn("text-xs", selectedCategory === cat.name ? "text-blue-400/80" : "text-neutral-500")}>{count}</span>
            {hasSub && (
              <ChevronRight 
                onClick={(e) => {
                  e.stopPropagation();
                  toggleCat(cat.name);
                }}
                className={cn("w-3.5 h-3.5 transition-transform group-hover:text-neutral-300 cursor-pointer", isExpanded && "rotate-90", selectedCategory === cat.name ? "text-blue-400" : "text-neutral-600")} 
              />
            )}
            {!hasSub && <div className="w-3.5" />}
          </div>
        </button>
        {hasSub && isExpanded && (
          <ul className="mt-0.5 space-y-0.5">
            {cat.subcategories!.map(sub => renderCategory(sub, level + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside className="w-64 flex flex-col bg-[#141414] overflow-y-auto shrink-0">
      <div className="h-14 flex items-center gap-3 px-4 shrink-0">
        <Box className="w-6 h-6 text-[#0066cc]" />
        <span className="text-neutral-200 font-semibold tracking-wide">RW Asset Browser</span>
      </div>
      <div className="px-3 pb-2 pt-2">
        <button 
          onClick={() => importAsset({})}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] text-neutral-200 rounded transition-colors font-medium"
        >
          <FilePlus className="w-4 h-4 text-neutral-400" />
          Import Asset
        </button>
      </div>
      <nav className="p-3 pt-1 space-y-1 border-b border-[#2a2a2a]">
        {navItems.map(item => {
          const isActive = location.pathname === item.path;
          return (
            <Link 
              key={item.path} 
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors",
                isActive 
                  ? "bg-[#0066cc] text-white" 
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-[#222]"
              )}
            >
              <item.icon className="w-4 h-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {location.pathname === "/" && (
        <div className="p-4 flex-1 overflow-y-auto custom-scrollbar">
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
                      "w-full text-left px-2 py-1.5 text-sm rounded flex items-center justify-between transition-colors font-medium",
                      selectedCategory === "All assets"
                        ? "bg-[#0066cc]/20 text-blue-400"
                        : "text-neutral-300 hover:text-white hover:bg-[#222]"
                    )}
                  >
                    <span>All assets</span>
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs", selectedCategory === "All assets" ? "text-blue-400/80" : "text-neutral-500")}>{totalLibraryAssets}</span>
                      <div className="w-3.5" />
                    </div>
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
            <div className="flex flex-wrap gap-2">
              {availableTags.map(tag => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button 
                    key={tag} 
                    onClick={() => setSelectedTags(isSelected ? selectedTags.filter(t => t !== tag) : [...selectedTags, tag])}
                    className={cn(
                      "px-2 py-1 text-xs border rounded transition-colors",
                      isSelected 
                        ? "bg-[#0066cc]/20 text-blue-400 border-blue-500/50" 
                        : "bg-[#222] text-neutral-400 border-[#333] hover:border-[#555] hover:text-neutral-200"
                    )}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
