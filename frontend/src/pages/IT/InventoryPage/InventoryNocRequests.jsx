import { useState } from 'react';
import { DepartmentNocPanel } from '../../Manager/comps/DepartmentNocPanel';
import './InventoryNocRequests.css';

export default function InventoryNocRequests() {
  const [statusFilter, setStatusFilter] = useState('Pending');

  return (
    <div className="inv-noc">
      <header className="inv-noc__head">
        <div>
          <p>Inventory clearance</p>
          <h1>NOC requests</h1>
          <span>Asset return clearance for leavers. This queue is only Inventory, not IT.</span>
        </div>
        <div className="inv-noc__filters">
          {['Pending', 'Uploaded', 'All'].map((key) => (
            <button
              key={key}
              type="button"
              className={statusFilter === key ? 'is-on' : ''}
              onClick={() => setStatusFilter(key)}
            >
              {key === 'Uploaded' ? 'Cleared' : key}
            </button>
          ))}
        </div>
      </header>

      <section className="inv-noc__body">
        <DepartmentNocPanel
          apiBase="/api/it/inventory"
          statusFilter={statusFilter}
          variant="table"
          ownOnly
        />
      </section>
    </div>
  );
}
