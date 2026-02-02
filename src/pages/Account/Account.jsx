import React, { useState } from 'react';
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
  
  // Form States
  const [payslipMonth, setPayslipMonth] = useState('January');
  const [payslipYear, setPayslipYear] = useState('2024');

  const stats = [
    { title: 'Total Payroll', value: '$2.1M', subtitle: 'This month', icon: <DollarSign size={20} /> },
    { title: 'Employees Paid', value: '245/248', subtitle: '98.8% processed', icon: <Users size={20} /> },
    { title: 'Payslips Generated', value: '248', subtitle: 'All generated', icon: <FileText size={20} /> },
    { title: 'YTD Expenses', value: '$18.5M', subtitle: '+8% from last year', icon: <TrendingUp size={20} /> },
  ];

  // Mock Data
  const payrollSummary = [
    { 
      department: 'Engineering', employees: 85, amount: '$850,000', status: 'processed',
      circles: ['NHQ', 'Mumbai', 'Delhi']
    },
    { 
      department: 'HR', employees: 18, amount: '$180,000', status: 'processed',
      circles: ['NHQ', 'Pune']
    },
    { 
      department: 'Marketing', employees: 35, amount: '$280,000', status: 'pending',
      circles: ['NHQ', 'Chennai']
    }
  ];

  const employeesList = [
    { id: 'E001', name: 'Rahul Sharma', email: 'rsharma@company.com', workingDays: 22, bank: 'HDFC Bank - ...1234' },
    { id: 'E002', name: 'Prajukta Podili', email: 'ppodili@company.com', workingDays: 21, bank: 'ICICI Bank - ...5678' },
  ];

  const handleCircleSelect = (dept, circle) => {
    setSelectedDept(dept);
    setSelectedCircle(circle);
    setCurrentView('employees');
  };

  const renderMainView = () => (
    <div className="fade-in">
      <div className="hr-stats-grid">
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
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
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
                          {dept.circles.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td>{dept.employees}</td>
                      <td className="text-success font-bold">{dept.amount}</td>
                      <td>
                        <span className={`badge-${dept.status}`}>{dept.status}</span>
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