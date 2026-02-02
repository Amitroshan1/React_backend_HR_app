import React, { useState, useMemo } from 'react';
import styles from './AssetManagement.module.css';
import { ArrowLeft, Plus, Search, Edit2, Trash2 } from 'lucide-react';

const AssetManagement = ({ onBack }) => {
  // 1. Dynamic Data State
  const [assets, setAssets] = useState([
    { id: 'AST-001', name: 'Dell Laptop XPS 15', type: 'Laptop', assigned: 'John Employee', status: 'Assigned' },
    { id: 'AST-002', name: 'HP Monitor 27"', type: 'Monitor', assigned: 'Emily HR', status: 'Assigned' },
    { id: 'AST-003', name: 'Logitech Keyboard', type: 'Peripheral', assigned: '-', status: 'Available' },
    { id: 'AST-004', name: 'MacBook Pro 16"', type: 'Laptop', assigned: 'Sarah Manager', status: 'Assigned' },
  ]);

  // 2. Filter & Search States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('All');

  // 3. Dynamic Filtering Logic
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           asset.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType = filterType === 'All' || asset.type === filterType;
      return matchesSearch && matchesType;
    });
  }, [assets, searchQuery, filterType]);

  // 4. Action Handlers
  const handleDelete = (id) => {
    if (window.confirm('Are you sure you want to remove this asset?')) {
      setAssets(assets.filter(a => a.id !== id));
    }
  };

  return (
    <div className={styles.container}>
      <button onClick={onBack} className={styles.backBtn}>
        <ArrowLeft size={18} /> Asset Management
      </button>

      <div className={styles.contentCard}>
        <div className={styles.header}>
          <h2>IT Assets</h2>
          <button className={styles.addBtn} onClick={() => alert('Opening Add Asset Modal...')}>
            <Plus size={18} /> Add Asset
          </button>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.searchWrapper}>
            <Search size={16} className={styles.searchIcon} />
            <input 
              type="text" 
              placeholder="Search by name or ID..." 
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <select 
            className={styles.selectInput} 
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
          >
            <option value="All">All Types</option>
            <option value="Laptop">Laptop</option>
            <option value="Monitor">Monitor</option>
            <option value="Peripheral">Peripheral</option>
          </select>
        </div>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Asset ID</th>
              <th>Name</th>
              <th>Type</th>
              <th>Assigned To</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredAssets.length > 0 ? (
              filteredAssets.map((asset) => (
                <tr key={asset.id} className={styles.tableRow}>
                  <td><strong>{asset.id}</strong></td>
                  <td>{asset.name}</td>
                  <td>{asset.type}</td>
                  <td className={styles.assignedName}>{asset.assigned}</td>
                  <td>
                    <span className={asset.status === 'Available' ? styles.statusAvailable : styles.statusAssigned}>
                      {asset.status}
                    </span>
                  </td>
                  <td className={styles.actions}>
                    <button className={styles.actionBtn} title="Edit"><Edit2 size={14} /></button>
                    <button 
                      className={`${styles.actionBtn} ${styles.delete}`} 
                      onClick={() => handleDelete(asset.id)}
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="6" className={styles.noResults}>No assets found matching your criteria.</td>
              </tr>
            )}
          </tbody>
        </table>
        
        <div className={styles.footerStats}>
          Showing {filteredAssets.length} of {assets.length} total assets
        </div>
      </div>
    </div>
  );
};

export default AssetManagement;