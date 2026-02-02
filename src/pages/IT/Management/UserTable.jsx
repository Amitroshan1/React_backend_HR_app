import React from 'react';
import styles from './UserTable.module.css';
import { ArrowLeft, Plus, Search, MoreVertical, Edit2, Trash2 } from 'lucide-react';
import Badge from '../UI/Badge';

const UserTable = ({ onBack }) => {
  const users = [
    { id: 1, name: 'John Doe', email: 'john@company.com', role: 'Admin', status: 'active', lastLogin: '2 mins ago' },
    { id: 2, name: 'Sarah Smith', email: 'sarah@company.com', role: 'HR Manager', status: 'active', lastLogin: '1 hour ago' },
    { id: 3, name: 'Mike Ross', email: 'mike@company.com', role: 'Employee', status: 'inactive', lastLogin: '2 days ago' },
    { id: 4, name: 'Rachel Zane', email: 'rachel@company.com', role: 'Manager', status: 'active', lastLogin: '5 mins ago' },
  ];

  return (
    <div className={styles.container}>
      {/* Back Header */}
      <div className={styles.navigation}>
        <button onClick={onBack} className={styles.backBtn}>
          <ArrowLeft size={18} /> Back to Dashboard
        </button>
      </div>

      <div className={styles.contentHeader}>
        <div>
          <h2 className={styles.title}>User Management</h2>
          <p className={styles.subtitle}>View and manage all system users and their access levels.</p>
        </div>
        <button className={styles.addBtn}>
          <Plus size={18} /> Add New User
        </button>
      </div>

      {/* Table Card */}
      <div className={styles.tableWrapper}>
        <div className={styles.tableControls}>
          <div className={styles.searchBox}>
            <Search size={18} />
            <input type="text" placeholder="Search by name or email..." />
          </div>
        </div>

        <table className={styles.userTable}>
          <thead>
            <tr>
              <th>User Info</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Login</th>
              <th className={styles.centerText}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td className={styles.userInfo}>
                  <div className={styles.avatar}>{user.name.charAt(0)}</div>
                  <div>
                    <div className={styles.userName}>{user.name}</div>
                    <div className={styles.userEmail}>{user.email}</div>
                  </div>
                </td>
                <td><span className={styles.roleText}>{user.role}</span></td>
                <td>
                  <Badge type={user.status}>{user.status}</Badge>
                </td>
                <td className={styles.timeText}>{user.lastLogin}</td>
                <td className={styles.actions}>
                  <button className={styles.iconBtn}><Edit2 size={16}/></button>
                  <button className={styles.iconBtn}><Trash2 size={16}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default UserTable;