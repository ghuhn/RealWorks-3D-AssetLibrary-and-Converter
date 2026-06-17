import React from "react";
import { Play, RotateCcw, X, Trash2, CheckCircle2, AlertTriangle, XCircle, Clock, FileWarning } from "lucide-react";
import { useAppContext, type Asset } from "../context/AppContext";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Queue() {
  const { assets, retryAllFailed, clearCompleted, cancelAsset, retryAsset } = useAppContext();
  
  const queuedAssets = assets.filter(a => a.status !== "Library");

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#1e1e1e]">
      <div className="h-14 border-b border-[#333] flex items-center justify-between px-6 shrink-0">
        <h1 className="text-lg font-semibold text-neutral-200">Conversion Queue</h1>
        <div className="flex items-center gap-3">
          <button 
            onClick={retryAllFailed}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] rounded transition-colors text-neutral-300"
          >
            <RotateCcw className="w-4 h-4" /> Retry Failed
          </button>
          <button 
            onClick={clearCompleted}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-[#2a2a2a] hover:bg-[#333] border border-[#3d3d3d] rounded transition-colors text-neutral-300"
          >
            <Trash2 className="w-4 h-4" /> Clear Completed
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 custom-scrollbar">
        <div className="bg-[#1a1a1a] rounded-lg border border-[#333] overflow-hidden">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-[#222] border-b border-[#333]">
              <tr>
                <th className="px-4 py-3 font-medium text-neutral-400 w-64">Asset Name</th>
                <th className="px-4 py-3 font-medium text-neutral-400 w-64">Status</th>
                <th className="px-4 py-3 font-medium text-neutral-400 w-24">Time taken</th>

                <th className="px-4 py-3 font-medium text-neutral-400 w-24 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2a2a2a]">
              {queuedAssets.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-neutral-500">
                    No assets in queue
                  </td>
                </tr>
              ) : (
                queuedAssets.map(asset => (
                  <tr key={asset.id} className="hover:bg-[#222]/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="font-medium text-neutral-200 truncate max-w-[200px]" title={asset.name}>{asset.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start">
                          <StatusBadge status={asset.status} />
                        </div>
                        {asset.status === "Processing" && (
                          <div className="flex items-center gap-3 w-56">
                            <div className="flex-1 h-1.5 bg-[#111] rounded-full overflow-hidden border border-[#333]">
                              <div 
                                className="h-full bg-blue-500 transition-all duration-300 ease-out" 
                                style={{ width: `${asset.progress}%` }}
                              />
                            </div>
                            <span className="font-mono text-xs w-8">{Math.round(asset.progress || 0)}%</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-neutral-400">
                      {asset.status === "Processing" || asset.status === "Completed" ? (asset.time || "-") : "-"}
                    </td>

                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {(asset.status === "Failed" || asset.status === "Cancelled") && (
                          <button onClick={() => retryAsset(asset.id)} className="p-1.5 text-neutral-400 hover:text-white hover:bg-[#333] rounded transition-colors" title="Retry">
                            <RotateCcw className="w-4 h-4" />
                          </button>
                        )}
                        {(asset.status === "Queued" || asset.status === "Processing") && (
                          <button onClick={() => cancelAsset(asset.id)} className="p-1.5 text-neutral-400 hover:text-red-400 hover:bg-[#333] rounded transition-colors" title="Cancel">
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Asset["status"] }) {
  const styles = {
    Queued: "bg-neutral-500/10 text-neutral-400 border-neutral-500/20",
    Processing: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    Completed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Failed: "bg-red-500/10 text-red-400 border-red-500/20",
    Cancelled: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Library: ""
  };

  const Icon = {
    Queued: Clock,
    Processing: Play,
    Completed: CheckCircle2,
    Failed: XCircle,
    Cancelled: FileWarning,
    Library: Clock
  }[status];

  return (
    <div className={cn("inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium border", styles[status])}>
      <Icon className="w-3.5 h-3.5" />
      {status}
    </div>
  );
}
