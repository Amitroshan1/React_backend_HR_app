import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, FileText, TrendingUp, Download, 
  Send, Calculator, ChevronDown, ChevronRight, 
  ArrowLeft, Upload, Search 
} from 'lucide-react';
import './Account.css';

export const Account = ()  => {
  const getStoredAccountContext = () => {
    try {
      return JSON.parse(localStorage.getItem('account_form16_context') || '{}');
    } catch {
      return {};
    }
  };

  const initialAccountContext = getStoredAccountContext();
  const [currentView, setCurrentView] = useState(() => localStorage.getItem('account_current_view') || 'main');
  const [expandedDept, setExpandedDept] = useState(null);
  const [selectedCircle, setSelectedCircle] = useState(initialAccountContext.selectedCircle || '');
  const [selectedDept, setSelectedDept] = useState(initialAccountContext.selectedDept || '');
  const [selectedEmployee, setSelectedEmployee] = useState(initialAccountContext.selectedEmployee || null);
  const [previousView, setPreviousView] = useState('employees');
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
  const [attendanceMonth, setAttendanceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attendancePickerOpen, setAttendancePickerOpen] = useState(false);
  const [pendingAttendanceMonth, setPendingAttendanceMonth] = useState(attendanceMonth);
  const [attendanceDownloadMode, setAttendanceDownloadMode] = useState('accounts'); // 'accounts' or 'client'
  
  // Form States
  const [payslipMonth, setPayslipMonth] = useState('January');
  const [payslipYear, setPayslipYear] = useState('2024');
  const [payslipFile, setPayslipFile] = useState(null);
  const [isPayslipUploading, setIsPayslipUploading] = useState(false);
  const [payslipHistory, setPayslipHistory] = useState([]);
  const [payslipHistoryLoading, setPayslipHistoryLoading] = useState(false);
  const [payslipHistoryError, setPayslipHistoryError] = useState('');
  const [bulkPayslipMonth, setBulkPayslipMonth] = useState('January');
  const [bulkPayslipYear, setBulkPayslipYear] = useState(String(new Date().getFullYear()));
  const [bulkPayslipFiles, setBulkPayslipFiles] = useState([]);
  const [isBulkUploading, setIsBulkUploading] = useState(false);
  const [bulkUploadResult, setBulkUploadResult] = useState(null);
  const [bulkForm16Year, setBulkForm16Year] = useState(`${new Date().getFullYear()}-${new Date().getFullYear() + 1}`);
  const [bulkForm16Files, setBulkForm16Files] = useState([]);
  const [isBulkForm16Uploading, setIsBulkForm16Uploading] = useState(false);
  const [bulkForm16UploadResult, setBulkForm16UploadResult] = useState(null);
  const [form16FinancialYear, setForm16FinancialYear] = useState('');
  const [form16File, setForm16File] = useState(null);
  const [isForm16Uploading, setIsForm16Uploading] = useState(false);
  const [form16History, setForm16History] = useState([]);
  const [form16HistoryLoading, setForm16HistoryLoading] = useState(false);
  const [form16HistoryError, setForm16HistoryError] = useState('');

  const API_BASE_URL = '/api/accounts';

  useEffect(() => {
    localStorage.setItem('account_current_view', currentView);
  }, [currentView]);

  useEffect(() => {
    localStorage.setItem('account_form16_context', JSON.stringify({
      selectedDept,
      selectedCircle,
      selectedEmployee
    }));
  }, [selectedDept, selectedCircle, selectedEmployee]);

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

  const handleCircleSelect = async (dept, circle, switchView = true) => {
    setSelectedDept(dept);
    setSelectedCircle(circle);
    if (switchView) {
      setCurrentView('employees');
    }
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
        adminId: emp.id,
        name: emp.first_name || 'N/A',
        email: emp.email || 'N/A',
        workingDays: emp.working_days ?? '-',
        bank: emp.bank_details_path || 'N/A',
        bankDetailsAvailable: !!emp.bank_details_available,
        form16Available: !!emp.form16_available,
        form16Path: emp.form16_path || null,
        documents: emp.documents || {}
      }));
      setEmployeesList(mapped);
    } catch (error) {
      console.error('Employee list error:', error);
      setEmployeesList([]);
    }
  };

  const buildFileUrl = (filePath) => {
    if (!filePath) return null;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
    const normalized = filePath.replace(/^\/+/, '');
    return `${API_BASE_URL}/file/${normalized}`;
  };

  const handleDownloadAttendanceExcel = () => {
    if (!selectedDept || !selectedCircle) {
      alert('Please select department and circle first.');
      return;
    }
    setAttendanceDownloadMode('accounts');
    setPendingAttendanceMonth(attendanceMonth);
    setAttendancePickerOpen(true);
  };

  const handleDownloadClientAttendanceExcel = () => {
    if (!selectedDept || !selectedCircle) {
      alert('Please select department and circle first.');
      return;
    }
    setAttendanceDownloadMode('client');
    setPendingAttendanceMonth(attendanceMonth);
    setAttendancePickerOpen(true);
  };

  const handleConfirmAttendanceExcelDownload = async () => {
    if (!pendingAttendanceMonth) {
      alert('Please select month.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    const monthParam = pendingAttendanceMonth;
    const endpoint =
      attendanceDownloadMode === 'client' ? '/download-excel-client' : '/download-excel';
    const url = `${API_BASE_URL}${endpoint}?emp_type=${encodeURIComponent(
      selectedDept
    )}&circle=${encodeURIComponent(selectedCircle)}&month=${monthParam}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('application/json')) {
        let message = 'Unable to download attendance excel';
        try {
          const err = await response.json();
          message = err.message || message;
        } catch {
          // Keep fallback message.
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
      const fileName = match ? decodeURIComponent(match[1].replace(/"/g, '')) : `ACC_Attendance_${selectedCircle}_${selectedDept}.xlsx`;

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
      setAttendanceMonth(pendingAttendanceMonth);
      setAttendancePickerOpen(false);
    } catch (error) {
      console.error('Attendance excel error:', error);
      alert(error.message || 'Unable to download attendance excel');
    }
  };

  const formatDateTime = (value) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString();
  };

  const getUploadedOnFromPath = (filePath) => {
    if (!filePath) return '-';
    const match = filePath.match(/_(\d{14})_/);
    if (!match) return '-';
    const ts = match[1];
    const yyyy = ts.slice(0, 4);
    const mm = ts.slice(4, 6);
    const dd = ts.slice(6, 8);
    const hh = ts.slice(8, 10);
    const mi = ts.slice(10, 12);
    const ss = ts.slice(12, 14);
    const dt = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleString();
  };

  const handleViewBankDetails = async (emp) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/employee-documents/${emp.adminId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to fetch documents');
      }
      setSelectedEmployee({
        ...emp,
        documents: result.documents || {},
        form16Path: result.form16_path || emp.form16Path || null
      });
      setCurrentView('viewPayslip');
    } catch (error) {
      console.error('Document fetch error:', error);
      setSelectedEmployee(emp);
      setCurrentView('viewPayslip');
    }
  };

  const loadForm16History = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) {
      setForm16History([]);
      setForm16HistoryError('');
      return;
    }

    try {
      setForm16HistoryLoading(true);
      setForm16HistoryError('');
      const response = await fetch(`${API_BASE_URL}/form16/history/${adminId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load Form 16 history');
      }
      setForm16History(result.history || []);
    } catch (error) {
      console.error('Form 16 history error:', error);
      setForm16History([]);
      setForm16HistoryError(error.message || 'Unable to load Form 16 history');
    } finally {
      setForm16HistoryLoading(false);
    }
  };

  useEffect(() => {
    if (currentView === 'addForm16' && selectedEmployee?.adminId) {
      loadForm16History(selectedEmployee.adminId);
    }
    if (currentView === 'addPayslip' && selectedEmployee?.adminId) {
      loadPayslipHistory(selectedEmployee.adminId);
    }
  }, []);

  useEffect(() => {
    if (currentView === 'employees' && selectedDept && selectedCircle && employeesList.length === 0) {
      handleCircleSelect(selectedDept, selectedCircle, false);
    }
  }, [currentView, selectedDept, selectedCircle]);

  const handleAddForm16Click = (emp) => {
    const currentYear = new Date().getFullYear();
    setPreviousView(currentView);
    setSelectedEmployee(emp);
    setForm16FinancialYear(`${currentYear}-${currentYear + 1}`);
    setForm16File(null);
    setForm16History([]);
    setForm16HistoryError('');
    setCurrentView('addForm16');
    loadForm16History(emp.adminId);
  };

  const loadPayslipHistory = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) {
      setPayslipHistory([]);
      setPayslipHistoryError('');
      return;
    }

    try {
      setPayslipHistoryLoading(true);
      setPayslipHistoryError('');
      const response = await fetch(`${API_BASE_URL}/payslip/history/${adminId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load payslip history');
      }
      setPayslipHistory(result.history || []);
    } catch (error) {
      console.error('Payslip history error:', error);
      setPayslipHistory([]);
      setPayslipHistoryError(error.message || 'Unable to load payslip history');
    } finally {
      setPayslipHistoryLoading(false);
    }
  };

  const handleAddPayslipClick = (emp) => {
    const currentYear = String(new Date().getFullYear());
    setPreviousView(currentView);
    setSelectedEmployee(emp);
    setPayslipMonth('January');
    setPayslipYear(currentYear);
    setPayslipFile(null);
    setPayslipHistory([]);
    setPayslipHistoryError('');
    setCurrentView('addPayslip');
    loadPayslipHistory(emp.adminId);
  };

  const handleUploadPayslip = async () => {
    if (!selectedEmployee?.adminId) {
      alert('Employee not selected.');
      return;
    }
    if (!payslipMonth || !payslipYear.trim()) {
      alert('Please select month and year.');
      return;
    }
    if (!payslipFile) {
      alert('Please choose a payslip file.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    const payload = new FormData();
    payload.append('admin_id', selectedEmployee.adminId);
    payload.append('month', payslipMonth);
    payload.append('year', payslipYear.trim());
    payload.append('payslip_file', payslipFile);

    try {
      setIsPayslipUploading(true);
      const response = await fetch(`${API_BASE_URL}/payslip/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: payload
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to upload payslip');
      }

      alert('Payslip uploaded successfully');
      setPayslipFile(null);
      await loadPayslipHistory(selectedEmployee.adminId);
      await handleCircleSelect(selectedDept, selectedCircle, false);
    } catch (error) {
      console.error('Payslip upload error:', error);
      alert(error.message || 'Unable to upload payslip');
    } finally {
      setIsPayslipUploading(false);
    }
  };

  const handleOpenBulkPayslip = () => {
    setPreviousView(currentView);
    setBulkPayslipMonth('January');
    setBulkPayslipYear(String(new Date().getFullYear()));
    setBulkPayslipFiles([]);
    setBulkUploadResult(null);
    setCurrentView('bulkPayslip');
  };

  const handleBulkPayslipUpload = async () => {
    if (!bulkPayslipMonth || !bulkPayslipYear.trim()) {
      alert('Please select month and year.');
      return;
    }
    if (!bulkPayslipFiles.length) {
      alert('Please select one or more files.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    try {
      setIsBulkUploading(true);
      const payload = new FormData();
      payload.append('month', bulkPayslipMonth);
      payload.append('year', bulkPayslipYear.trim());
      bulkPayslipFiles.forEach((file) => payload.append('payslip_files', file));

      const response = await fetch(`${API_BASE_URL}/payslip/bulk-upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: payload
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Bulk upload failed');
      }

      const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
      const emailFailCount = Array.isArray(result.email_failures) ? result.email_failures.length : 0;
      setBulkUploadResult({
        uploadedCount: result.uploaded_count || 0,
        unmatchedFiles: result.unmatched_files || [],
        emailFailures: result.email_failure_details || []
      });
      alert(
        `Bulk upload complete.\nUploaded: ${result.uploaded_count || 0}\nUnmatched files: ${errorCount}\nEmail failures: ${emailFailCount}`
      );
      setBulkPayslipFiles([]);
    } catch (error) {
      console.error('Bulk payslip upload error:', error);
      alert(error.message || 'Bulk upload failed');
    } finally {
      setIsBulkUploading(false);
    }
  };

  const handleOpenBulkForm16 = () => {
    const currentYear = new Date().getFullYear();
    setPreviousView(currentView);
    setBulkForm16Year(`${currentYear}-${currentYear + 1}`);
    setBulkForm16Files([]);
    setBulkForm16UploadResult(null);
    setCurrentView('bulkForm16');
  };

  const handleBulkForm16Upload = async () => {
    if (!bulkForm16Year.trim()) {
      alert('Please enter financial year.');
      return;
    }
    if (!bulkForm16Files.length) {
      alert('Please select one or more files.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    try {
      setIsBulkForm16Uploading(true);
      const payload = new FormData();
      payload.append('financial_year', bulkForm16Year.trim());
      bulkForm16Files.forEach((file) => payload.append('form16_files', file));

      const response = await fetch(`${API_BASE_URL}/form16/bulk-upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: payload
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Bulk Form16 upload failed');
      }

      const errorCount = Array.isArray(result.errors) ? result.errors.length : 0;
      const emailFailCount = Array.isArray(result.email_failures) ? result.email_failures.length : 0;
      setBulkForm16UploadResult({
        uploadedCount: result.uploaded_count || 0,
        unmatchedFiles: result.unmatched_files || [],
        emailFailures: result.email_failure_details || []
      });
      alert(
        `Bulk Form16 upload complete.\nUploaded: ${result.uploaded_count || 0}\nUnmatched files: ${errorCount}\nEmail failures: ${emailFailCount}`
      );
      setBulkForm16Files([]);
    } catch (error) {
      console.error('Bulk Form16 upload error:', error);
      alert(error.message || 'Bulk Form16 upload failed');
    } finally {
      setIsBulkForm16Uploading(false);
    }
  };

  const handleUploadForm16 = async () => {
    if (!selectedEmployee?.adminId) {
      alert('Employee not selected.');
      return;
    }
    if (!form16FinancialYear.trim()) {
      alert('Please enter financial year.');
      return;
    }
    if (!form16File) {
      alert('Please choose a Form 16 file.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    const payload = new FormData();
    payload.append('admin_id', selectedEmployee.adminId);
    payload.append('financial_year', form16FinancialYear.trim());
    payload.append('form16_file', form16File);

    try {
      setIsForm16Uploading(true);
      const response = await fetch(`${API_BASE_URL}/form16/upload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`
        },
        body: payload
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to upload Form 16');
      }

      alert('Form 16 uploaded successfully');
      setForm16File(null);
      await loadForm16History(selectedEmployee.adminId);
      await handleCircleSelect(selectedDept, selectedCircle, false);
    } catch (error) {
      console.error('Form 16 upload error:', error);
      alert(error.message || 'Unable to upload Form 16');
    } finally {
      setIsForm16Uploading(false);
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
                  <td>
                    <button className="text-link" onClick={() => handleViewBankDetails(emp)}>
                      {emp.bankDetailsAvailable ? 'View' : 'View'}
                    </button>
                  </td>
                  <td><button className="text-link" onClick={() => handleAddPayslipClick(emp)}>Add Payslip</button></td>
                  <td>
                    <button
                      className="text-link"
                      onClick={() => handleAddForm16Click(emp)}
                    >
                      Add Form16
                    </button>
                  </td>
                  <td>{emp.workingDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="results-actions-grid">
           <button className="btn-success" onClick={handleDownloadAttendanceExcel}>
             <Download size={16}/> Attendance Excel
           </button>
           <button className="btn-secondary" onClick={handleDownloadClientAttendanceExcel}>
             <Download size={16}/> For Client
           </button>
           <button className="btn-warning" onClick={handleOpenBulkPayslip}><Upload size={16}/> Bulk Payslips</button>
           <button className="btn-primary" onClick={handleOpenBulkForm16}><Upload size={16}/> Bulk Form 16</button>
        </div>
      </div>
    </div>
  );

  const renderAddPayslip = () => (
    <div className="form16-page-stack fade-in">
      <button
        type="button"
        className="btn-back"
        onClick={() => setCurrentView(previousView || 'employees')}
      >
        <ArrowLeft size={18} /> Back
      </button>
      <div className="hr-search-card small-width">
        <h3 className="section-title text-center">Add Payslip for {selectedEmployee?.name}</h3>
        <div className="input-group">
          <label>Month</label>
          <select className="custom-select" value={payslipMonth} onChange={(e) => setPayslipMonth(e.target.value)}>
            <option>January</option><option>February</option><option>March</option><option>April</option>
            <option>May</option><option>June</option><option>July</option><option>August</option>
            <option>September</option><option>October</option><option>November</option><option>December</option>
          </select>
        </div>
        <div className="input-group">
          <label>Year</label>
          <input
            type="text"
            className="custom-input-file"
            placeholder="e.g. 2026"
            value={payslipYear}
            onChange={(e) => setPayslipYear(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>File Upload</label>
          <input
            type="file"
            className="custom-input-file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setPayslipFile(e.target.files?.[0] || null)}
          />
        </div>
        <div className="form-actions-row">
          <button
            type="button"
            className="btn-primary full-width"
            onClick={handleUploadPayslip}
            disabled={isPayslipUploading}
          >
            {isPayslipUploading ? 'Uploading...' : 'Upload Payslip'}
          </button>
          <button
            type="button"
            className="btn-outline full-width"
            onClick={() => setCurrentView('employees')}
            disabled={isPayslipUploading}
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="table-container-card form16-history-card">
        <h4 className="section-title" style={{ marginBottom: '12px' }}>Payslip Upload History</h4>
        <div className="table-responsive">
          <table className="results-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Year</th>
                <th>Uploaded On</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {payslipHistoryLoading && (
                <tr>
                  <td colSpan="4">Loading history...</td>
                </tr>
              )}
              {!payslipHistoryLoading && payslipHistoryError && (
                <tr>
                  <td colSpan="4">{payslipHistoryError}</td>
                </tr>
              )}
              {!payslipHistoryLoading && !payslipHistoryError && payslipHistory.length === 0 && (
                <tr>
                  <td colSpan="4">No payslip records found.</td>
                </tr>
              )}
              {!payslipHistoryLoading && !payslipHistoryError && payslipHistory.map((item) => (
                <tr key={item.id}>
                  <td>{item.month || '-'}</td>
                  <td>{item.year || '-'}</td>
                  <td>{getUploadedOnFromPath(item.file_path)}</td>
                  <td>
                    {item.file_path ? (
                      <a href={buildFileUrl(item.file_path)} target="_blank" rel="noreferrer">View</a>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderAddForm16 = () => (
    <div className="form16-page-stack fade-in">
      <button
        type="button"
        className="btn-back"
        onClick={() => setCurrentView(previousView || 'employees')}
      >
        <ArrowLeft size={18} /> Back
      </button>
      <div className="hr-search-card small-width">
        <h3 className="section-title text-center">Add Form 16 for {selectedEmployee?.name}</h3>
        <div className="input-group">
          <label>Financial Year</label>
          <input
            type="text"
            className="custom-input-file"
            placeholder="e.g. 2025-2026"
            value={form16FinancialYear}
            onChange={(e) => setForm16FinancialYear(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Form 16 File</label>
          <input
            type="file"
            className="custom-input-file"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={(e) => setForm16File(e.target.files?.[0] || null)}
          />
        </div>
        <div className="form-actions-row">
          <button
            type="button"
            className="btn-primary full-width"
            onClick={handleUploadForm16}
            disabled={isForm16Uploading}
          >
            {isForm16Uploading ? 'Uploading...' : 'Upload Form 16'}
          </button>
          <button
            type="button"
            className="btn-outline full-width"
            onClick={() => setCurrentView('employees')}
            disabled={isForm16Uploading}
          >
            Cancel
          </button>
        </div>
      </div>

      <div className="table-container-card form16-history-card">
        <h4 className="section-title" style={{ marginBottom: '12px' }}>Form 16 Upload History</h4>
        <div className="table-responsive">
          <table className="results-table">
            <thead>
              <tr>
                <th>Financial Year</th>
                <th>Uploaded On</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {form16HistoryLoading && (
                <tr>
                  <td colSpan="3">Loading history...</td>
                </tr>
              )}
              {!form16HistoryLoading && form16HistoryError && (
                <tr>
                  <td colSpan="3">{form16HistoryError}</td>
                </tr>
              )}
              {!form16HistoryLoading && !form16HistoryError && form16History.length === 0 && (
                <tr>
                  <td colSpan="3">No Form 16 records found.</td>
                </tr>
              )}
              {!form16HistoryLoading && !form16HistoryError && form16History.map((item) => (
                <tr key={item.id}>
                  <td>{item.financial_year || '-'}</td>
                  <td>{formatDateTime(item.created_at)}</td>
                  <td>
                    {item.file_path ? (
                      <a href={buildFileUrl(item.file_path)} target="_blank" rel="noreferrer">View</a>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderBulkPayslip = () => (
    <div className="form16-page-stack fade-in">
      <button
        type="button"
        className="btn-back"
        onClick={() => setCurrentView(previousView || 'employees')}
      >
        <ArrowLeft size={18} /> Back
      </button>
      <div className="hr-search-card small-width">
        <h3 className="section-title text-center">Bulk Payslip Upload</h3>
        <div className="input-group">
          <label>Month</label>
          <select className="custom-select" value={bulkPayslipMonth} onChange={(e) => setBulkPayslipMonth(e.target.value)}>
            <option>January</option><option>February</option><option>March</option><option>April</option>
            <option>May</option><option>June</option><option>July</option><option>August</option>
            <option>September</option><option>October</option><option>November</option><option>December</option>
          </select>
        </div>
        <div className="input-group">
          <label>Year</label>
          <input
            type="text"
            className="custom-input-file"
            placeholder="e.g. 2026"
            value={bulkPayslipYear}
            onChange={(e) => setBulkPayslipYear(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Select Files (Multiple)</label>
          <input
            type="file"
            className="custom-input-file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            onChange={(e) => setBulkPayslipFiles(Array.from(e.target.files || []))}
          />
        </div>
        {bulkPayslipFiles.length > 0 && (
          <div className="input-group">
            <label>Selected Files ({bulkPayslipFiles.length})</label>
            <ul className="bulk-file-list">
              {bulkPayslipFiles.map((file, idx) => (
                <li key={`${file.name}-${idx}`}>{file.name}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-actions-row">
          <button
            type="button"
            className="btn-primary full-width"
            onClick={handleBulkPayslipUpload}
            disabled={isBulkUploading}
          >
            {isBulkUploading ? 'Uploading...' : 'Upload Bulk Payslips'}
          </button>
          <button
            type="button"
            className="btn-outline full-width"
            onClick={() => setCurrentView('employees')}
            disabled={isBulkUploading}
          >
            Cancel
          </button>
        </div>
      </div>
      {bulkUploadResult && (
        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>Bulk Upload Result</h4>
          <p><strong>Uploaded:</strong> {bulkUploadResult.uploadedCount}</p>

          <div style={{ marginTop: '10px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Unmatched Files</h5>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkUploadResult.unmatchedFiles.length === 0 ? (
                    <tr>
                      <td colSpan="2">No unmatched files.</td>
                    </tr>
                  ) : bulkUploadResult.unmatchedFiles.map((item, idx) => (
                    <tr key={`${item.filename}-${idx}`}>
                      <td>{item.filename}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Email Failures</h5>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkUploadResult.emailFailures.length === 0 ? (
                    <tr>
                      <td colSpan="2">No email failures.</td>
                    </tr>
                  ) : bulkUploadResult.emailFailures.map((item, idx) => (
                    <tr key={`${item.email}-${idx}`}>
                      <td>{item.email}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderBulkForm16 = () => (
    <div className="form16-page-stack fade-in">
      <button
        type="button"
        className="btn-back"
        onClick={() => setCurrentView(previousView || 'employees')}
      >
        <ArrowLeft size={18} /> Back
      </button>
      <div className="hr-search-card small-width">
        <h3 className="section-title text-center">Bulk Form 16 Upload</h3>
        <div className="input-group">
          <label>Financial Year</label>
          <input
            type="text"
            className="custom-input-file"
            placeholder="e.g. 2026-2027"
            value={bulkForm16Year}
            onChange={(e) => setBulkForm16Year(e.target.value)}
          />
        </div>
        <div className="input-group">
          <label>Select Files (Multiple)</label>
          <input
            type="file"
            className="custom-input-file"
            accept=".pdf,.jpg,.jpeg,.png"
            multiple
            onChange={(e) => setBulkForm16Files(Array.from(e.target.files || []))}
          />
        </div>
        {bulkForm16Files.length > 0 && (
          <div className="input-group">
            <label>Selected Files ({bulkForm16Files.length})</label>
            <ul className="bulk-file-list">
              {bulkForm16Files.map((file, idx) => (
                <li key={`${file.name}-${idx}`}>{file.name}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="form-actions-row">
          <button
            type="button"
            className="btn-primary full-width"
            onClick={handleBulkForm16Upload}
            disabled={isBulkForm16Uploading}
          >
            {isBulkForm16Uploading ? 'Uploading...' : 'Upload Bulk Form 16'}
          </button>
          <button
            type="button"
            className="btn-outline full-width"
            onClick={() => setCurrentView('employees')}
            disabled={isBulkForm16Uploading}
          >
            Cancel
          </button>
        </div>
      </div>
      {bulkForm16UploadResult && (
        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>Bulk Form16 Upload Result</h4>
          <p><strong>Uploaded:</strong> {bulkForm16UploadResult.uploadedCount}</p>

          <div style={{ marginTop: '10px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Unmatched Files</h5>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkForm16UploadResult.unmatchedFiles.length === 0 ? (
                    <tr>
                      <td colSpan="2">No unmatched files.</td>
                    </tr>
                  ) : bulkForm16UploadResult.unmatchedFiles.map((item, idx) => (
                    <tr key={`${item.filename}-${idx}`}>
                      <td>{item.filename}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Email Failures</h5>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkForm16UploadResult.emailFailures.length === 0 ? (
                    <tr>
                      <td colSpan="2">No email failures.</td>
                    </tr>
                  ) : bulkForm16UploadResult.emailFailures.map((item, idx) => (
                    <tr key={`${item.email}-${idx}`}>
                      <td>{item.email}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="hr-main-container">
      {currentView !== 'addForm16' && currentView !== 'addPayslip' && currentView !== 'bulkPayslip' && currentView !== 'bulkForm16' && (
        <div className="page-header">
          <h1 className="main-title">Accounts & Payroll</h1>
          <p className="sub-title">Monitor and manage company financial operations</p>
        </div>
      )}

      {currentView === 'main' && renderMainView()}
      {currentView === 'employees' && renderEmployeesView()}
      {currentView === 'addPayslip' && renderAddPayslip()}
      {currentView === 'bulkPayslip' && renderBulkPayslip()}
      {currentView === 'bulkForm16' && renderBulkForm16()}
      {currentView === 'addForm16' && renderAddForm16()}
      {currentView === 'viewPayslip' && (
         <div className="fade-in">
            <button className="btn-back" onClick={() => setCurrentView('employees')}><ArrowLeft size={18}/> Back</button>
            <div className="stat-card">
                <h3>{selectedEmployee?.name}'s Bank Details</h3>
                <p>Passbook: {selectedEmployee?.documents?.passbook_front ? 'Available' : 'Not uploaded'}</p>
                {selectedEmployee?.documents?.passbook_front && (
                  <p>
                    <a
                      href={buildFileUrl(selectedEmployee.documents.passbook_front)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Passbook
                    </a>
                  </p>
                )}
                <p>PAN Front: {selectedEmployee?.documents?.pan_front ? 'Available' : 'Not uploaded'}</p>
                <p>Aadhaar Front: {selectedEmployee?.documents?.aadhaar_front ? 'Available' : 'Not uploaded'}</p>
                <p>Form 16: {selectedEmployee?.form16Path ? 'Available' : 'Not uploaded'}</p>
                {selectedEmployee?.form16Path && (
                  <p>
                    <a
                      href={buildFileUrl(selectedEmployee.form16Path)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View Form 16
                    </a>
                  </p>
                )}
            </div>
         </div>
      )}

      {attendancePickerOpen && (
        <div className="attendance-modal-overlay" onClick={() => setAttendancePickerOpen(false)}>
          <div className="attendance-modal-card" onClick={(e) => e.stopPropagation()}>
            <h4 className="section-title">Select Attendance Month</h4>
            <div className="input-group" style={{ marginTop: '14px' }}>
              <label htmlFor="attendance-month-popup">Month</label>
              <input
                id="attendance-month-popup"
                type="month"
                className="attendance-month-input"
                value={pendingAttendanceMonth}
                onChange={(e) => setPendingAttendanceMonth(e.target.value)}
              />
            </div>
            <div className="form-actions-row">
              <button type="button" className="btn-primary" onClick={handleConfirmAttendanceExcelDownload}>
                Download
              </button>
              <button type="button" className="btn-outline" onClick={() => setAttendancePickerOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}