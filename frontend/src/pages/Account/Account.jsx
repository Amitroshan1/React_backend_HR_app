import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, FileText, TrendingUp, Download, 
  Send, Calculator, ChevronDown, ChevronRight, 
  ArrowLeft, Upload, Search 
} from 'lucide-react';
import './Account.css';

export const Account = ()  => {
  const [currentView, setCurrentView] = useState('main');
  const [expandedDept, setExpandedDept] = useState(null);
  const [selectedCircle, setSelectedCircle] = useState('');
  const [selectedDept, setSelectedDept] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [employeesList, setEmployeesList] = useState([]);
  const [payrollSummary, setPayrollSummary] = useState([]);
  const [payrollError, setPayrollError] = useState('');
  const [statsData, setStatsData] = useState({
    total_employees: 0,
    employees_paid: 0,
    payslips_generated: 0,
    ytd_expenses: 0
  });
  const [statsError, setStatsError] = useState('');
  
  // Form States
  const [payslipMonth, setPayslipMonth] = useState('January');
  const [payslipYear, setPayslipYear] = useState('2024');

  const API_BASE_URL = '/api/accounts';

  const formatCurrency = (value) => {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0);
    } catch {
      return `$${value || 0}`;
    }
  };

  const paidRatio = statsData.total_employees
    ? `${statsData.employees_paid}/${statsData.total_employees}`
    : `${statsData.employees_paid}`;

  const stats = [
    { title: 'Total Employees', value: statsData.total_employees, subtitle: 'Active employees', icon: <Users size={20} /> },
    { title: 'Employees Paid', value: paidRatio, subtitle: 'Current month', icon: <DollarSign size={20} /> },
    { title: 'Payslips Generated', value: statsData.payslips_generated, subtitle: 'Current month', icon: <FileText size={20} /> },
    { title: 'Expense Claims', value: formatCurrency(statsData.ytd_expenses), subtitle: 'YTD total', icon: <TrendingUp size={20} /> },
  ];

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const loadStats = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/payroll-summary`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Failed to load stats');
        }
        setStatsData(result.data || {});
        setStatsError('');
      } catch (error) {
        console.error('Payroll stats error:', error);
        setStatsError(error.message || 'Unable to load stats');
      }
    };

    loadStats();
  }, []);

  const loadPayrollSummary = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employee-type-circle-summary`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load payroll summary');
      }
      setPayrollSummary(result.data || []);
      setPayrollError('');
    } catch (error) {
      console.error('Payroll summary error:', error);
      setPayrollError(error.message || 'Unable to load payroll summary');
    }
  };

  useEffect(() => {
    loadPayrollSummary();
  }, []);

  const handleCircleSelect = async (dept, circle) => {
    setSelectedDept(dept);
    setSelectedCircle(circle);
    setCurrentView('employees');
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employees-by-type-circle?emp_type=${encodeURIComponent(dept)}&circle=${encodeURIComponent(circle)}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load employees');
      }
      const mapped = (result.employees || []).map(emp => ({
        id: emp.emp_id || emp.id,
        name: emp.first_name || 'N/A',
        email: emp.email || 'N/A',
        workingDays: '-',
        bank: 'N/A'
      }));
      setEmployeesList(mapped);
    } catch (error) {
      console.error('Employee list error:', error);
      setEmployeesList([]);
    }
  };

  const renderMainView = () => (
    <div className="fade-in">
      <div className="hr-stats-grid">
        {statsError && <div className="q-error">{statsError}</div>}
        {stats.map((stat, i) => (
          <div key={i} className="stat-card">
            <div>
              <p className="stat-label">{stat.title}</p>
              <h3 className="stat-value">{stat.value}</h3>
              <p className="stat-sub">{stat.subtitle}</p>
            </div>
            <div className="bg-updates">{stat.icon}</div>
          </div>
        ))}
      </div>

      <div className="accounts-grid">
        <div className="table-container-card">
          <div className="card-header-row">
            <h3 className="section-title">Payroll by Department</h3>
            <div className="header-actions">
              <button className="btn-outline-sm"><Download size={14} /> Export</button>
              <button className="btn-primary-sm"><Calculator size={14} /> Generate</button>
            </div>
          </div>

          <div className="table-responsive">
            <table className="results-table">
              <thead>
                <tr>
                  <th width="50"></th>
                  <th>Department</th>
                  <th>Circle Selection</th>
                  <th>Employees</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payrollError && (
                  <tr>
                    <td colSpan="5" className="empty">{payrollError}</td>
                  </tr>
                )}
                {payrollSummary.map((dept) => (
                  <React.Fragment key={dept.department}>
                    <tr>
                      <td>
                        <button 
                          className="btn-icon"
                          onClick={() => setExpandedDept(expandedDept === dept.department ? null : dept.department)}
                        >
                          {expandedDept === dept.department ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                        </button>
                      </td>
                      <td className="font-bold">{dept.department}</td>
                      <td>
                        <select 
                          className="table-select"
                          onChange={(e) => handleCircleSelect(dept.department, e.target.value)}
                          value=""
                        >
                          <option value="" disabled>Select Circle</option>
                          {(dept.circles || []).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td>{dept.employees}</td>
                      <td>
                        <span className="badge-processed">active</span>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="side-panel">
          <div className="stat-card-static">
            <h4>Payroll Progress</h4>
            <div className="progress-item">
              <div className="flex-between"><span>Bank Transfer</span><span>85%</span></div>
              <div className="progress-bar"><div className="progress-fill" style={{width: '85%'}}></div></div>
            </div>
            <div className="progress-item">
              <div className="flex-between"><span>Payslips Sent</span><span>92%</span></div>
              <div className="progress-bar"><div className="progress-fill" style={{width: '92%'}}></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderEmployeesView = () => (
    <div className="fade-in">
      <button className="btn-back" onClick={() => setCurrentView('main')}>
        <ArrowLeft size={18} /> Back to Dashboard
      </button>
      
      <div className="table-container-card">
        <div className="card-header-row">
          <h3 className="section-title">Results: {selectedCircle} - {selectedDept}</h3>
        </div>
        
        <div className="table-responsive">
          <table className="results-table">
            <thead className="thead-teal">
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Bank Details</th>
                <th>Update</th>
                <th>Form 16</th>
                <th>Working Days</th>
              </tr>
            </thead>
            <tbody>
              {employeesList.map(emp => (
                <tr key={emp.id}>
                  <td className="font-bold">{emp.name}</td>
                  <td>{emp.email}</td>
                  <td><button className="text-link" onClick={() => {setSelectedEmployee(emp); setCurrentView('viewPayslip')}}>View</button></td>
                  <td><button className="text-link" onClick={() => {setSelectedEmployee(emp); setCurrentView('addPayslip')}}>Add Payslip</button></td>
                  <td><button className="btn-icon-text"><Download size={14}/> PDF</button></td>
                  <td>{emp.workingDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="results-actions-grid">
           <button className="btn-success"><Download size={16}/> Attendance Excel</button>
           <button className="btn-warning"><Upload size={16}/> Bulk Payslips</button>
           <button className="btn-primary"><Upload size={16}/> Bulk Form 16</button>
        </div>
      </div>
    </div>
  );

  const renderAddPayslip = () => (
    <div className="form-container-centered fade-in">
      <div className="hr-search-card small-width">
        <h3 className="section-title text-center">Add Payslip for {selectedEmployee?.name}</h3>
        <div className="input-group">
          <label>Month</label>
          <select className="custom-select" value={payslipMonth} onChange={(e) => setPayslipMonth(e.target.value)}>
            <option>January</option><option>February</option>
          </select>
        </div>
        <div className="input-group">
          <label>Year</label>
          <select className="custom-select" value={payslipYear} onChange={(e) => setPayslipYear(e.target.value)}>
            <option>2024</option><option>2023</option>
          </select>
        </div>
        <div className="input-group">
          <label>File Upload</label>
          <input type="file" className="custom-input-file" />
        </div>
        <div className="form-actions-row">
          <button className="btn-primary full-width">Upload Payslip</button>
          <button className="btn-outline full-width" onClick={() => setCurrentView('employees')}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="hr-main-container">
      <div className="page-header">
        <h1 className="main-title">Accounts & Payroll</h1>
        <p className="sub-title">Monitor and manage company financial operations</p>
      </div>

      {currentView === 'main' && renderMainView()}
      {currentView === 'employees' && renderEmployeesView()}
      {currentView === 'addPayslip' && renderAddPayslip()}
      {currentView === 'viewPayslip' && (
         <div className="fade-in">
            <button className="btn-back" onClick={() => setCurrentView('employees')}><ArrowLeft size={18}/> Back</button>
            <div className="stat-card">
                <h3>{selectedEmployee?.name}'s Bank Details</h3>
                <p>Account: {selectedEmployee?.bank}</p>
            </div>
         </div>
      )}
    </div>
  );
}