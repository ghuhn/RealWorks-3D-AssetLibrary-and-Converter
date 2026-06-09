import { useState } from 'react';
import { Asset } from '../App';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';

interface Props {
  assets: Asset[];
}

export default function LibraryView({ assets }: Props) {
  const [search, setSearch] = useState('');
  
  const filteredAssets = assets.filter(a => 
    a.name.toLowerCase().includes(search.toLowerCase()) || 
    a.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="header">
        <h1 style={{ margin: 0, fontSize: '28px' }}>Asset Library</h1>
        <input 
          type="text" 
          className="search-bar" 
          placeholder="Search by name or category..." 
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="library-grid">
        {filteredAssets.map(asset => (
          <div key={asset.id} className="asset-card">
            <div className="asset-thumb">
              {asset.thumbnail ? (
                <img 
                  src={convertFileSrc(asset.thumbnail)} 
                  alt={asset.name} 
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).parentElement!.innerHTML = '<span style="color:var(--text-secondary)">No Thumbnail</span>';
                  }}
                />
              ) : (
                <span style={{ color: 'var(--text-secondary)' }}>No Thumbnail</span>
              )}
            </div>
            <div className="asset-info">
              <h3 className="asset-name">{asset.name}</h3>
              <p className="asset-category">{asset.category}</p>
            </div>
          </div>
        ))}

        {filteredAssets.length === 0 && (
          <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)', padding: '40px' }}>
            No assets found. Import something to get started!
          </div>
        )}
      </div>
    </div>
  );
}
