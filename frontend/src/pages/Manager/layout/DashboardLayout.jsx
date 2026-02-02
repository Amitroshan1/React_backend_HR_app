// src/layout/DashboardLayout.jsx
import { useState } from 'react';
import Sidebar from '../components/Sidebar/Sidebar';
import './DashboardLayout.css';

const DashboardLayout = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => setSidebarOpen(!sidebarOpen);

  return (
    <div className="dashboard-layout">
      <Sidebar isOpen={sidebarOpen} toggleSidebar={toggleSidebar} />

      <main className={`main-content ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <button className="mobile-menu-btn" onClick={toggleSidebar}>
          ☰
        </button>
        {children}
      </main>

      {sidebarOpen && <div className="overlay" onClick={toggleSidebar}></div>}
    </div>
  );
};

export default DashboardLayout;