import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import LibraryView from './components/LibraryView';
import './index.css';

export interface Asset {
  id: string;
  name: string;
  category: string;
  tags: string;
  path: string;
  thumbnail: string;
  source_format: string;
  animated: boolean;
  created_at: string;
}

export interface Settings {
  blender_path: string;
  library_path: string;
  debug_blend_path: string;
  gemini_api_key: string;
}

export interface LogEntry {
  timestamp: string;
  message: string;
  type: 'info' | 'error' | 'success';
}


function App() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<Settings>({ blender_path: '', library_path: '', debug_blend_path: '', gemini_api_key: '' });
  const [assets, setAssets] = useState<Asset[]>([]);
  const [queue, setQueue] = useState<string[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);

  const addLog = (msg: string, type: 'info' | 'error' | 'success' = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), message: msg, type }]);
  };

  useEffect(() => {
    // Check initial settings
    invoke<Settings>('get_settings').then((s) => {
      setSettings(s);
      if (!s.library_path) {
        setSettingsOpen(true);
      } else {
        loadAssets();
      }
    }).catch(console.error);
  }, []);

  const loadAssets = async () => {
    try {
      const dbAssets = await invoke<Asset[]>('get_assets');
      setAssets(dbAssets);
    } catch (e) {
      console.error('Failed to load assets', e);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await invoke('save_settings', { settings });
      setSettingsOpen(false);
      loadAssets();
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  };

  const handleImportAsset = async () => {
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
        setQueue(q => [...q, filePath as string]);
        convertAsset(filePath as string);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleImportFolder = async () => {
    try {
      const selected = await open({ directory: true });
      if (selected) {
        // In a real app we'd scan the directory recursively
        const file = selected as string;
        setQueue(q => [...q, `Batch: ${file}`]);
        convertAsset(file, true);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const convertAsset = async (path: string, isBatch = false) => {
    addLog(`Starting conversion for: ${path}`, 'info');
    try {
      await invoke('convert_asset', { path, isBatch });
      addLog(`Conversion successful: ${path}`, 'success');
      // Remove from queue and refresh library
      setQueue(q => q.filter(item => item !== path && item !== `Batch: ${path}`));
      loadAssets();
    } catch (e) {
      console.error('Conversion failed', e);
      addLog(`Conversion failed for ${path}:\n${e}`, 'error');
      setQueue(q => q.filter(item => item !== path && item !== `Batch: ${path}`));
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="brand">Universal USD Converter</div>
        
        <button className="btn" onClick={handleImportAsset}>
          <span>+</span> Import Asset
        </button>
        <button className="btn btn-secondary" onClick={handleImportFolder}>
          <span>📁</span> Import Folder
        </button>
        
        <div className="conversion-queue">
          <div className="queue-title">Conversion Queue</div>
          {queue.length === 0 && <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>No active conversions</div>}
          {queue.map((item, idx) => (
            <div key={idx} className="queue-item">
              <div style={{ fontSize: '12px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Converting: {item.split(/[\\/]/).pop()}
              </div>
            </div>
          ))}
        </div>

        <button className="btn btn-secondary" style={{ marginTop: 'auto' }} onClick={() => setLogsOpen(true)}>
          📝 Debug Logs
        </button>
        <button className="btn btn-secondary" onClick={() => setSettingsOpen(true)}>
          ⚙ Settings
        </button>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <LibraryView assets={assets} />
      </div>

      {/* Settings Modal */}
      <div className={`modal-overlay ${settingsOpen ? 'open' : ''}`}>
        <div className="modal-content">
          <h2 className="modal-title">Settings</h2>
          
          <div className="input-group">
            <label>Blender Executable Path</label>
            <input 
              type="text" 
              value={settings.blender_path}
              onChange={e => setSettings({...settings, blender_path: e.target.value})}
              placeholder='C:\Program Files\Blender Foundation\Blender 4.3\blender.exe'
            />
          </div>

          <div className="input-group">
            <label>Library Location</label>
            <input 
              type="text" 
              value={settings.library_path}
              onChange={e => setSettings({...settings, library_path: e.target.value})}
              placeholder="Path to save converted assets"
            />
          </div>

          <div className="input-group">
            <label>Debug .blend Save Directory (Optional)</label>
            <input 
              type="text" 
              value={settings.debug_blend_path}
              onChange={e => setSettings({...settings, debug_blend_path: e.target.value})}
              placeholder="e.g. C:\Users\priya\Desktop\Blender_Debug"
            />
          </div>

          <div className="input-group">
            <label>Gemini API Key (Optional, for AI Texture Mapping)</label>
            <input 
              type="password" 
              value={settings.gemini_api_key}
              onChange={e => setSettings({...settings, gemini_api_key: e.target.value})}
              placeholder="AIzaSy..."
            />
          </div>

          <button className="btn" onClick={handleSaveSettings}>Save Settings</button>
        </div>
      </div>

      {/* Debug Logs Modal */}
      <div className={`modal-overlay logs-modal ${logsOpen ? 'open' : ''}`}>
        <div className="modal-content">
          <h2 className="modal-title">Debug Logs</h2>
          
          <div className="logs-container">
            {logs.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No logs yet.</div>}
            {logs.map((log, idx) => (
              <div key={idx} className={`log-entry ${log.type}`}>
                <span className="log-time">[{log.timestamp}]</span>
                <span>{log.message}</span>
              </div>
            ))}
          </div>

          <button className="btn" onClick={() => setLogsOpen(false)}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default App;
