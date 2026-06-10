import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export type AssetStatus = "Library" | "Queued" | "Processing" | "Completed" | "Failed" | "Cancelled";

export interface Asset {
  id: string;
  name: string;
  category: string;
  tags: string[];
  sourceFormat: string;
  dateAdded: string;
  thumbnail: string;
  status: AssetStatus;
  progress?: number;
  time?: string;
  warnings?: string[];
  path?: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  asset: string;
  severity: "Info" | "Warning" | "Error";
  message: string;
}

interface AppContextType {
  assets: Asset[];
  logs: LogEntry[];
  queue: Asset[];
  processing: Asset[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedCategory: string;
  setSelectedCategory: (c: string) => void;
  selectedTags: string[];
  setSelectedTags: (t: string[]) => void;
  availableTags: string[];
  addAvailableTag: (t: string) => void;
  updateAssetTags: (id: string, tags: string[]) => void;
  importAsset: (asset: Partial<Asset>) => void;
  importFolder: () => void;
  retryAsset: (id: string) => void;
  retryAllFailed: () => void;
  cancelAsset: (id: string) => void;
  clearCompleted: () => void;
  updateAssetStatus: (id: string, status: AssetStatus, progress?: number) => void;
  deleteAsset: (id: string) => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All assets");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>(["interior", "exterior", "modern", "vintage", "organic", "hard-surface", "rigged"]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const queue = assets.filter(a => a.status === "Queued");
  const processing = assets.filter(a => a.status === "Processing");

  const addLog = (assetName: string, severity: "Info" | "Warning" | "Error", message: string) => {
    setLogs(prev => [{
      id: "log-" + Date.now() + Math.random(),
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      asset: assetName,
      severity,
      message
    }, ...prev]);
  };

  const loadAssets = async () => {
    try {
      const dbAssets: any[] = await invoke('get_assets');
      const mappedAssets: Asset[] = dbAssets.map(a => ({
        id: a.id,
        name: a.name,
        category: a.category,
        tags: a.tags ? a.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t) : [],
        sourceFormat: a.source_format || "Unknown",
        dateAdded: a.created_at,
        thumbnail: a.thumbnail ? convertFileSrc(a.thumbnail) : "",
        status: "Library" as AssetStatus,
        path: a.path
      }));
      
      // Merge with queued/processing
      setAssets(prev => {
        const active = prev.filter(a => a.status !== "Library");
        const newLibraryAssets = mappedAssets.filter(ma => !active.some(act => act.name === ma.name));
        return [...newLibraryAssets, ...active];
      });
    } catch (e) {
      console.error('Failed to load assets', e);
      addLog("System", "Error", `Failed to load assets: ${e}`);
    }
  };

  useEffect(() => {
    loadAssets();
  }, []);

  const convertAsset = async (path: string, isBatch = false) => {
    const assetName = path.split(/[\\/]/).pop() || path;
    const newAsset: Asset = {
      id: "asset-" + Date.now(),
      name: assetName,
      category: "Uncategorized",
      tags: [],
      sourceFormat: assetName.split('.').pop() || "unknown",
      dateAdded: new Date().toISOString(),
      thumbnail: "",
      status: "Processing",
      progress: 0,
      path: path
    };
    
    setAssets(prev => [...prev, newAsset]);
    addLog(assetName, "Info", `Started conversion for: ${path}`);

    try {
      await invoke('convert_asset', { path, isBatch });
      addLog(assetName, "Info", "Successfully converted.");
      toast.success(`Converted ${assetName} successfully`);
      
      setAssets(prev => prev.filter(a => a.id !== newAsset.id));
      loadAssets(); // Reload library from DB
    } catch (e) {
      console.error('Conversion failed', e);
      addLog(assetName, "Error", `Conversion failed: ${e}`);
      toast.error(`Failed to convert ${assetName}`);
      updateAssetStatus(newAsset.id, "Failed");
    }
  };

  const importAsset = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{
          name: '3D Models',
          extensions: ['fbx', 'obj', 'glb', 'gltf', 'blend', 'dae', 'stl', 'ply', 'usd', 'usda', 'usdz']
        }]
      });
      if (selected) {
        const filePath = Array.isArray(selected) ? selected[0] : selected;
        convertAsset(filePath as string);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to open file dialog");
    }
  };

  const importFolder = async () => {
    try {
      const selected = await open({ directory: true });
      if (selected) {
        const folderPath = selected as string;
        convertAsset(folderPath, true);
      }
    } catch (e) {
      console.error(e);
      toast.error("Failed to open folder dialog");
    }
  };

  const updateAssetStatus = (id: string, status: AssetStatus, progress?: number) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, status, progress: progress ?? a.progress } : a));
  };

  const updateAssetTags = (id: string, tags: string[]) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, tags } : a));
  };

  const addAvailableTag = (tag: string) => {
    if (!availableTags.includes(tag)) {
      setAvailableTags(prev => [...prev, tag]);
    }
  };

  const deleteAsset = async (id: string) => {
    try {
      await invoke('delete_asset', { id });
      setAssets(prev => prev.filter(a => a.id !== id));
      toast.success("Asset deleted successfully");
    } catch (e) {
      console.error(e);
      toast.error(`Failed to delete asset: ${e}`);
    }
  };

  const retryAsset = (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (asset && asset.path) {
      // Remove from current list, let convertAsset add it again
      setAssets(prev => prev.filter(a => a.id !== id));
      convertAsset(asset.path, asset.tags.includes("batch")); // Approximation
    }
  };

  const retryAllFailed = () => {
    assets.filter(a => a.status === "Failed").forEach(a => retryAsset(a.id));
  };

  const cancelAsset = (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (asset) {
      updateAssetStatus(id, "Cancelled");
      addLog(asset.name, "Warning", "Conversion cancelled by user.");
      toast.info("Cancelled " + asset.name);
    }
  };

  const clearCompleted = () => {
    setAssets(prev => prev.filter(a => a.status !== "Completed" && a.status !== "Failed" && a.status !== "Cancelled"));
    toast.success("Cleared non-active items from queue");
  };

  return (
    <AppContext.Provider value={{
      assets, logs, queue, processing, searchQuery, setSearchQuery,
      selectedCategory, setSelectedCategory, selectedTags, setSelectedTags,
      availableTags, addAvailableTag, updateAssetTags,
      importAsset, importFolder, retryAsset, retryAllFailed,
      cancelAsset, clearCompleted, updateAssetStatus, deleteAsset
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error("useAppContext must be used within AppProvider");
  return context;
};
