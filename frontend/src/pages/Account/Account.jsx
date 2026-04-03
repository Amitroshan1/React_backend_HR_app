import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, FileText, TrendingUp, Download, 
  Send, Calculator, ChevronDown, ChevronRight, 
  ArrowLeft, Upload, Search
} from 'lucide-react';
import './Account.css';
import { useUser } from '../../components/layout/UserContext';

export const Account = ()  => {
  const { userData } = useUser();

  const isHr =
    ((userData?.user?.emp_type || '') + '')
      .trim()
      .toLowerCase() === 'hr' ||
    ((userData?.user?.emp_type || '') + '')
      .trim()
      .toLowerCase() === 'human resource' ||
    ((userData?.user?.emp_type || '') + '')
      .trim()
      .toLowerCase() === 'human resources';

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

  const [bulkPayrollMonth, setBulkPayrollMonth] = useState(() => {
    const now = new Date();
    return now.toLocaleString('en-US', { month: 'long' });
  });
  const [bulkPayrollYear, setBulkPayrollYear] = useState(String(new Date().getFullYear()));
  const [isBulkPayrollGenerating, setIsBulkPayrollGenerating] = useState(false);
  const [bulkPayrollResult, setBulkPayrollResult] = useState(null); // used for Save result messages
  const [bulkPayrollError, setBulkPayrollError] = useState('');
  const [payrollRows, setPayrollRows] = useState([]);
  const [isPayrollSaving, setIsPayrollSaving] = useState(false);
  const [payrollHistoryRows, setPayrollHistoryRows] = useState([]);
  const [payrollHistoryLoading, setPayrollHistoryLoading] = useState(false);
  const [payrollHistoryError, setPayrollHistoryError] = useState('');
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
  const [ctcForm, setCtcForm] = useState({
    basic_salary: '',
    hra: '',
    other_allowance: '',
    epf: '',
    esic: '',
    ptax: '',
  });
  const [ctcMonth, setCtcMonth] = useState(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`; // YYYY-MM
  });
  const [ctcHraPct, setCtcHraPct] = useState('');
  const [ctcEpfMode, setCtcEpfMode] = useState('min'); // 'min' | 'percent'
  const [ctcEpfPct, setCtcEpfPct] = useState('');
  const [ctcComputed, setCtcComputed] = useState({
    hra_amount: 0,
    epf_amount: 0,
    ptax_amount: 0,
    esic_employee_amount: 0,
    esic_employer_amount: 0,
    gross_salary: 0,
    net_salary: 0,
    deductions_total: 0,
  });
  const [ctcCalcError, setCtcCalcError] = useState('');
  const [ctcSaving, setCtcSaving] = useState(false);
  const [ctcLoading, setCtcLoading] = useState(false);
  const [ctcError, setCtcError] = useState('');
  const [ctcSuccess, setCtcSuccess] = useState('');
  const [ctcHistory, setCtcHistory] = useState([]);
  const [ctcHistoryLoading, setCtcHistoryLoading] = useState(false);
  const [ctcHistoryError, setCtcHistoryError] = useState('');

  // Employee Accounts Profile (new model) - tied to selected employee in "Bank Details"
  const [accountsProfileForm, setAccountsProfileForm] = useState({
    function: '',
    designation: '',
    location: '',
    bank_details: '',
    date_of_joining: '',
    tax_regime: '',
    pan: '',
    uan: '',
    pf_account_number: '',
    esi_number: '',
    pran: '',
  });
  const [accountsProfileLoading, setAccountsProfileLoading] = useState(false);
  const [accountsProfileSaving, setAccountsProfileSaving] = useState(false);
  const [accountsProfileError, setAccountsProfileError] = useState('');
  const [accountsProfileSuccess, setAccountsProfileSuccess] = useState('');

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

  const openProtectedFile = async (filePath) => {
    const url = buildFileUrl(filePath);
    if (!url) return;
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Session expired. Please login again.');
      return;
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        let msg = 'Unable to open file';
        try {
          const j = await res.json();
          msg = j?.message || j?.msg || msg;
        } catch {
          // ignore
        }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      alert(e.message || 'Unable to open file');
    }
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
      setAccountsProfileError('');
      setAccountsProfileSuccess('');
      setAccountsProfileLoading(true);

      const [docsRes, profileRes] = await Promise.all([
        fetch(`${API_BASE_URL}/employee-documents/${emp.adminId}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${API_BASE_URL}/employee-accounts-profile?admin_id=${encodeURIComponent(emp.adminId)}`, {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      const docsJson = await docsRes.json().catch(() => ({}));
      if (!docsRes.ok || !docsJson.success) {
        throw new Error(docsJson.message || 'Failed to fetch documents');
      }

      const profileJson = await profileRes.json().catch(() => ({}));
      if (!profileRes.ok || !profileJson.success) {
        throw new Error(profileJson.message || 'Failed to fetch accounts profile');
      }

      const p = profileJson.profile || {};
      setAccountsProfileForm({
        function: p.function || '',
        designation: p.designation || '',
        location: p.location || '',
        bank_details: p.bank_details || '',
        date_of_joining: p.date_of_joining || '',
        tax_regime: p.tax_regime || '',
        pan: p.pan || '',
        uan: p.uan || '',
        pf_account_number: p.pf_account_number || '',
        esi_number: p.esi_number || '',
        pran: p.pran || '',
      });
      if (!profileJson.profile) {
        setAccountsProfileSuccess('No Accounts Profile yet. Fill details and click Save.');
      }

      setSelectedEmployee({
        ...emp,
        documents: docsJson.documents || {},
        form16Path: docsJson.form16_path || emp.form16Path || null
      });
      setCurrentView('viewPayslip');
    } catch (error) {
      console.error('Document fetch error:', error);
      setAccountsProfileError(error.message || 'Unable to load employee data');
      setSelectedEmployee(emp);
      setCurrentView('viewPayslip');
    } finally {
      setAccountsProfileLoading(false);
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

  const loadCtcBreakup = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) return;
    try {
      setCtcLoading(true);
      setCtcError('');
      const response = await fetch(`${API_BASE_URL}/ctc-breakup/${adminId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load CTC breakup');
      }
      const c = result.ctc_breakup || {};
      setCtcForm({
        basic_salary: c.basic_salary ?? '',
        hra: c.hra ?? '',
        other_allowance: c.other_allowance ?? '',
        epf: c.epf ?? '',
        esic: c.esic ?? '',
        ptax: c.ptax ?? '',
      });
      // When loading existing record, we can't reliably reverse-engineer % choices.
      // Keep user inputs empty; computed will refresh once user edits fields.
      setCtcHraPct('');
      setCtcEpfMode('min');
      setCtcEpfPct('');
    } catch (error) {
      console.error('CTC breakup load error:', error);
      setCtcError(error.message || 'Unable to load CTC breakup');
      setCtcForm({
        basic_salary: '',
        hra: '',
        other_allowance: '',
        epf: '',
        esic: '',
        ptax: '',
      });
      setCtcHraPct('');
      setCtcEpfMode('min');
      setCtcEpfPct('');
    } finally {
      setCtcLoading(false);
    }
  };

  const loadCtcHistory = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) {
      setCtcHistory([]);
      setCtcHistoryError('');
      return;
    }
    try {
      setCtcHistoryLoading(true);
      setCtcHistoryError('');
      const response = await fetch(`${API_BASE_URL}/ctc-breakup/history/${adminId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load CTC breakup history');
      }
      setCtcHistory(result.history || []);
    } catch (error) {
      console.error('CTC breakup history error:', error);
      setCtcHistory([]);
      setCtcHistoryError(error.message || 'Unable to load CTC breakup history');
    } finally {
      setCtcHistoryLoading(false);
    }
  };

  const handleOpenCtcBreakup = (emp) => {
    setPreviousView(currentView);
    setSelectedEmployee(emp);
    setCtcForm({
      basic_salary: '',
      hra: '',
      other_allowance: '',
      epf: '',
      esic: '',
      ptax: '',
    });
    setCtcHraPct('');
    setCtcEpfMode('min');
    setCtcEpfPct('');
    setCtcCalcError('');
    setCtcComputed({
      hra_amount: 0,
      epf_amount: 0,
      ptax_amount: 0,
      esic_employee_amount: 0,
      esic_employer_amount: 0,
      gross_salary: 0,
      net_salary: 0,
      deductions_total: 0,
    });
    setCtcError('');
    setCtcSuccess('');
    setCurrentView('ctcBreakup');
    loadCtcBreakup(emp.adminId);
    loadCtcHistory(emp.adminId);
  };

  useEffect(() => {
    if (currentView !== 'ctcBreakup') return;
    if (!selectedEmployee?.adminId) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const basic = Number(ctcForm.basic_salary || 0);
    if (!basic || basic <= 0) {
      setCtcCalcError('');
      setCtcComputed((p) => ({ ...p, gross_salary: 0, net_salary: 0, deductions_total: 0 }));
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setCtcCalcError('');
        const response = await fetch(`${API_BASE_URL}/ctc-breakup/calculate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            admin_id: selectedEmployee.adminId,
            basic_salary: ctcForm.basic_salary,
            hra_pct: ctcHraPct,
            other_allowance: ctcForm.other_allowance,
            epf_mode: ctcEpfMode,
            epf_pct: ctcEpfPct,
            month: ctcMonth
          })
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Unable to calculate CTC breakup');
        }
        if (cancelled) return;
        const computed = result?.data?.computed || {};
        setCtcComputed({
          hra_amount: Number(computed.hra_amount || 0),
          epf_amount: Number(computed.epf_amount || 0),
          ptax_amount: Number(computed.ptax_amount || 0),
          esic_employee_amount: Number(computed.esic_employee_amount || 0),
          esic_employer_amount: Number(computed.esic_employer_amount || 0),
          gross_salary: Number(computed.gross_salary || 0),
          net_salary: Number(computed.net_salary || 0),
          deductions_total: Number(computed.deductions_total || 0),
        });

        // Keep the persisted payload in sync with computed amounts
        setCtcForm((p) => ({
          ...p,
          hra: computed.hra_amount ?? '',
          epf: computed.epf_amount ?? '',
          ptax: computed.ptax_amount ?? '',
          esic: computed.esic_employee_amount ?? '',
        }));
      } catch (e) {
        if (cancelled) return;
        setCtcCalcError(e.message || 'CTC calculation failed');
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [
    currentView,
    selectedEmployee?.adminId,
    ctcForm.basic_salary,
    ctcForm.other_allowance,
    ctcHraPct,
    ctcEpfMode,
    ctcEpfPct,
    ctcMonth
  ]);

  useEffect(() => {
    // After a hard refresh, state is restored from localStorage but fetched data may be stale/missing.
    // If user is on the "viewPayslip" page, re-fetch both docs (UploadDoc) and accounts profile.
    if (currentView !== 'viewPayslip') return;
    if (!selectedEmployee?.adminId) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    let cancelled = false;
    (async () => {
      try {
        setAccountsProfileLoading(true);
        setAccountsProfileError('');
        setAccountsProfileSuccess('');

        const adminId = selectedEmployee.adminId;
        const [docsRes, profileRes] = await Promise.all([
          fetch(`${API_BASE_URL}/employee-documents/${adminId}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`${API_BASE_URL}/employee-accounts-profile?admin_id=${encodeURIComponent(adminId)}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        const docsJson = await docsRes.json().catch(() => ({}));
        const profileJson = await profileRes.json().catch(() => ({}));

        if (!docsRes.ok || !docsJson.success) {
          throw new Error(docsJson.message || 'Failed to fetch documents');
        }
        if (!profileRes.ok || !profileJson.success) {
          throw new Error(profileJson.message || 'Failed to fetch accounts profile');
        }

        if (cancelled) return;

        const p = profileJson.profile || {};
        setAccountsProfileForm({
          function: p.function || '',
          designation: p.designation || '',
          location: p.location || '',
          bank_details: p.bank_details || '',
          date_of_joining: p.date_of_joining || '',
          tax_regime: p.tax_regime || '',
          pan: p.pan || '',
          uan: p.uan || '',
          pf_account_number: p.pf_account_number || '',
          esi_number: p.esi_number || '',
          pran: p.pran || '',
        });
        if (!profileJson.profile) {
          setAccountsProfileSuccess('No Accounts Profile yet. Fill details and click Save.');
        }

        setSelectedEmployee((prev) => ({
          ...(prev || {}),
          documents: docsJson.documents || {},
          form16Path: docsJson.form16_path || prev?.form16Path || null,
        }));
      } catch (e) {
        if (cancelled) return;
        setAccountsProfileError(e.message || 'Unable to load employee data');
      } finally {
        if (!cancelled) setAccountsProfileLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentView, selectedEmployee?.adminId]);

  useEffect(() => {
    if (currentView === 'addForm16' && selectedEmployee?.adminId) {
      loadForm16History(selectedEmployee.adminId);
    }
    if (currentView === 'addPayslip' && selectedEmployee?.adminId) {
      loadPayslipHistory(selectedEmployee.adminId);
    }
    if (currentView === 'ctcBreakup' && selectedEmployee?.adminId) {
      loadCtcBreakup(selectedEmployee.adminId);
      loadCtcHistory(selectedEmployee.adminId);
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

  const handleDeletePayslip = async (payslipId) => {
    if (!window.confirm('Are you sure you want to delete this payslip?')) return;

    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/payslip/${payslipId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to delete payslip');
      }
      setPayslipHistory(prev => prev.filter(p => p.id !== payslipId));
      alert('Payslip deleted successfully');
    } catch (error) {
      console.error('Delete payslip error:', error);
      alert(error.message || 'Unable to delete payslip');
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

  const handleOpenBulkPayroll = () => {
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    setPreviousView(currentView);
    setBulkPayrollMonth(monthName);
    setBulkPayrollYear(String(now.getFullYear()));
    setBulkPayrollResult(null);
    setBulkPayrollError('');
    setPayrollRows([]);
    setCurrentView('bulkPayroll');
  };

  const handleGeneratePayrollForFiltered = async ({ clearMessages = true } = {}) => {
    if (clearMessages) {
      setBulkPayrollError('');
      setBulkPayrollResult(null);
    }

    if (!bulkPayrollMonth || !bulkPayrollYear.trim()) {
      setBulkPayrollError('Please select month and year.');
      return;
    }

    if (!Array.isArray(employeesList) || employeesList.length === 0) {
      setBulkPayrollError('No employees found in the current filtered list.');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      setBulkPayrollError('Please login again.');
      return;
    }

    try {
      setIsBulkPayrollGenerating(true);
      // Fetch/create payroll rows without overwriting saved deductions.
      const payload = {
        admin_ids: employeesList.map((emp) => emp.adminId),
        month: bulkPayrollMonth,
        year: bulkPayrollYear.trim(),
      };

      const res = await fetch(`${API_BASE_URL}/payroll/list`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || 'Payroll list fetch failed');
      }

      const payrollByAdminId = new Map(
        (result.payrolls || []).map((p) => [p.admin_id, p])
      );

      const calcNet = (gross, epf, ptax, esic) => {
        const g = Number(gross || 0);
        const e = Number(epf || 0);
        const t = Number(ptax || 0);
        const s = Number(esic || 0);
        return g - e - t - s;
      };

      const mapped = (employeesList || []).map((emp) => {
        const p = payrollByAdminId.get(emp.adminId) || {};
        return {
          adminId: emp.adminId,
          empId: emp.id,
          name: emp.name,
          one_day_salary: Number(p.one_day_salary || 0),
          gross_salary_for_month: Number(p.gross_salary_for_month || 0),
          actual_working_days: Number(p.actual_working_days || 0),
          epf_final: Number(p.epf_final || 0),
          ptax_final: Number(p.ptax_final || 0),
          esic_final: Number(p.esic_final || 0),
          net_salary_final: Number(p.net_salary_final || calcNet(
            p.gross_salary_for_month,
            p.epf_final,
            p.ptax_final,
            p.esic_final
          )),
        };
      });

      setPayrollRows(mapped);
    } catch (e) {
      setBulkPayrollError(e?.message || 'Bulk payroll generation failed');
    } finally {
      setIsBulkPayrollGenerating(false);
    }
  };

  const handleSavePayrollDeductions = async () => {
    setBulkPayrollError('');
    setBulkPayrollResult(null);

    const token = localStorage.getItem('token');
    if (!token) {
      setBulkPayrollError('Please login again.');
      return;
    }
    if (!Array.isArray(payrollRows) || payrollRows.length === 0) {
      setBulkPayrollError('No payroll rows to save.');
      return;
    }

    try {
      setIsPayrollSaving(true);
      const failures = [];

      for (const row of payrollRows) {
        try {
          const payload = {
            admin_id: row.adminId,
            month: bulkPayrollMonth,
            year: bulkPayrollYear.trim(),
            epf_final: Number(row.epf_final || 0),
            ptax_final: Number(row.ptax_final || 0),
            esic_final: Number(row.esic_final || 0),
            actual_working_days: Number(row.actual_working_days || 0),
          };

          const res = await fetch(`${API_BASE_URL}/payroll/deductions-update`, {
            method: 'PUT',
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });
          const result = await res.json();
          if (!res.ok || !result.success) {
            failures.push({
              admin_id: row.adminId,
              name: row.name,
              reason: result.message || 'Save deductions failed',
            });
          }
        } catch (e) {
          failures.push({
            admin_id: row.adminId,
            name: row.name,
            reason: e?.message || 'Save deductions exception',
          });
        }
      }

      if (failures.length > 0) {
        setBulkPayrollResult({
          month: bulkPayrollMonth,
          year: bulkPayrollYear.trim(),
          saved_count: payrollRows.length - failures.length,
          failed_count: failures.length,
          failed_rows: failures,
        });
        setBulkPayrollError('Some employees failed to save deductions. See details below.');
      } else {
        setBulkPayrollResult({
          month: bulkPayrollMonth,
          year: bulkPayrollYear.trim(),
          saved_count: payrollRows.length,
          failed_count: 0,
        });
      }

      // Refresh rows to ensure DB-calculated net salary is reflected.
      await handleGeneratePayrollForFiltered({ clearMessages: false });
    } finally {
      setIsPayrollSaving(false);
    }
  };

  const handleOpenPayrollHistory = async () => {
    setPreviousView(currentView);
    setPayrollHistoryRows([]);
    setPayrollHistoryError('');
    setCurrentView('payrollHistory');
  };

  const loadPayrollHistory = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setPayrollHistoryError('Please login again.');
      return;
    }
    if (!bulkPayrollMonth || !bulkPayrollYear.trim()) {
      setPayrollHistoryError('Please select month and year.');
      return;
    }

    try {
      setPayrollHistoryLoading(true);
      setPayrollHistoryError('');

      const payload = {
        month: bulkPayrollMonth,
        year: bulkPayrollYear.trim(),
        circle: selectedCircle || '',
        emp_type: selectedDept || '',
      };

      const res = await fetch(`${API_BASE_URL}/payroll/history`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || 'Failed to load payroll history');
      }

      setPayrollHistoryRows(result.history || []);
    } catch (e) {
      setPayrollHistoryRows([]);
      setPayrollHistoryError(e?.message || 'Unable to load payroll history');
    } finally {
      setPayrollHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (currentView !== 'bulkPayroll') return;

    // On refresh, employeesList resets. Reload filtered employees first, then fetch payroll.
    if (selectedDept && selectedCircle && (!Array.isArray(employeesList) || employeesList.length === 0)) {
      handleCircleSelect(selectedDept, selectedCircle, false);
      return;
    }

    // Auto-fetch payroll as soon as list is available or month/year changes.
    if (Array.isArray(employeesList) && employeesList.length > 0) {
      handleGeneratePayrollForFiltered();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, bulkPayrollMonth, bulkPayrollYear, selectedDept, selectedCircle, employeesList.length]);

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

  const handleSaveCtcBreakup = async () => {
    if (!selectedEmployee?.adminId) {
      alert('Employee not selected.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }

    try {
      setCtcSaving(true);
      setCtcError('');
      setCtcSuccess('');
      const payload = {
        admin_id: selectedEmployee.adminId,
        ...ctcForm,
        gross_salary: ctcComputed.gross_salary,
        net_salary: ctcComputed.net_salary,
      };
      const response = await fetch(`${API_BASE_URL}/ctc-breakup`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to save CTC breakup');
      }
      setCtcSuccess('CTC breakup saved successfully.');
      await loadCtcBreakup(selectedEmployee.adminId);
      await loadCtcHistory(selectedEmployee.adminId);
    } catch (error) {
      console.error('CTC breakup save error:', error);
      setCtcError(error.message || 'Unable to save CTC breakup');
    } finally {
      setCtcSaving(false);
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
                <th>CTC Breakup</th>
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
                  <td>
                    <button
                      className="text-link"
                      onClick={() => handleOpenCtcBreakup(emp)}
                    >
                      CTC Breakup
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
           <button className="btn-warning" onClick={handleOpenBulkPayslip}>
             <Upload size={16}/> Bulk Payslips
           </button>
           <button className="btn-primary" onClick={handleOpenBulkForm16}>
             <Upload size={16}/> Bulk Form 16
           </button>
           <button className="btn-secondary" onClick={handleOpenBulkPayroll} disabled={isBulkPayrollGenerating}>
             <Calculator size={16}/> Payroll
           </button>
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
                <th>Delete</th>
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
                  <td>
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => handleDeletePayslip(item.id)}
                    >
                      Delete
                    </button>
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

  const renderCtcBreakup = () => {
    return (
      <div className="form16-page-stack fade-in">
        <button
          type="button"
          className="btn-back"
          onClick={() => setCurrentView(previousView || 'employees')}
        >
          <ArrowLeft size={18} /> Back
        </button>
        <div className="table-container-card">
          <div className="card-header-row">
            <h3 className="section-title">CTC Breakup for {selectedEmployee?.name}</h3>
          </div>
          <div className="ctc-form-grid">
            <div className="ctc-form-half">
              <h4 className="ctc-form-half-title">Part A</h4>
                <div className="input-group">
                  <label>Month (for P.Tax)</label>
                  <input className="custom-select" type="month" value={ctcMonth} onChange={(e) => setCtcMonth(e.target.value)} />
                </div>
              <div className="input-group">
                <label>Employee ID (Emp_ID)</label>
                <input className="custom-select" value={selectedEmployee?.id || ''} readOnly />
              </div>
              <div className="input-group">
                <label>Basic Salary + DA</label>
                <input className="custom-select" type="number" step="0.01" value={ctcForm.basic_salary} onChange={(e) => setCtcForm((p) => ({ ...p, basic_salary: e.target.value }))} />
              </div>
              <div className="input-group">
                  <label>HRA (%)</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    placeholder="HRA should be between 5% to 50%"
                    value={ctcHraPct}
                    disabled={!Number(ctcForm.basic_salary || 0)}
                    onChange={(e) => setCtcHraPct(e.target.value)}
                  />
                  <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                    {Number(ctcForm.basic_salary || 0) > 0 ? (
                      <span>
                        {ctcHraPct || 0}% - {Number(ctcComputed.hra_amount || 0).toFixed(2)}
                      </span>
                    ) : (
                      <span>Enter Basic Salary + DA to calculate HRA.</span>
                    )}
                  </div>
              </div>
            </div>
            <div className="ctc-form-half">
              <h4 className="ctc-form-half-title">Part B</h4>
              <div className="input-group">
                <label>Other Allowance</label>
                <input className="custom-select" type="number" step="0.01" value={ctcForm.other_allowance} onChange={(e) => setCtcForm((p) => ({ ...p, other_allowance: e.target.value }))} />
              </div>
              <div className="input-group">
                  <label>EPF</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                    <select className="custom-select" value={ctcEpfMode} onChange={(e) => setCtcEpfMode(e.target.value)} disabled={Number(ctcForm.basic_salary || 0) < 15000}>
                      <option value="min">Minimum 1800 (basic ≥ 15000)</option>
                      <option value="percent">Percentage (basic ≥ 15000)</option>
                    </select>
                    {ctcEpfMode === 'percent' && Number(ctcForm.basic_salary || 0) >= 15000 && (
                      <input
                        className="custom-select"
                        type="number"
                        step="0.01"
                        placeholder="Enter EPF % (e.g. 8)"
                        value={ctcEpfPct}
                        onChange={(e) => setCtcEpfPct(e.target.value)}
                      />
                    )}
                    <input className="custom-select" type="text" readOnly value={`${Number(ctcComputed.epf_amount || 0).toFixed(2)}`} />
                    {Number(ctcForm.basic_salary || 0) < 15000 && (
                      <div style={{ fontSize: 13, opacity: 0.85 }}>Basic below 15000: EPF 12% mandatory.</div>
                    )}
                  </div>
              </div>
              <div className="input-group">
                <label>P.Tax</label>
                  <input className="custom-select" type="text" readOnly value={Number(ctcComputed.ptax_amount || 0).toFixed(2)} />
                </div>
                <div className="input-group">
                  <label>ESIC (Employee)</label>
                  <input className="custom-select" type="text" readOnly value={Number(ctcComputed.esic_employee_amount || 0).toFixed(2)} />
                </div>
                <div className="input-group">
                  <label>ESIC (Employer)</label>
                  <input className="custom-select" type="text" readOnly value={Number(ctcComputed.esic_employer_amount || 0).toFixed(2)} />
              </div>
            </div>
          </div>
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              {ctcCalcError && <div className="q-error">{ctcCalcError}</div>}
              <div className="table-responsive">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Gross Salary</th>
                      <th>Total Deductions</th>
                      <th>Net Salary</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{Number(ctcComputed.gross_salary || 0).toFixed(2)}</td>
                      <td>{Number(ctcComputed.deductions_total || 0).toFixed(2)}</td>
                      <td>{Number(ctcComputed.net_salary || 0).toFixed(2)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          {ctcLoading && <p>Loading CTC breakup...</p>}
          {ctcError && <div className="q-error">{ctcError}</div>}
          {ctcSuccess && <div className="q-success">{ctcSuccess}</div>}
          <div className="form-actions-row">
            <button
              type="button"
              className="btn-primary full-width"
              onClick={handleSaveCtcBreakup}
              disabled={ctcSaving || !selectedEmployee?.adminId}
            >
              {ctcSaving ? 'Saving...' : 'Save CTC Breakup'}
            </button>
          </div>
        </div>

        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>CTC Breakup History</h4>
          <div className="table-responsive">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Updated At</th>
                  <th>Basic Salary + DA</th>
                  <th>HRA</th>
                  <th>Other Allowance</th>
                  <th>Gross Salary</th>
                  <th>EPF</th>
                  <th>ESIC (Employee)</th>
                  <th>P.Tax</th>
                  <th>Net Salary</th>
                </tr>
              </thead>
              <tbody>
                {ctcHistoryLoading && (
                  <tr>
                    <td colSpan="9">Loading history...</td>
                  </tr>
                )}
                {!ctcHistoryLoading && ctcHistoryError && (
                  <tr>
                    <td colSpan="9">{ctcHistoryError}</td>
                  </tr>
                )}
                {!ctcHistoryLoading && !ctcHistoryError && ctcHistory.length === 0 && (
                  <tr>
                    <td colSpan="9">No CTC breakup records found.</td>
                  </tr>
                )}
                {!ctcHistoryLoading && !ctcHistoryError && ctcHistory.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.updated_at || item.created_at)}</td>
                    <td>{Number(item.basic_salary || 0).toFixed(2)}</td>
                    <td>{Number(item.hra || 0).toFixed(2)}</td>
                    <td>{Number(item.other_allowance || 0).toFixed(2)}</td>
                    <td>{Number(item.gross_salary || 0).toFixed(2)}</td>
                    <td>{Number(item.epf || 0).toFixed(2)}</td>
                    <td>{Number(item.esic || 0).toFixed(2)}</td>
                    <td>{Number(item.ptax || 0).toFixed(2)}</td>
                    <td>{Number(item.net_salary || 0).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

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

  const renderBulkPayroll = () => (
    <div className="form16-page-stack fade-in">
      <button
        type="button"
        className="btn-back"
        onClick={() => setCurrentView(previousView || 'employees')}
      >
        <ArrowLeft size={18} /> Back
      </button>

      {bulkPayrollError && <div className="q-error" style={{ marginTop: 12 }}>{bulkPayrollError}</div>}
      {isBulkPayrollGenerating && (
        <p style={{ marginTop: 14, color: '#64748b' }}>Loading payroll data...</p>
      )}

      <div className="table-container-card">
        <div className="table-responsive">
          <table className="results-table">
            <thead className="thead-teal">
              <tr>
                <th colSpan={8} style={{ background: '#06b6d4', color: 'white' }}>
                  Employee | Circle: {selectedCircle || '-'} | Month:{' '}
                  <select
                    className="custom-select"
                    style={{ width: 160, margin: '0 10px' }}
                    value={bulkPayrollMonth}
                    onChange={(e) => setBulkPayrollMonth(e.target.value)}
                  >
                    <option>January</option><option>February</option><option>March</option><option>April</option>
                    <option>May</option><option>June</option><option>July</option><option>August</option>
                    <option>September</option><option>October</option><option>November</option><option>December</option>
                  </select>
                  Year:{' '}
                  <input
                    type="text"
                    className="custom-input-file"
                    style={{ width: 110, marginLeft: 10 }}
                    placeholder="e.g. 2026"
                    value={bulkPayrollYear}
                    onChange={(e) => setBulkPayrollYear(e.target.value)}
                  />

                  <button
                    type="button"
                    className="btn-outline-sm"
                    style={{ float: 'right', marginTop: -4 }}
                    onClick={handleOpenPayrollHistory}
                  >
                    History
                  </button>
                </th>
              </tr>
              <tr>
                <th>Name</th>
                <th>EmpID</th>
                <th>Gross Salary</th>
                <th>EPF</th>
                <th>P.Tax</th>
                <th>ESIC</th>
                <th>Actual Working Days</th>
                <th>Net Salary</th>
              </tr>
            </thead>
            <tbody>
              {payrollRows.length === 0 && !isBulkPayrollGenerating && (
                <tr>
                  <td colSpan="8" className="empty" style={{ padding: 18, color: '#64748b' }}>
                    No employees in this filtered list for the selected month/year.
                  </td>
                </tr>
              )}
              {payrollRows.map((row) => {
                const gross = Number(row.one_day_salary || 0) * Number(row.actual_working_days || 0);
                const net = Number(gross || 0)
                  - Number(row.epf_final || 0)
                  - Number(row.ptax_final || 0)
                  - Number(row.esic_final || 0);
                return (
                  <tr key={row.adminId}>
                    <td className="font-bold">{row.name}</td>
                    <td>{row.empId}</td>
                    <td>{Number(gross || 0).toFixed(2)}</td>
                    <td>
                      <input
                        className="custom-input-file"
                        style={{ width: 110 }}
                        type="number"
                        step="0.01"
                        value={row.epf_final}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, epf_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="custom-input-file"
                        style={{ width: 110 }}
                        type="number"
                        step="0.01"
                        value={row.ptax_final}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, ptax_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="custom-input-file"
                        style={{ width: 110 }}
                        type="number"
                        step="0.01"
                        value={row.esic_final}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, esic_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td>
                      <input
                        className="custom-input-file"
                        style={{ width: 110 }}
                        type="number"
                        step="0.1"
                        value={row.actual_working_days}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, actual_working_days: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td>{net.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="form-actions-row" style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn-primary full-width"
            onClick={handleSavePayrollDeductions}
            disabled={isPayrollSaving || payrollRows.length === 0}
          >
            {isPayrollSaving ? 'Saving...' : 'Save Deductions'}
          </button>
        </div>

        {bulkPayrollResult && (
          <div style={{ marginTop: 12 }}>
            {Number(bulkPayrollResult.failed_count || 0) === 0 ? (
              <div className="q-success">
                <strong>Success:</strong> {bulkPayrollResult.saved_count || 0} &nbsp;|&nbsp;
                <strong>Failed:</strong> {bulkPayrollResult.failed_count || 0}
              </div>
            ) : (
              <div className="q-error">
                <strong>Success:</strong> {bulkPayrollResult.saved_count || 0} &nbsp;|&nbsp;
                <strong>Failed:</strong> {bulkPayrollResult.failed_count || 0}
              </div>
            )}
          </div>
        )}

        {bulkPayrollResult && bulkPayrollResult.failed_rows?.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Failed to save for</h5>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkPayrollResult.failed_rows.map((item, idx) => (
                    <tr key={`${item.admin_id}-${idx}`}>
                      <td>{item.name || item.admin_id}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  useEffect(() => {
    if (currentView === 'payrollHistory') {
      loadPayrollHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, bulkPayrollMonth, bulkPayrollYear, selectedCircle, selectedDept]);

  const renderPayrollHistory = () => (
    <div className="fade-in">
      <button className="btn-back" onClick={() => setCurrentView(previousView || 'bulkPayroll')}>
        <ArrowLeft size={18} /> Back
      </button>

      <div className="table-container-card">
        <div className="card-header-row">
          <h3 className="section-title">
            Payroll History | Circle: {selectedCircle || '-'} | Department: {selectedDept || '-'} | Month: {bulkPayrollMonth} | Year: {bulkPayrollYear} | Created At:{' '}
            {payrollHistoryRows.length > 0
              ? (() => {
                  const latest = payrollHistoryRows
                    .map((r) => r.created_at)
                    .filter(Boolean)
                    .sort()
                    .slice(-1)[0];
                  return latest
                    ? new Date(latest).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
                    : '-';
                })()
              : '-'}
          </h3>
        </div>

        {payrollHistoryError && <div className="q-error">{payrollHistoryError}</div>}
        {payrollHistoryLoading && <p style={{ color: '#64748b' }}>Loading...</p>}

        <div className="table-responsive">
          <table className="results-table">
            <thead className="thead-teal">
              <tr>
                <th>Name</th>
                <th>EmpID</th>
                <th>Gross Salary</th>
                <th>EPF</th>
                <th>P.Tax</th>
                <th>ESIC</th>
                <th>Actual Working Days</th>
                <th>Net Salary</th>
              </tr>
            </thead>
            <tbody>
              {!payrollHistoryLoading && payrollHistoryRows.length === 0 && (
                <tr>
                  <td colSpan="8" style={{ padding: 18, color: '#64748b' }}>
                    No payroll history found for this month/year.
                  </td>
                </tr>
              )}
              {payrollHistoryRows.map((r) => (
                <tr key={r.admin_id}>
                  <td className="font-bold">{r.name}</td>
                  <td>{r.emp_id}</td>
                  <td>{Number(r.gross_salary_for_month || 0).toFixed(2)}</td>
                  <td>{Number(r.epf_final || 0).toFixed(2)}</td>
                  <td>{Number(r.ptax_final || 0).toFixed(2)}</td>
                  <td>{Number(r.esic_final || 0).toFixed(2)}</td>
                  <td>{Number(r.actual_working_days || 0).toFixed(1)}</td>
                  <td>{Number(r.net_salary_final || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="hr-main-container">
      {currentView === 'main' && renderMainView()}
      {currentView === 'employees' && renderEmployeesView()}
      {currentView === 'addPayslip' && renderAddPayslip()}
      {currentView === 'bulkPayslip' && renderBulkPayslip()}
      {currentView === 'bulkForm16' && renderBulkForm16()}
      {currentView === 'bulkPayroll' && renderBulkPayroll()}
      {currentView === 'payrollHistory' && renderPayrollHistory()}
      {currentView === 'addForm16' && renderAddForm16()}
      {currentView === 'ctcBreakup' && renderCtcBreakup()}
      {currentView === 'viewPayslip' && (
         <div className="fade-in">
            <button className="btn-back" onClick={() => setCurrentView('employees')}><ArrowLeft size={18}/> Back</button>
            <div className="table-container-card">
              <div className="card-header-row">
                <h3 className="section-title">Employee Accounts Profile</h3>
              </div>
              <p style={{ marginTop: 0, color: '#64748b' }}>
                {selectedEmployee?.name || 'Employee'} ({selectedEmployee?.id || '-'}) — {selectedEmployee?.email || '-'}
              </p>

              {accountsProfileLoading && <p>Loading...</p>}
              {accountsProfileError && <div className="q-error">{accountsProfileError}</div>}
              {accountsProfileSuccess && <div className="q-success">{accountsProfileSuccess}</div>}

              <div className={`accounts-two-col-grid ${isHr ? '' : 'accounts-readonly'}`}>
                <div>
                  <div className="input-group">
                    <label>Function</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.function}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, function: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>Designation</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.designation}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, designation: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>Location</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.location}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, location: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>Date of Joining</label>
                      <input
                        className="custom-select"
                        type="date"
                        value={accountsProfileForm.date_of_joining}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, date_of_joining: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>Bank Details</label>
                      <textarea
                        className="custom-select"
                        rows={3}
                        value={accountsProfileForm.bank_details}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, bank_details: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>Tax Regime</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.tax_regime}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, tax_regime: e.target.value }))}
                        placeholder="Old / New"
                        disabled={!isHr}
                      />
                  </div>
                </div>

                <div>
                  <div className="input-group">
                    <label>Employee ID (Emp_ID)</label>
                    <input className="custom-select" value={selectedEmployee?.id || ''} readOnly />
                  </div>
                  <div className="input-group">
                    <label>PAN</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.pan}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pan: e.target.value }))}
                        placeholder="ABCDE1234F"
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>UAN</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.uan}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, uan: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>PF Account Number</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.pf_account_number}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pf_account_number: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>ESI Number</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.esi_number}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, esi_number: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                  <div className="input-group">
                    <label>PRAN</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.pran}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pran: e.target.value }))}
                        disabled={!isHr}
                      />
                  </div>
                </div>
              </div>

              <div className="form-actions-row">
                {isHr ? (
                  <button
                    type="button"
                    className="btn-primary full-width"
                    disabled={accountsProfileSaving || !selectedEmployee?.adminId}
                    onClick={async () => {
                      const token = localStorage.getItem('token');
                      if (!token || !selectedEmployee?.adminId) return;
                      try {
                        setAccountsProfileSaving(true);
                        setAccountsProfileError('');
                        setAccountsProfileSuccess('');
                        const res = await fetch(`${API_BASE_URL}/employee-accounts-profile`, {
                          method: 'PUT',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({
                            admin_id: selectedEmployee.adminId,
                            employee_number: selectedEmployee.id || null,
                            ...accountsProfileForm,
                            date_of_joining: accountsProfileForm.date_of_joining || null,
                          }),
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok || !data.success) throw new Error(data.message || 'Failed to save');
                        setAccountsProfileSuccess('Saved successfully.');
                      } catch (e) {
                        setAccountsProfileError(e.message || 'Unable to save');
                      } finally {
                        setAccountsProfileSaving(false);
                      }
                    }}
                  >
                    {accountsProfileSaving ? 'Saving...' : 'Save Accounts Profile'}
                  </button>
                ) : (
                  null
                )}
              </div>
            </div>

            <div className="table-container-card" style={{ marginTop: '16px' }}>
              <div className="card-header-row">
                <h3 className="section-title">Uploaded Documents</h3>
              </div>
              {(() => {
                const docs = selectedEmployee?.documents || {};
                const docItems = [
                  { key: 'passbook_front', label: 'Passbook' },
                  { key: 'pan_front', label: 'PAN Front' },
                  { key: 'pan_back', label: 'PAN Back' },
                  { key: 'aadhaar_front', label: 'Aadhaar Front' },
                  { key: 'aadhaar_back', label: 'Aadhaar Back' },
                  { key: 'appointment_letter', label: 'Appointment Letter' },
                ];
                const hasAny = docItems.some((d) => !!docs?.[d.key]) || !!selectedEmployee?.form16Path;
                if (!hasAny) return <p>No documents uploaded.</p>;
                const leftItems = docItems.slice(0, 3);
                const rightItems = docItems.slice(3, 6);
                return (
                  <>
                    <div className="accounts-docs-grid">
                      <div>
                        {leftItems.map((d) => (
                          <div key={d.key} style={{ marginBottom: '10px' }}>
                            <div className="flex-between" style={{ marginBottom: '6px' }}>
                              <span>{d.label}</span>
                              <span>{docs?.[d.key] ? 'Available' : 'Not uploaded'}</span>
                            </div>
                            {docs?.[d.key] && (
                              <button
                                type="button"
                                className="text-link"
                                onClick={() => openProtectedFile(docs[d.key])}
                              >
                                View
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div>
                        {rightItems.map((d) => (
                          <div key={d.key} style={{ marginBottom: '10px' }}>
                            <div className="flex-between" style={{ marginBottom: '6px' }}>
                              <span>{d.label}</span>
                              <span>{docs?.[d.key] ? 'Available' : 'Not uploaded'}</span>
                            </div>
                            {docs?.[d.key] && (
                              <button
                                type="button"
                                className="text-link"
                                onClick={() => openProtectedFile(docs[d.key])}
                              >
                                View
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ marginBottom: '10px' }}>
                      <div className="flex-between" style={{ marginBottom: '6px' }}>
                        <span>Form 16</span>
                        <span>{selectedEmployee?.form16Path ? 'Available' : 'Not uploaded'}</span>
                      </div>
                      {selectedEmployee?.form16Path && (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => openProtectedFile(selectedEmployee.form16Path)}
                        >
                          View
                        </button>
                      )}
                    </div>
                  </>
                );
              })()}
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