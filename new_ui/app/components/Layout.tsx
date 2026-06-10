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
    <div className="flex flex-col h-screen bg-[#141414] text-[#e0e0e0] font-sans overflow-hidden selection:bg-[#0066cc] selection:text-white">
      <Header />
      
      <div className="flex flex-1 overflow-hidden relative">
        <Sidebar />
        
        <main className="flex-1 flex flex-col relative bg-[#1e1e1e] border-l border-[#333] overflow-hidden">
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

function Header() {
  const { importAsset, importFolder, searchQuery, setSearchQuery } = useAppContext();

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-[#1a1a1a] border-b border-[#333] shrink-0">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-neutral-200 font-semibold tracking-wide">Asset Browser</div>
        
        <div className="h-6 w-px bg-[#333] mx-2" />
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button 
            onClick={() => importAsset({})}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] rounded transition-colors"
          >
            <FilePlus className="w-4 h-4 text-neutral-400" />
            Import Asset
          </button>
          
        </div>
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
      </div>
    </header>
  );
}

function Sidebar() {
  const location = useLocation();
  const navItems = [
    { path: "/", icon: Box, label: "Library" },
    { path: "/queue", icon: ListVideo, label: "Queue" },
    { path: "/logs", icon: Terminal, label: "Logs" },
    { path: "/settings", icon: SettingsIcon, label: "Settings" },
  ];

  const categories = [
    { name: "Furniture", subcategories: ["Chairs", "Tables", "Cabinets"] },
    { name: "Vehicles", subcategories: ["Four wheeler", "Two wheeler", "EV", "Aircraft", "Watercraft"] },
    { name: "Characters", subcategories: ["Human", "Creature", "Robots"] },
    { name: "Nature", subcategories: ["Trees", "Rocks", "Terrain"] },
    { name: "Props", subcategories: ["Weapons", "Tools", "Electronics"] },
    { name: "Materials" },
    { name: "Uncategorized" }
  ];
  const tags = ["interior", "exterior", "modern", "vintage", "organic", "hard-surface", "rigged"];

  const [expandedCats, setExpandedCats] = useState<Record<string, boolean>>({ "Vehicles": true });

  const toggleCat = (catName: string) => {
    setExpandedCats(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  return (
    <aside className="w-64 flex flex-col bg-[#141414] overflow-y-auto shrink-0">
      <nav className="p-3 space-y-1 border-b border-[#2a2a2a]">
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
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-2 flex items-center justify-between">
              Categories
              <ChevronDown className="w-3 h-3" />
            </h3>
            <ul className="space-y-0.5">
              {categories.map(cat => {
                const hasSub = cat.subcategories && cat.subcategories.length > 0;
                const isExpanded = expandedCats[cat.name];
                return (
                  <li key={cat.name}>
                    <button 
                      onClick={() => hasSub && toggleCat(cat.name)}
                      className="w-full text-left px-2 py-1.5 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-[#222] rounded flex items-center justify-between group transition-colors"
                    >
                      <span>{cat.name}</span>
                      {hasSub && (
                        <ChevronRight className={cn("w-3.5 h-3.5 transition-transform text-neutral-600 group-hover:text-neutral-400", isExpanded && "rotate-90")} />
                      )}
                    </button>
                    {hasSub && isExpanded && (
                      <ul className="mt-0.5 space-y-0.5 pl-3">
                        {cat.subcategories!.map(sub => (
                          <li key={sub}>
                            <button className="w-full text-left px-2 py-1.5 text-sm text-neutral-500 hover:text-neutral-300 hover:bg-[#222] rounded flex items-center before:content-[''] before:w-1 before:h-1 before:bg-[#444] before:rounded-full before:mr-2">
                              {sub}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wider mb-3 flex items-center justify-between">
              Tags
              <ChevronDown className="w-3 h-3" />
            </h3>
            <div className="flex flex-wrap gap-2">
              {tags.map(tag => (
                <button key={tag} className="px-2 py-1 text-xs bg-[#222] text-neutral-400 border border-[#333] hover:border-[#555] hover:text-neutral-200 rounded transition-colors">
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
