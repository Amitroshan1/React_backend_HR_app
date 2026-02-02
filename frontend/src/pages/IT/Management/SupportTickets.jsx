import React, { useState, useMemo } from 'react';
import styles from './SupportTickets.module.css';
import { ArrowLeft, Plus, Search, Eye, Edit2 } from 'lucide-react';

const SupportTickets = ({ onBack }) => {
  // 1. Initial State for Tickets
  const [tickets, setTickets] = useState([
    { id: 'IT-001', title: 'VPN Connection Issue', requester: 'John Employee', date: '2024-01-05', priority: 'High', status: 'In Progress' },
    { id: 'IT-002', title: 'Software Installation Request', requester: 'Emily HR', date: '2024-01-04', priority: 'Medium', status: 'Open' },
    { id: 'IT-003', title: 'Email Not Syncing', requester: 'Mike Accountant', date: '2024-01-04', priority: 'High', status: 'In Progress' },
    { id: 'IT-004', title: 'New Laptop Setup', requester: 'Sarah Manager', date: '2024-01-03', priority: 'Low', status: 'Open' },
  ]);

  // 2. Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All Priority');
  const [statusFilter, setStatusFilter] = useState('All Status');

  // 3. Dynamic Filtering Logic
  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesSearch = ticket.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                           ticket.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPriority = priorityFilter === 'All Priority' || ticket.priority === priorityFilter;
      const matchesStatus = statusFilter === 'All Status' || ticket.status === statusFilter;
      
      return matchesSearch && matchesPriority && matchesStatus;
    });
  }, [tickets, searchQuery, priorityFilter, statusFilter]);

  return (
    <div className={styles.container}>
      <button onClick={onBack} className={styles.backBtn}>
        <ArrowLeft size={18} /> Support Tickets
      </button>

      <div className={styles.contentCard}>
        <div className={styles.header}>
          <h2>All Support Tickets</h2>
          <button className={styles.createBtn} onClick={() => alert('Opening Create Ticket form...')}>
            <Plus size={18} /> Create Ticket
          </button>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.searchWrapper}>
            <Search size={16} className={styles.searchIcon} />
            <input 
              type="text" 
              placeholder="Search tickets..." 
              className={styles.searchInput}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <select className={styles.selectInput} value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value)}>
            <option>All Priority</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>

          <select className={styles.selectInput} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option>All Status</option>
            <option>Open</option>
            <option>In Progress</option>
            <option>Resolved</option>
          </select>
        </div>

        <div className={styles.ticketList}>
          {filteredTickets.length > 0 ? (
            filteredTickets.map((ticket) => (
              <div key={ticket.id} className={styles.ticketCard}>
                <div className={styles.ticketMain}>
                  <div className={styles.ticketMeta}>
                    <span className={styles.ticketId}>{ticket.id}</span>
                    <span className={`${styles.badge} ${styles[ticket.priority.toLowerCase()]}`}>
                      {ticket.priority}
                    </span>
                    <span className={`${styles.badge} ${styles.statusBadge}`}>
                      {ticket.status}
                    </span>
                  </div>
                  <h3 className={styles.ticketTitle}>{ticket.title}</h3>
                  <p className={styles.ticketSub}>From: {ticket.requester} • {ticket.date}</p>
                </div>
                
                <div className={styles.ticketActions}>
                  <button className={styles.viewBtn}>View</button>
                  <button className={styles.editBtn}><Edit2 size={14} /></button>
                </div>
              </div>
            ))
          ) : (
            <div className={styles.noResults}>No tickets found for current filters.</div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SupportTickets;