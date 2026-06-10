import React, { createContext, useContext, useState, useEffect } from "react";
import { toast } from "sonner";

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
  importAsset: (asset: Partial<Asset>) => void;
  importFolder: () => void;
  retryAsset: (id: string) => void;
  retryAllFailed: () => void;
  cancelAsset: (id: string) => void;
  clearCompleted: () => void;
  updateAssetStatus: (id: string, status: AssetStatus, progress?: number) => void;
}

const mockAssets: Asset[] = [
  {
    id: "asset-1",
    name: "Asset_01",
    category: "Furniture",
    tags: ["interior", "modern", "seating"],
    sourceFormat: ".obj",
    dateAdded: "2026-06-05T10:00:00Z",
    thumbnail: "https://images.unsplash.com/photo-1554104707-a76b270e4bbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBjaGFpciUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwxfHx8fDE3ODA2NTg4MzB8MA&ixlib=rb-4.1.0&q=80&w=1080",
    status: "Library"
  },
  {
    id: "asset-2",
    name: "Asset_02",
    category: "Vehicles",
    tags: ["automotive", "concept", "exterior"],
    sourceFormat: ".fbx",
    dateAdded: "2026-06-04T15:30:00Z",
    thumbnail: "https://images.unsplash.com/photo-1441148345475-03a2e82f9719?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxzcG9ydHMlMjBjYXIlMjBncmV5JTIwYmFja2dyb3VuZHxlbnwxfHx8fDE3ODA2NTg4MzF8MA&ixlib=rb-4.1.0&q=80&w=1080",
    status: "Library"
  },
  {
    id: "asset-3",
    name: "Asset_03",
    category: "Characters",
    tags: ["biped", "rigged", "hero"],
    sourceFormat: ".gltf",
    dateAdded: "2026-06-03T09:15:00Z",
    thumbnail: "https://images.unsplash.com/photo-1639628735078-ed2f038a193e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHwzZCUyMGNoYXJhY3RlciUyMG1vZGVsfGVufDF8fHx8MTc4MDY1ODgzMXww&ixlib=rb-4.1.0&q=80&w=1080",
    status: "Library"
  },
  {
    id: "asset-4",
    name: "Asset_04",
    category: "Nature",
    tags: ["foliage", "exterior", "organic"],
    sourceFormat: ".fbx",
    dateAdded: "2026-06-02T11:45:00Z",
    thumbnail: "https://images.unsplash.com/photo-1677473264752-240984d478e3?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx0cmVlJTIwbmF0dXJlJTIwaXNvbGF0ZWR8ZW58MXx8fHwxNzgwNjU4ODMxfDA&ixlib=rb-4.1.0&q=80&w=1080",
    status: "Library"
  },
  {
    id: "asset-5",
    name: "Asset_05",
    category: "Props",
    tags: ["vintage", "electronics", "hard-surface"],
    sourceFormat: ".obj",
    dateAdded: "2026-06-01T14:20:00Z",
    thumbnail: "https://images.unsplash.com/photo-1520549233664-03f65c1d1327?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwY2FtZXJhJTIwaXNvbGF0ZWR8ZW58MXx8fHwxNzgwNjU4ODMxfDA&ixlib=rb-4.1.0&q=80&w=1080",
    status: "Library"
  }
];

const mockLogs: LogEntry[] = [
  { id: "log-1", timestamp: "10:00:05", asset: "Asset_01", severity: "Info", message: "Successfully converted .obj to .usd" },
  { id: "log-2", timestamp: "15:30:12", asset: "Asset_02", severity: "Warning", message: "Missing texture map: normal_01.png. Proceeding with fallback." },
  { id: "log-3", timestamp: "09:15:20", asset: "Asset_03", severity: "Info", message: "Rig transferred successfully." },
];

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [assets, setAssets] = useState<Asset[]>(mockAssets);
  const [logs, setLogs] = useState<LogEntry[]>(mockLogs);

  const queue = assets.filter(a => a.status === "Queued");
  const processing = assets.filter(a => a.status === "Processing");

  const addLog = (assetName: string, severity: "Info" | "Warning" | "Error", message: string) => {
    setLogs(prev => [{
      id: "log-" + Date.now(),
      timestamp: new Date().toLocaleTimeString([], { hour12: false }),
      asset: assetName,
      severity,
      message
    }, ...prev]);
  };

  const importAsset = (partial: Partial<Asset>) => {
    const newAsset: Asset = {
      id: "asset-" + Date.now(),
      name: partial.name || "New_Asset",
      category: partial.category || "Uncategorized",
      tags: partial.tags || [],
      sourceFormat: partial.sourceFormat || ".fbx",
      dateAdded: new Date().toISOString(),
      thumbnail: partial.thumbnail || "https://images.unsplash.com/photo-1554104707-a76b270e4bbb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxtb2Rlcm4lMjBjaGFpciUyMHdoaXRlJTIwYmFja2dyb3VuZHxlbnwxfHx8fDE3ODA2NTg4MzB8MA&ixlib=rb-4.1.0&q=80&w=1080",
      status: "Queued",
      progress: 0,
      time: "00:00"
    };
    setAssets(prev => [...prev, newAsset]);
    addLog(newAsset.name, "Info", "Added to conversion queue.");
    toast.success("Added " + newAsset.name + " to queue");
  };

  const importFolder = () => {
    const newAssets: Asset[] = [
      {
        id: "asset-" + Date.now() + "-1",
        name: "Batch_Asset_01",
        category: "Props",
        tags: ["batch"],
        sourceFormat: ".obj",
        dateAdded: new Date().toISOString(),
        thumbnail: "https://images.unsplash.com/photo-1520549233664-03f65c1d1327?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwY2FtZXJhJTIwaXNvbGF0ZWR8ZW58MXx8fHwxNzgwNjU4ODMxfDA&ixlib=rb-4.1.0&q=80&w=1080",
        status: "Queued",
        progress: 0
      },
      {
        id: "asset-" + Date.now() + "-2",
        name: "Batch_Asset_02_Corrupted",
        category: "Props",
        tags: ["batch"],
        sourceFormat: ".fbx",
        dateAdded: new Date().toISOString(),
        thumbnail: "https://images.unsplash.com/photo-1520549233664-03f65c1d1327?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aW50YWdlJTIwY2FtZXJhJTIwaXNvbGF0ZWR8ZW58MXx8fHwxNzgwNjU4ODMxfDA&ixlib=rb-4.1.0&q=80&w=1080",
        status: "Queued",
        progress: 0
      }
    ];
    setAssets(prev => [...prev, ...newAssets]);
    toast.success("Imported folder: 2 assets found");
  };

  const updateAssetStatus = (id: string, status: AssetStatus, progress?: number) => {
    setAssets(prev => prev.map(a => a.id === id ? { ...a, status, progress: progress ?? a.progress } : a));
  };

  const retryAsset = (id: string) => {
    const asset = assets.find(a => a.id === id);
    if (asset) {
      updateAssetStatus(id, "Queued", 0);
      addLog(asset.name, "Info", "Retrying conversion.");
      toast.success("Retrying " + asset.name);
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
    setAssets(prev => prev.map(a => a.status === "Completed" ? { ...a, status: "Library" } : a));
    toast.success("Cleared completed items from queue");
  };

  // Processing Simulation Effect
  useEffect(() => {
    const processQueue = () => {
      const q = assets.filter(a => a.status === "Queued");
      const p = assets.filter(a => a.status === "Processing");

      // Start processing if we have capacity (max 2 at a time)
      if (p.length < 2 && q.length > 0) {
        const toProcess = q[0];
        updateAssetStatus(toProcess.id, "Processing", 0);
        addLog(toProcess.name, "Info", "Started USD conversion.");
      }

      // Update processing items
      p.forEach(asset => {
        const newProg = (asset.progress || 0) + Math.random() * 20 + 10;
        if (newProg >= 100) {
          // Simulate a failure for the Corrupted mock asset
          if (asset.name.includes("Corrupted")) {
            updateAssetStatus(asset.id, "Failed", 100);
            setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, warnings: ["Invalid magic number in header."] } : a));
            addLog(asset.name, "Error", "Conversion failed: Invalid magic number in header.");
            toast.error("Failed to convert " + asset.name);
          } else {
            updateAssetStatus(asset.id, "Completed", 100);
            addLog(asset.name, "Info", "Successfully converted to USD.");
            toast.success("Converted " + asset.name + " successfully");
            
            // Move to library after 2 seconds
            setTimeout(() => {
              setAssets(prev => prev.map(a => a.id === asset.id && a.status === "Completed" ? { ...a, status: "Library" } : a));
            }, 2000);
          }
        } else {
          updateAssetStatus(asset.id, "Processing", newProg);
        }
      });
    };

    const interval = setInterval(processQueue, 1000);
    return () => clearInterval(interval);
  }, [assets]);

  return (
    <AppContext.Provider value={{
      assets, logs, queue, processing, searchQuery, setSearchQuery,
      importAsset, importFolder, retryAsset, retryAllFailed,
      cancelAsset, clearCompleted, updateAssetStatus
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
