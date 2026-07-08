import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { 
  Users, FileText, TrendingUp, Download, 
  Send, Calculator, ChevronDown, ChevronRight, 
  ArrowLeft, Upload, FileCheck, Receipt, Landmark
} from 'lucide-react';
import './Account.css';
import { useUser } from '../../components/layout/UserContext';
import { DepartmentNocPanel } from '../Manager/comps/DepartmentNocPanel';
import { fetchDepartmentNocRequests } from '../Manager/api';
import { hasFeature } from '../../utils/planFeatures';
import EmployeeIdentityDocsPanel from '../../components/EmployeeIdentityDocsPanel';
import { TaxDeclarationReview } from '../TaxDeclaration/TaxDeclarationReview';
import { TaxDeclarationReviewDetail } from '../TaxDeclaration/TaxDeclarationReviewDetail';
import { formatDate as formatDateDDMMYYYY, formatDateTime as formatDateTimeDDMMYYYY } from '../../utils/dateFormat';
import { formatCtcRupee, resolveAnnualCtcTotal, resolveTotalCtcAnnual } from '../../utils/ctcBreakupDisplay';
import {
  defaultFinancialYear,
  formatFinancialYearInput,
  isValidFinancialYear,
} from '../../utils/financialYear';

const TAX_REGIME_OPTIONS = ['New Tax Regime', 'Old Tax regime'];

const ctcAllowanceFieldsFromRecord = (c = {}) => {
  const hasHeads =
    Number(c.special_allowance || 0)
    + Number(c.conveyance_allowance || 0)
    + Number(c.medical_allowance || 0)
    + Number(c.lta_allowance || 0) > 0;
  if (hasHeads) {
    return {
      special_allowance: c.special_allowance ?? '',
      conveyance_allowance: c.conveyance_allowance ?? '',
      medical_allowance: c.medical_allowance ?? '',
      lta_allowance: c.lta_allowance ?? '',
    };
  }
  return {
    special_allowance: c.other_allowance ?? '',
    conveyance_allowance: '',
    medical_allowance: '',
    lta_allowance: '',
  };
};

const ctcAllowancePayload = (form) => ({
  special_allowance: form.special_allowance || 0,
  conveyance_allowance: form.conveyance_allowance || 0,
  medical_allowance: form.medical_allowance || 0,
  lta_allowance: form.lta_allowance || 0,
});

const ctcMetroHraPayload = (metroMode) => {
  if (metroMode === 'metro') return { is_metro_hra: true };
  if (metroMode === 'nonmetro') return { is_metro_hra: false };
  return {};
};

const ctcAdvancedPayload = ({
  vpfMonthly,
  includeNps,
  npsPct,
  reimbursementMonthly,
  metroMode,
}) => ({
  vpf_monthly: Number(vpfMonthly || 0),
  include_nps_in_ctc: includeNps,
  nps_employer_pct: Number(npsPct || 10),
  reimbursement_monthly: Number(reimbursementMonthly || 0),
  ...ctcMetroHraPayload(metroMode),
});

const ctcBasicWage = (form) =>
  Number(form.basic_salary || 0) + Number(form.dearness_allowance || 0);

const parseMediclaimYearly = (mediclaimValue) => {
  if (mediclaimValue === '' || mediclaimValue == null) return 0;
  const n = Number(mediclaimValue);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

const blockCtcNumberWheel = (e) => {
  e.currentTarget.blur();
};

const EMPLOYEE_SCOPED_VIEWS = new Set([
  'addForm16',
  'addPayslip',
  'ctcBreakup',
  'tdsProjection',
  'viewPayslip',
]);

const ACCOUNT_VIEWS = new Set([
  'main',
  'noc_requests',
  'employees',
  'addPayslip',
  'bulkPayslip',
  'bulkForm16',
  'bulkPayroll',
  'payrollHistory',
  'complianceExports',
  'payrollLifecycle',
  'expenseClaims',
  'taxDeclarations',
  'taxDeclarationDetail',
  'addForm16',
  'ctcBreakup',
  'tdsProjection',
  'viewPayslip',
]);

function getStoredAccountContext() {
  try {
    return JSON.parse(localStorage.getItem('account_form16_context') || '{}');
  } catch {
    return {};
  }
}

/** Restore a safe Accounts sub-view after hard refresh (avoid blank screen). */
function resolveStoredAccountView() {
  const view = localStorage.getItem('account_current_view') || 'main';
  const taxDeclRaw = localStorage.getItem('account_selected_tax_decl_id');
  const taxDeclId = taxDeclRaw ? Number(taxDeclRaw) : null;
  const ctx = getStoredAccountContext();
  const hasEmployee = Boolean(ctx?.selectedEmployee?.adminId);
  const hasDeptCircle = Boolean(ctx?.selectedDept && ctx?.selectedCircle);

  if (!ACCOUNT_VIEWS.has(view)) {
    return { view: 'main', taxDeclId: null };
  }

  if (view === 'taxDeclarationDetail') {
    if (!taxDeclId || Number.isNaN(taxDeclId)) {
      return { view: 'taxDeclarations', taxDeclId: null };
    }
    return { view, taxDeclId };
  }

  if (EMPLOYEE_SCOPED_VIEWS.has(view) && !hasEmployee) {
    return { view: hasDeptCircle ? 'employees' : 'main', taxDeclId: null };
  }

  if (view === 'employees' && !hasDeptCircle) {
    return { view: 'main', taxDeclId: null };
  }

  if (['bulkPayroll', 'payrollHistory', 'complianceExports', 'payrollLifecycle'].includes(view) && !hasDeptCircle) {
    return { view: 'main', taxDeclId: null };
  }

  return { view, taxDeclId: taxDeclId && !Number.isNaN(taxDeclId) ? taxDeclId : null };
}

export const Account = ()  => {
  const { userData } = useUser();
  const [searchParams] = useSearchParams();

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

  const isAccountsDept = ['account', 'accounts', 'accountant'].includes(
    ((userData?.user?.emp_type || '') + '').trim().toLowerCase()
  );

  const canEditAccountsProfile = isHr || isAccountsDept;

  const initialAccountContext = getStoredAccountContext();
  const initialViewState = resolveStoredAccountView();
  const [currentView, setCurrentView] = useState(initialViewState.view);
  const [expandedDept, setExpandedDept] = useState(null);
  const [selectedCircle, setSelectedCircle] = useState(initialAccountContext.selectedCircle || '');
  const [selectedDept, setSelectedDept] = useState(initialAccountContext.selectedDept || '');
  const [selectedEmployee, setSelectedEmployee] = useState(initialAccountContext.selectedEmployee || null);
  const [previousView, setPreviousView] = useState('employees');
  const [selectedTaxDeclId, setSelectedTaxDeclId] = useState(initialViewState.taxDeclId);
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
  const [nocSummary, setNocSummary] = useState({
    pending: 0,
    total: 0,
    loading: true,
  });
  const [taxDeclSummary, setTaxDeclSummary] = useState({
    pending: 0,
    loading: true,
  });
  const [attendanceMonth, setAttendanceMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attendancePickerOpen, setAttendancePickerOpen] = useState(false);
  const [pendingAttendanceMonth, setPendingAttendanceMonth] = useState(attendanceMonth);
  const [attendanceDownloadMode, setAttendanceDownloadMode] = useState('accounts'); // 'accounts' or 'client'
  const [empHeaderMenu, setEmpHeaderMenu] = useState(null); // 'bulk' | 'payroll' | null
  const empHeaderToolbarRef = useRef(null);
  
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
  const [complianceError, setComplianceError] = useState('');
  const [complianceLoading, setComplianceLoading] = useState(false);
  const [complianceQuarter, setComplianceQuarter] = useState(1);
  const [complianceFy, setComplianceFy] = useState(defaultFinancialYear());
  const [ptSummary, setPtSummary] = useState(null);
  const [ptCalendar, setPtCalendar] = useState([]);
  const [lifecycleEmployeeId, setLifecycleEmployeeId] = useState('');
  const [fnfSeparationDate, setFnfSeparationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [fnfLastWorkingDay, setFnfLastWorkingDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [fnfNoticeDays, setFnfNoticeDays] = useState(0);
  const [fnfIncludeCl, setFnfIncludeCl] = useState(false);
  const [fnfPreview, setFnfPreview] = useState(null);
  const [fnfSettlements, setFnfSettlements] = useState([]);
  const [fnfStatusUpdatingId, setFnfStatusUpdatingId] = useState(null);
  const [pendingSalaryRevisions, setPendingSalaryRevisions] = useState([]);
  const [encashPreview, setEncashPreview] = useState(null);
  const [salaryLoans, setSalaryLoans] = useState([]);
  const [loanForm, setLoanForm] = useState({ principal_amount: '', emi_monthly: '', description: '' });
  const [payrollRows, setPayrollRows] = useState([]);
  const [isPayrollSaving, setIsPayrollSaving] = useState(false);
  const [isPayrollStatusUpdating, setIsPayrollStatusUpdating] = useState(false);
  const [isBonusRunLoading, setIsBonusRunLoading] = useState(false);
  const [payrollHistoryRows, setPayrollHistoryRows] = useState([]);
  const [payrollHistoryLoading, setPayrollHistoryLoading] = useState(false);
  const [payrollHistoryError, setPayrollHistoryError] = useState('');
  const [expenseClaims, setExpenseClaims] = useState([]);
  const [expenseClaimsLoading, setExpenseClaimsLoading] = useState(false);
  const [expenseClaimsError, setExpenseClaimsError] = useState('');
  const [expenseClaimFilters, setExpenseClaimFilters] = useState({
    circle: 'All',
    emp_type: 'All',
    month_year: '',
    q: '',
  });
  const [expenseClaimFilterOptions, setExpenseClaimFilterOptions] = useState({
    circles: [],
    emp_types: [],
  });
  const [expandedClaimIds, setExpandedClaimIds] = useState({});
  const [claimLineActionModal, setClaimLineActionModal] = useState(null);
  const [claimRejectionReason, setClaimRejectionReason] = useState('');
  const [claimLineActionLoading, setClaimLineActionLoading] = useState(null);
  const [claimLineActionError, setClaimLineActionError] = useState('');
  const [claimExcelDownloading, setClaimExcelDownloading] = useState(null);
  const [bulkForm16Year, setBulkForm16Year] = useState(defaultFinancialYear);
  const [bulkForm16Files, setBulkForm16Files] = useState([]);
  const [isBulkForm16Uploading, setIsBulkForm16Uploading] = useState(false);
  const [bulkForm16UploadResult, setBulkForm16UploadResult] = useState(null);
  const [tracesCsvFile, setTracesCsvFile] = useState(null);
  const [tracesImportResult, setTracesImportResult] = useState(null);
  const [isTracesImporting, setIsTracesImporting] = useState(false);
  const [form16FinancialYear, setForm16FinancialYear] = useState('');
  const [form16File, setForm16File] = useState(null);
  const [form16Parsed, setForm16Parsed] = useState({
    parsed_gross_salary: '',
    parsed_tds_deducted: '',
    parsed_taxable_income: '',
    parsed_annual_tax: '',
  });
  const [form16OfficialTraces, setForm16OfficialTraces] = useState(false);
  const [form16PartType, setForm16PartType] = useState('combined');
  const [isForm16Uploading, setIsForm16Uploading] = useState(false);
  const [form16History, setForm16History] = useState([]);
  const [form16HistoryLoading, setForm16HistoryLoading] = useState(false);
  const [form16HistoryError, setForm16HistoryError] = useState('');
  const [ctcForm, setCtcForm] = useState({
    basic_salary: '',
    dearness_allowance: '',
    special_allowance: '',
    conveyance_allowance: '',
    medical_allowance: '',
    lta_allowance: '',
    hra: '',
    epf: '',
    esic: '',
    ptax: '',
  });
  const [ctcVariableAnnual, setCtcVariableAnnual] = useState('');
  const [ctcIncludePfAdmin, setCtcIncludePfAdmin] = useState(true);
  const [ctcIncludeEdli, setCtcIncludeEdli] = useState(true);
  const [ctcIncludeBonus, setCtcIncludeBonus] = useState(false);
  const [ctcIncludeLwf, setCtcIncludeLwf] = useState(false);
  const [ctcVpfMonthly, setCtcVpfMonthly] = useState('');
  const [ctcIncludeNps, setCtcIncludeNps] = useState(false);
  const [ctcNpsPct, setCtcNpsPct] = useState('10');
  const [ctcMetroMode, setCtcMetroMode] = useState('auto');
  const [ctcReimbursementMonthly, setCtcReimbursementMonthly] = useState('');
  const [ctcPtaxState, setCtcPtaxState] = useState('MH');
  const [ctcPolicy, setCtcPolicy] = useState(null);
  const [ctcPolicySaving, setCtcPolicySaving] = useState(false);
  const [ctcPolicyDraft, setCtcPolicyDraft] = useState(null);
  const [ctcPdfDownloading, setCtcPdfDownloading] = useState(false);
  const [ctcMonth, setCtcMonth] = useState(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`; // YYYY-MM
  });
  const [ctcAnnual, setCtcAnnual] = useState('');
  const [ctcMediclaim, setCtcMediclaim] = useState('');
  const [ctcHraPct, setCtcHraPct] = useState('40');
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
    gratuity_yearly: 0,
    gratuity_monthly: 0,
    employer_pf_yearly: 0,
    employer_pf_monthly: 0,
    employer_esic_yearly: 0,
    employer_esic_monthly: 0,
    mediclaim_yearly: 0,
    pf_admin_yearly: 0,
    pf_admin_monthly: 0,
    edli_yearly: 0,
    edli_monthly: 0,
    statutory_bonus_yearly: 0,
    statutory_bonus_monthly: 0,
    lwf_employer_yearly: 0,
    lwf_employer_monthly: 0,
    nps_employer_yearly: 0,
    nps_employer_monthly: 0,
    eps_contribution_yearly: 0,
    epf_er_contribution_yearly: 0,
    vpf_amount: 0,
    epf_statutory_amount: 0,
    is_metro_hra: false,
    ptax_state: 'MH',
    esic_applicable: false,
    esic_wage_ceiling: 21001,
    ptax_gender_unknown: false,
    annual_ctc_total: 0,
    fixed_ctc_annual: 0,
    variable_ctc_annual: 0,
    total_ctc_annual: 0,
  });
  const [ctcCalcError, setCtcCalcError] = useState('');
  const [ctcSaving, setCtcSaving] = useState(false);
  const [ctcLoading, setCtcLoading] = useState(false);
  const [ctcError, setCtcError] = useState('');
  const [ctcSuccess, setCtcSuccess] = useState('');
  const [ctcHistoryExpanded, setCtcHistoryExpanded] = useState(true);
  const [ctcHistory, setCtcHistory] = useState([]);
  const [ctcHistoryLoading, setCtcHistoryLoading] = useState(false);
  const [ctcHistoryError, setCtcHistoryError] = useState('');
  const [ctcEffectiveFrom, setCtcEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [ctcRevisionNote, setCtcRevisionNote] = useState('');
  const [ctcArrearsPreview, setCtcArrearsPreview] = useState(null);
  const [ctcArrearsApplying, setCtcArrearsApplying] = useState(false);
  const [tdsProjection, setTdsProjection] = useState(null);
  const [tdsLoading, setTdsLoading] = useState(false);
  const [tdsError, setTdsError] = useState('');
  const [tdsForm, setTdsForm] = useState({
    financial_year: defaultFinancialYear(),
    rent_paid_annual: '',
    section_80c_extra: '',
    section_80d: '',
    is_metro: false,
    previous_employer_tds: '',
  });
  const ctcApplyingReverseRef = useRef(false);
  const ctcWantsReverseRef = useRef(false);

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
  const [regimeOverrideForm, setRegimeOverrideForm] = useState({
    tax_regime: '',
    reason: '',
  });
  const [regimeOverrideSaving, setRegimeOverrideSaving] = useState(false);

  const API_BASE_URL = '/api/accounts';

  useEffect(() => {
    localStorage.setItem('account_current_view', currentView);
  }, [currentView]);

  useEffect(() => {
    if (!empHeaderMenu) return undefined;
    const onDocClick = (e) => {
      if (empHeaderToolbarRef.current && !empHeaderToolbarRef.current.contains(e.target)) {
        setEmpHeaderMenu(null);
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setEmpHeaderMenu(null);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [empHeaderMenu]);

  useEffect(() => {
    if (currentView !== 'employees') {
      setEmpHeaderMenu(null);
    }
  }, [currentView]);

  useEffect(() => {
    if (selectedTaxDeclId) {
      localStorage.setItem('account_selected_tax_decl_id', String(selectedTaxDeclId));
    } else {
      localStorage.removeItem('account_selected_tax_decl_id');
    }
  }, [selectedTaxDeclId]);

  useEffect(() => {
    if (currentView === 'taxDeclarationDetail' && !selectedTaxDeclId) {
      setCurrentView('taxDeclarations');
    }
  }, [currentView, selectedTaxDeclId]);

  useEffect(() => {
    localStorage.setItem('account_form16_context', JSON.stringify({
      selectedDept,
      selectedCircle,
      selectedEmployee
    }));
  }, [selectedDept, selectedCircle, selectedEmployee]);

  const formatCurrency = (value) => {
    try {
      return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(value || 0);
    } catch {
      return `₹${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  };

  const handleOpenExpenseClaims = useCallback(() => {
    setPreviousView('main');
    setCurrentView('expenseClaims');
  }, []);

  const handleOpenNocRequests = useCallback(() => {
    setCurrentView('noc_requests');
  }, []);

  const handleOpenTaxDeclarations = useCallback(() => {
    setCurrentView('taxDeclarations');
  }, []);

  const canReviewTaxDeclarations = isHr || isAccountsDept;

  const stats = useMemo(() => {
    const base = [
      { title: 'Total Employees', value: statsData.total_employees, subtitle: 'Active employees', icon: <Users size={20} /> },
      { title: 'Payslips Generated', value: statsData.payslips_generated, subtitle: 'Current month', icon: <FileText size={20} /> },
      {
        title: 'Expense Claims',
        value: formatCurrency(statsData.ytd_expenses),
        subtitle: 'Year to date (Jan–today)',
        icon: <TrendingUp size={20} />,
        clickable: true,
        onClick: handleOpenExpenseClaims,
      },
    ];

    if (isAccountsDept) {
      const pending = nocSummary.pending;
      const total = nocSummary.total;
      base.push({
        title: 'NOC Requests',
        value: nocSummary.loading ? '—' : pending,
        subtitle: pending > 0
          ? `${pending} awaiting Accounts NOC`
          : total > 0
            ? 'No pending clearances'
            : 'No separation requests',
        icon: <FileCheck size={20} />,
        clickable: true,
        onClick: handleOpenNocRequests,
        hasNotification: !nocSummary.loading && pending > 0,
        notificationText: pending === 1 ? '1 NOC not submitted' : `${pending} NOCs not submitted`,
      });
    }

    if (canReviewTaxDeclarations) {
      const pending = taxDeclSummary.pending;
      base.push({
        title: 'Tax Declarations',
        value: taxDeclSummary.loading ? '—' : pending,
        subtitle: pending > 0
          ? `${pending} awaiting review`
          : 'Employee tax saving declarations',
        icon: <Receipt size={20} />,
        clickable: true,
        onClick: handleOpenTaxDeclarations,
        hasNotification: !taxDeclSummary.loading && pending > 0,
        notificationText: pending === 1 ? '1 declaration pending' : `${pending} declarations pending`,
      });
    }

    return base;
  }, [
    statsData,
    isAccountsDept,
    canReviewTaxDeclarations,
    nocSummary,
    taxDeclSummary,
    handleOpenExpenseClaims,
    handleOpenNocRequests,
    handleOpenTaxDeclarations,
  ]);

  useRefreshOnNavigate(() => {
    if (currentView !== 'main') return;
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
    loadPayrollSummary();
  }, [currentView]);

  useEffect(() => {
    if (!isAccountsDept || currentView !== 'main') return;

    let cancelled = false;
    const loadNocSummary = async () => {
      try {
        setNocSummary((prev) => ({ ...prev, loading: true }));
        const rows = await fetchDepartmentNocRequests('/api/accounts', 'All');
        if (cancelled) return;
        const pending = (rows || []).filter(
          (r) => (r.status || '').trim().toLowerCase() === 'pending'
        ).length;
        setNocSummary({
          pending,
          total: (rows || []).length,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setNocSummary({ pending: 0, total: 0, loading: false });
        }
      }
    };

    loadNocSummary();
    return () => { cancelled = true; };
  }, [isAccountsDept, currentView]);

  useEffect(() => {
    if (!canReviewTaxDeclarations || currentView !== 'main') return;

    let cancelled = false;
    const loadTaxDeclSummary = async () => {
      try {
        setTaxDeclSummary((prev) => ({ ...prev, loading: true }));
        const token = localStorage.getItem('token');
        const fyCurrent = defaultFinancialYear();
        const res = await fetch(
          `${API_BASE_URL}/tax-declarations?status=submitted&financial_year=${encodeURIComponent(fyCurrent)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const data = await res.json();
        if (cancelled) return;
        const pending = data.success ? (data.declarations || []).length : 0;
        setTaxDeclSummary({ pending, loading: false });
      } catch {
        if (!cancelled) {
          setTaxDeclSummary({ pending: 0, loading: false });
        }
      }
    };

    loadTaxDeclSummary();
    return () => { cancelled = true; };
  }, [canReviewTaxDeclarations, currentView, API_BASE_URL]);

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
        empId: emp.emp_id || String(emp.id),
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

  const downloadProtectedFile = async (filePath, downloadName) => {
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
        let msg = 'Unable to download file';
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
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = downloadName || filePath.split('/').pop() || 'attachment';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      alert(e.message || 'Unable to download file');
    }
  };

  const loadExpenseClaims = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setExpenseClaimsLoading(true);
    setExpenseClaimsError('');
    try {
      const params = new URLSearchParams();
      if (expenseClaimFilters.circle && expenseClaimFilters.circle !== 'All') {
        params.set('circle', expenseClaimFilters.circle);
      }
      if (expenseClaimFilters.emp_type && expenseClaimFilters.emp_type !== 'All') {
        params.set('emp_type', expenseClaimFilters.emp_type);
      }
      if (expenseClaimFilters.month_year) {
        params.set('month_year', expenseClaimFilters.month_year);
      }
      if (expenseClaimFilters.q.trim()) {
        params.set('q', expenseClaimFilters.q.trim());
      }
      const response = await fetch(`${API_BASE_URL}/expense-claims?${params.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load expense claims');
      }
      setExpenseClaims(result.claims || []);
      setExpenseClaimFilterOptions(result.filter_options || { circles: [], emp_types: [] });
    } catch (error) {
      console.error('Expense claims error:', error);
      setExpenseClaims([]);
      setExpenseClaimsError(error.message || 'Unable to load expense claims');
    } finally {
      setExpenseClaimsLoading(false);
    }
  };

  const toggleClaimExpanded = (claimId) => {
    setExpandedClaimIds((prev) => ({ ...prev, [claimId]: !prev[claimId] }));
  };

  const claimStatusBadgeClass = (status) => {
    const s = (status || '').toLowerCase();
    if (s === 'approved') return 'badge-processed';
    if (s === 'rejected') return 'badge-rejected';
    if (s.includes('partial')) return 'badge-partial';
    return 'badge-pending';
  };

  const formatClaimDate = (value) => formatDateDDMMYYYY(value, '-');

  const handleDownloadClaimExcel = async (claim) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Session expired. Please login again.');
      return;
    }
    const claimId = claim?.id;
    if (!claimId) return;

    setClaimExcelDownloading(claimId);
    try {
      const response = await fetch(`${API_BASE_URL}/expense-claims/${claimId}/excel`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });

      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || contentType.includes('application/json')) {
        let message = 'Unable to download claim excel';
        try {
          const err = await response.json();
          message = err.message || message;
        } catch {
          // keep fallback
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') || '';
      const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
      const empPart = (claim.emp_id || 'claim').replace(/\s+/g, '_');
      const fileName = match
        ? decodeURIComponent(match[1].replace(/"/g, ''))
        : `Expense_Claim_${empPart}_${claimId}.xlsx`;

      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Claim excel download error:', error);
      alert(error.message || 'Unable to download claim excel');
    } finally {
      setClaimExcelDownloading(null);
    }
  };

  const updateClaimLineItemInState = (claimId, lineItemId, patch, claimStatus) => {
    setExpenseClaims((prev) =>
      prev.map((claim) => {
        if (claim.id !== claimId) return claim;
        const line_items = (claim.line_items || []).map((li) =>
          li.id === lineItemId ? { ...li, ...patch } : li
        );
        return {
          ...claim,
          line_items,
          status: claimStatus || claim.status,
        };
      })
    );
  };

  const actOnClaimLineItem = async (claimId, lineItemId, action, rejectionReason = '') => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Session expired. Please login again.');
      return;
    }
    setClaimLineActionLoading(lineItemId);
    setClaimLineActionError('');
    try {
      const response = await fetch(`${API_BASE_URL}/expense-claims/line-items/${lineItemId}/action`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          rejection_reason: rejectionReason || undefined,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Unable to update claim item');
      }
      updateClaimLineItemInState(
        claimId,
        lineItemId,
        {
          status: result.line_item?.status,
          rejection_reason: result.line_item?.rejection_reason || null,
        },
        result.claim_status
      );
      setClaimLineActionModal(null);
      setClaimRejectionReason('');
    } catch (error) {
      setClaimLineActionError(error.message || 'Unable to update claim item');
    } finally {
      setClaimLineActionLoading(null);
    }
  };

  const handleApproveClaimLineItem = (claimId, lineItemId) => {
    if (!window.confirm('Approve this expense line item?')) return;
    actOnClaimLineItem(claimId, lineItemId, 'approve');
  };

  const handleOpenRejectClaimModal = (claimId, lineItemId) => {
    setClaimLineActionError('');
    setClaimRejectionReason('');
    setClaimLineActionModal({ claimId, lineItemId });
  };

  const handleConfirmRejectClaimLineItem = () => {
    if (!claimLineActionModal) return;
    const reason = claimRejectionReason.trim();
    if (!reason) {
      setClaimLineActionError('Please enter a reason for rejection.');
      return;
    }
    actOnClaimLineItem(
      claimLineActionModal.claimId,
      claimLineActionModal.lineItemId,
      'reject',
      reason
    );
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
    if (!hasFeature('account_for_client')) {
      alert('For Client export is not included in your subscription plan.');
      return;
    }
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

  const formatDateTime = (value) => formatDateTimeDDMMYYYY(value, '-');

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
    return formatDateTimeDDMMYYYY(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`, '-');
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
      setRegimeOverrideForm({
        tax_regime: p.tax_regime_override || p.tax_regime || '',
        reason: p.tax_regime_override_reason || '',
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

  const loadCtcPolicy = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/ctc-policy`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();
      if (response.ok && result.success) {
        setCtcPolicy(result.policy || null);
        if (!ctcPolicyDraft) {
          setCtcPolicyDraft(result.policy || null);
        }
      }
    } catch (error) {
      console.error('CTC policy load error:', error);
    }
  };

  const handleSaveCtcPolicy = async () => {
    if (!ctcPolicyDraft) return;
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }
    try {
      setCtcPolicySaving(true);
      const response = await fetch(`${API_BASE_URL}/ctc-policy`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ctcPolicyDraft),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to save CTC policy');
      }
      setCtcPolicy(result.policy || null);
      setCtcPolicyDraft(result.policy || null);
      setCtcSuccess('Company CTC policy saved.');
    } catch (error) {
      setCtcError(error.message || 'Unable to save CTC policy');
    } finally {
      setCtcPolicySaving(false);
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
      const basic = Number(c.basic_salary || 0);
      const hraAmt = Number(c.hra || 0);
      setCtcAnnual(
        c.annual_ctc != null && c.annual_ctc !== '' ? String(c.annual_ctc) : '',
      );
      ctcWantsReverseRef.current = Boolean(
        c.annual_ctc && Number(c.annual_ctc) > 0 && !(Number(c.basic_salary || 0) > 0),
      );
      setCtcMediclaim(c.mediclaim_yearly != null ? String(c.mediclaim_yearly) : '');
      setCtcVariableAnnual(
        c.variable_ctc_annual != null && c.variable_ctc_annual !== ''
          ? String(c.variable_ctc_annual)
          : '',
      );
      setCtcIncludePfAdmin(
        c.include_pf_admin_in_ctc == null ? true : Boolean(c.include_pf_admin_in_ctc),
      );
      setCtcIncludeEdli(
        c.include_edli_in_ctc == null ? true : Boolean(c.include_edli_in_ctc),
      );
      setCtcIncludeBonus(Boolean(c.include_statutory_bonus_in_ctc));
      setCtcIncludeLwf(Boolean(c.include_lwf_in_ctc));
      setCtcVpfMonthly(c.vpf_monthly != null && c.vpf_monthly !== '' ? String(c.vpf_monthly) : '');
      setCtcIncludeNps(Boolean(c.include_nps_in_ctc));
      setCtcNpsPct(c.nps_employer_pct != null ? String(c.nps_employer_pct) : '10');
      setCtcReimbursementMonthly(
        c.reimbursement_monthly != null && c.reimbursement_monthly !== ''
          ? String(c.reimbursement_monthly)
          : '',
      );
      if (c.is_metro_hra === true) setCtcMetroMode('metro');
      else if (c.is_metro_hra === false) setCtcMetroMode('nonmetro');
      else setCtcMetroMode('auto');
      setCtcPtaxState(c.ptax_state || ctcPolicy?.default_ptax_state || 'MH');
      setCtcForm({
        basic_salary: c.basic_salary ?? '',
        dearness_allowance: c.dearness_allowance ?? '',
        ...ctcAllowanceFieldsFromRecord(c),
        hra: c.hra ?? '',
        epf: c.epf ?? '',
        esic: c.esic ?? '',
        ptax: c.ptax ?? '',
      });
      if (c.hra_pct != null && c.hra_pct !== '') {
        setCtcHraPct(String(c.hra_pct));
      } else if (basic > 0 && hraAmt > 0) {
        const pct = (hraAmt / basic) * 100;
        if (pct >= 5 && pct <= 50) {
          setCtcHraPct(String(Math.round(pct * 100) / 100));
        } else {
          setCtcHraPct('40');
        }
      } else {
        setCtcHraPct('40');
      }
      setCtcEpfMode(c.epf_mode === 'percent' ? 'percent' : 'min');
      setCtcEpfPct(c.epf_pct != null && c.epf_pct !== '' ? String(c.epf_pct) : '');
      if (c.ptax_month) {
        setCtcMonth(c.ptax_month);
      }
      if (c.effective_from) {
        setCtcEffectiveFrom(String(c.effective_from).slice(0, 10));
      }
      setCtcArrearsPreview(null);
      setCtcComputed({
        hra_amount: Number(c.hra || 0),
        epf_amount: Number(c.epf || 0),
        ptax_amount: Number(c.ptax || 0),
        esic_employee_amount: Number(c.esic || 0),
        esic_employer_amount: Number(c.esic_employer || 0),
        gross_salary: Number(c.gross_salary || 0),
        net_salary: Number(c.net_salary || 0),
        deductions_total: Number(c.deductions_total || 0),
        gratuity_yearly: Number(c.gratuity_yearly || 0),
        gratuity_monthly: Number(c.gratuity_monthly || 0),
        employer_pf_yearly: Number(c.employer_pf_yearly || 0),
        employer_pf_monthly: Number(c.employer_pf_monthly || 0),
        employer_esic_yearly: Number(c.employer_esic_yearly || 0),
        employer_esic_monthly: Number(c.employer_esic_monthly || 0),
        mediclaim_yearly: Number(c.mediclaim_yearly || 0),
        pf_admin_yearly: Number(c.pf_admin_yearly || 0),
        pf_admin_monthly: Number(c.pf_admin_monthly || 0),
        edli_yearly: Number(c.edli_yearly || 0),
        edli_monthly: Number(c.edli_monthly || 0),
        statutory_bonus_yearly: Number(c.statutory_bonus_yearly || 0),
        statutory_bonus_monthly: Number(c.statutory_bonus_monthly || 0),
        lwf_employer_yearly: Number(c.lwf_employer_yearly || 0),
        lwf_employer_monthly: Number((c.lwf_employer_yearly || 0) / 12),
        ptax_state: c.ptax_state || 'MH',
        annual_ctc_total: resolveAnnualCtcTotal(c),
        fixed_ctc_annual: resolveAnnualCtcTotal(c),
        variable_ctc_annual: Number(c.variable_ctc_annual || 0),
        total_ctc_annual: resolveTotalCtcAnnual(c),
      });
    } catch (error) {
      console.error('CTC breakup load error:', error);
      setCtcError(error.message || 'Unable to load CTC breakup');
      setCtcForm({
        basic_salary: '',
        dearness_allowance: '',
        special_allowance: '',
        conveyance_allowance: '',
        medical_allowance: '',
        lta_allowance: '',
        hra: '',
        epf: '',
        esic: '',
        ptax: '',
      });
      setCtcAnnual('');
      setCtcMediclaim('');
      setCtcVariableAnnual('');
      setCtcIncludePfAdmin(true);
      setCtcIncludeEdli(true);
      setCtcIncludeBonus(false);
      setCtcIncludeLwf(false);
      setCtcVpfMonthly('');
      setCtcIncludeNps(false);
      setCtcNpsPct('10');
      setCtcMetroMode('auto');
      setCtcReimbursementMonthly('');
      setCtcPtaxState(ctcPolicy?.default_ptax_state || 'MH');
      setCtcHraPct('40');
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
    if (!hasFeature('account_ctc_breakup')) {
      alert('CTC Breakup is not included in your subscription plan.');
      return;
    }
    setPreviousView(currentView);
    setSelectedEmployee(emp);
    setCtcForm({
      basic_salary: '',
      dearness_allowance: '',
      special_allowance: '',
      conveyance_allowance: '',
      medical_allowance: '',
      lta_allowance: '',
      hra: '',
      epf: '',
      esic: '',
      ptax: '',
    });
    setCtcAnnual('');
    setCtcMediclaim('');
    setCtcVariableAnnual('');
    setCtcIncludePfAdmin(true);
    setCtcIncludeEdli(true);
    setCtcHraPct('40');
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
      gratuity_yearly: 0,
      gratuity_monthly: 0,
      employer_pf_yearly: 0,
      employer_pf_monthly: 0,
      employer_esic_yearly: 0,
      employer_esic_monthly: 0,
      mediclaim_yearly: 0,
      annual_ctc_total: 0,
      fixed_ctc_annual: 0,
      variable_ctc_annual: 0,
      total_ctc_annual: 0,
    });
    setCtcError('');
    setCtcSuccess('');
    setCtcEffectiveFrom(new Date().toISOString().slice(0, 10));
    setCtcRevisionNote('');
    setCtcArrearsPreview(null);
    setCurrentView('ctcBreakup');
    loadCtcBreakup(emp.adminId);
    loadCtcHistory(emp.adminId);
  };

  const applyCtcComputed = (computed, derived = {}, inputs = {}) => {
    const fixed = resolveAnnualCtcTotal({
      annual_ctc_computed: derived.annual_ctc_computed ?? computed.annual_ctc_total ?? computed.fixed_ctc_annual,
      gross_salary: computed.gross_salary,
      gratuity_yearly: derived.gratuity_yearly ?? computed.gratuity_yearly,
      employer_pf_yearly: computed.employer_pf_yearly,
      pf_admin_yearly: computed.pf_admin_yearly,
      edli_yearly: computed.edli_yearly,
      statutory_bonus_yearly: computed.statutory_bonus_yearly,
      lwf_employer_yearly: computed.lwf_employer_yearly,
      employer_esic_yearly: computed.employer_esic_yearly,
      mediclaim_yearly:
        derived.mediclaim_yearly ?? computed.mediclaim_yearly ?? computed?.inputs?.mediclaim_yearly,
    });
    const variable = Number(
      derived.variable_ctc_annual ?? computed.variable_ctc_annual ?? inputs.variable_ctc_annual ?? 0,
    );
    setCtcComputed({
      hra_amount: Number(computed.hra_amount || 0),
      epf_amount: Number(computed.epf_amount || 0),
      ptax_amount: Number(computed.ptax_amount || 0),
      esic_employee_amount: Number(computed.esic_employee_amount || 0),
      esic_employer_amount: Number(computed.esic_employer_amount || 0),
      gross_salary: Number(computed.gross_salary || 0),
      net_salary: Number(computed.net_salary || 0),
      deductions_total: Number(computed.deductions_total || 0),
      gratuity_yearly: Number(computed.gratuity_yearly || 0),
      gratuity_monthly: Number(computed.gratuity_monthly || 0),
      employer_pf_yearly: Number(computed.employer_pf_yearly || 0),
      employer_pf_monthly: Number(computed.employer_pf_monthly || 0),
      employer_esic_yearly: Number(computed.employer_esic_yearly || 0),
      employer_esic_monthly: Number(computed.employer_esic_monthly || 0),
      mediclaim_yearly: Number(
        derived.mediclaim_yearly ?? computed.mediclaim_yearly ?? computed?.inputs?.mediclaim_yearly ?? 0,
      ),
      pf_admin_yearly: Number(computed.pf_admin_yearly || 0),
      pf_admin_monthly: Number(computed.pf_admin_monthly || 0),
      edli_yearly: Number(computed.edli_yearly || 0),
      edli_monthly: Number(computed.edli_monthly || 0),
      statutory_bonus_yearly: Number(computed.statutory_bonus_yearly || 0),
      statutory_bonus_monthly: Number(computed.statutory_bonus_monthly || 0),
      lwf_employer_yearly: Number(computed.lwf_employer_yearly || 0),
      lwf_employer_monthly: Number(computed.lwf_employer_monthly || 0),
      nps_employer_yearly: Number(computed.nps_employer_yearly || 0),
      nps_employer_monthly: Number(computed.nps_employer_monthly || 0),
      eps_contribution_yearly: Number(computed.eps_contribution_yearly || 0),
      epf_er_contribution_yearly: Number(computed.epf_er_contribution_yearly || 0),
      vpf_amount: Number(computed.vpf_amount || 0),
      epf_statutory_amount: Number(computed.epf_statutory_amount || 0),
      is_metro_hra: Boolean(computed.is_metro_hra ?? inputs.is_metro_hra),
      ptax_state: computed.ptax_state || inputs.ptax_state || ctcPtaxState,
      esic_applicable: Boolean(computed.esic_applicable),
      esic_wage_ceiling: Number(computed.esic_wage_ceiling || 21001),
      ptax_gender_unknown: Boolean(computed.ptax_gender_unknown),
      annual_ctc_total: fixed,
      fixed_ctc_annual: fixed,
      variable_ctc_annual: variable,
      total_ctc_annual: Math.round((fixed + variable) * 100) / 100,
    });
    const basicToSync = derived.basic_salary != null ? derived.basic_salary : null;
    const daToSync = derived.dearness_allowance != null ? derived.dearness_allowance : null;
    setCtcForm((p) => ({
      ...p,
      ...(basicToSync != null ? { basic_salary: String(basicToSync) } : {}),
      ...(daToSync != null ? { dearness_allowance: String(daToSync) } : {}),
      special_allowance: String(
        derived.special_allowance ?? inputs.special_allowance ?? p.special_allowance ?? '',
      ),
      conveyance_allowance: String(
        derived.conveyance_allowance ?? inputs.conveyance_allowance ?? p.conveyance_allowance ?? '',
      ),
      medical_allowance: String(
        derived.medical_allowance ?? inputs.medical_allowance ?? p.medical_allowance ?? '',
      ),
      lta_allowance: String(
        derived.lta_allowance ?? inputs.lta_allowance ?? p.lta_allowance ?? '',
      ),
      hra: computed.hra_amount ?? '',
      epf: computed.epf_amount ?? '',
      ptax: computed.ptax_amount ?? '',
      esic: computed.esic_employee_amount ?? '',
    }));
  };

  useEffect(() => {
    if (currentView !== 'ctcBreakup') return;
    if (!selectedEmployee?.adminId) return;
    const token = localStorage.getItem('token');
    if (!token) return;

    const annual = Number(ctcAnnual || 0);
    const basicWage = ctcBasicWage(ctcForm);
    // Reverse-solve when Annual CTC is set and Basic+DA not yet entered (or user just changed annual).
    const useReverse = annual > 0 && (ctcWantsReverseRef.current || basicWage <= 0);

    if (!useReverse && (!basicWage || basicWage <= 0)) {
      setCtcCalcError('');
      setCtcComputed((p) => ({ ...p, gross_salary: 0, net_salary: 0, deductions_total: 0 }));
      return;
    }

    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        setCtcCalcError('');
        const endpoint = useReverse
          ? `${API_BASE_URL}/ctc-breakup/reverse-calculate`
          : `${API_BASE_URL}/ctc-breakup/calculate`;
        const mediclaimYearly = parseMediclaimYearly(ctcMediclaim);
        const variableYearly = parseMediclaimYearly(ctcVariableAnnual);
        const allowancePayload = ctcAllowancePayload(ctcForm);
        const advancedPayload = ctcAdvancedPayload({
          vpfMonthly: ctcVpfMonthly,
          includeNps: ctcIncludeNps,
          npsPct: ctcNpsPct,
          reimbursementMonthly: ctcReimbursementMonthly,
          metroMode: ctcMetroMode,
        });
        const body = useReverse
          ? {
              admin_id: selectedEmployee.adminId,
              annual_ctc: annual,
              hra_pct: ctcHraPct || 40,
              dearness_allowance: ctcForm.dearness_allowance || 0,
              ...allowancePayload,
              mediclaim_yearly: mediclaimYearly,
              variable_ctc_annual: variableYearly,
              include_pf_admin_in_ctc: ctcIncludePfAdmin,
              include_edli_in_ctc: ctcIncludeEdli,
              include_statutory_bonus_in_ctc: ctcIncludeBonus,
              include_lwf_in_ctc: ctcIncludeLwf,
              ptax_state: ctcPtaxState,
              epf_mode: ctcEpfMode,
              epf_pct: ctcEpfPct,
              month: ctcMonth,
              ...advancedPayload,
            }
          : {
              admin_id: selectedEmployee.adminId,
              basic_salary: ctcForm.basic_salary,
              dearness_allowance: ctcForm.dearness_allowance || 0,
              hra_pct: ctcHraPct,
              ...allowancePayload,
              mediclaim_yearly: mediclaimYearly,
              variable_ctc_annual: variableYearly,
              include_pf_admin_in_ctc: ctcIncludePfAdmin,
              include_edli_in_ctc: ctcIncludeEdli,
              include_statutory_bonus_in_ctc: ctcIncludeBonus,
              include_lwf_in_ctc: ctcIncludeLwf,
              ptax_state: ctcPtaxState,
              epf_mode: ctcEpfMode,
              epf_pct: ctcEpfPct,
              month: ctcMonth,
              ...advancedPayload,
            };
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const result = await response.json();
        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Unable to calculate CTC breakup');
        }
        if (cancelled) return;
        const computed = result?.data?.computed || {};
        const derived = result?.data?.derived || {};
        const inputs = result?.data?.inputs || {};
        if (useReverse) {
          ctcApplyingReverseRef.current = true;
          ctcWantsReverseRef.current = false;
          applyCtcComputed(computed, derived, inputs);
          if (derived.hra_pct != null) {
            setCtcHraPct(String(derived.hra_pct));
          }
          requestAnimationFrame(() => {
            ctcApplyingReverseRef.current = false;
          });
        } else {
          applyCtcComputed(computed, {}, inputs);
        }
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
    ctcAnnual,
    ctcMediclaim,
    ctcVariableAnnual,
    ctcIncludePfAdmin,
    ctcIncludeEdli,
    ctcIncludeBonus,
    ctcIncludeLwf,
    ctcVpfMonthly,
    ctcIncludeNps,
    ctcNpsPct,
    ctcMetroMode,
    ctcReimbursementMonthly,
    ctcPtaxState,
    ctcForm.basic_salary,
    ctcForm.dearness_allowance,
    ctcForm.special_allowance,
    ctcForm.conveyance_allowance,
    ctcForm.medical_allowance,
    ctcForm.lta_allowance,
    ctcHraPct,
    ctcEpfMode,
    ctcEpfPct,
    ctcMonth,
  ]);

  useEffect(() => {
    if (currentView !== 'ctcBreakup') return;
    loadCtcPolicy();
  }, [currentView]);

  useEffect(() => {
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
        if (!cancelled) {
          setAccountsProfileLoading(false);
        }
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
  }, [currentView, selectedEmployee?.adminId]);

  useRefreshOnNavigate(() => {
    if (currentView === 'employees' && selectedDept && selectedCircle) {
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
    if (!hasFeature('account_payroll')) {
      alert('Payroll is not included in your subscription plan.');
      return;
    }
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

  const handleOpenComplianceExports = () => {
    if (!hasFeature('account_payroll')) {
      alert('Compliance exports require the payroll feature in your plan.');
      return;
    }
    if (!selectedDept || !selectedCircle) {
      alert('Select a department and circle first (Results screen).');
      return;
    }
    setPreviousView(currentView);
    setComplianceError('');
    setPtSummary(null);
    setCurrentView('complianceExports');
  };

  const handleOpenPayrollLifecycle = () => {
    if (!hasFeature('account_payroll')) {
      alert('Payroll lifecycle requires the payroll feature in your plan.');
      return;
    }
    if (!selectedDept || !selectedCircle) {
      alert('Select a department and circle first (Results screen).');
      return;
    }
    setPreviousView(currentView);
    setComplianceError('');
    setFnfPreview(null);
    setEncashPreview(null);
    setLifecycleEmployeeId(employeesList[0]?.adminId ? String(employeesList[0].adminId) : '');
    setCurrentView('payrollLifecycle');
  };

  const complianceQueryParams = (extra = {}) => {
    const params = new URLSearchParams({
      year: bulkPayrollYear.trim(),
      month: bulkPayrollMonth,
      ...extra,
    });
    if (selectedCircle) params.set('circle', selectedCircle);
    if (selectedDept) params.set('emp_type', selectedDept);
    return params;
  };

  const downloadComplianceCsv = async (endpoint, filename, extraParams = {}) => {
    const token = localStorage.getItem('token');
    if (!token) {
      setComplianceError('Please login again.');
      return;
    }
    try {
      setComplianceLoading(true);
      setComplianceError('');
      const params = complianceQueryParams({ format: 'csv', ...extraParams });
      const res = await fetch(`${API_BASE_URL}${endpoint}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Download failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setComplianceError(e?.message || 'Compliance export failed');
    } finally {
      setComplianceLoading(false);
    }
  };

  const loadPtSummary = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      setComplianceLoading(true);
      setComplianceError('');
      const params = complianceQueryParams({ format: 'json' });
      const res = await fetch(`${API_BASE_URL}/compliance/pt-summary?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.message || 'Failed to load PT summary');
      }
      setPtSummary(result);
    } catch (e) {
      setComplianceError(e?.message || 'Unable to load PT summary');
    } finally {
      setComplianceLoading(false);
    }
  };

  const loadPtCalendar = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const params = new URLSearchParams({ year: bulkPayrollYear.trim() });
      const res = await fetch(`${API_BASE_URL}/compliance/pt-remittance-calendar?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setPtCalendar(result.calendar || []);
      }
    } catch {
      setPtCalendar([]);
    }
  };

  const loadSalaryLoans = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/payroll/loans?admin_id=${adminId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setSalaryLoans(result.loans || []);
      }
    } catch {
      setSalaryLoans([]);
    }
  };

  const loadFnfSettlements = async (adminId) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) return;
    try {
      const res = await fetch(`${API_BASE_URL}/payroll/fnf-settlements?admin_id=${adminId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setFnfSettlements(result.settlements || []);
      } else {
        setFnfSettlements([]);
      }
    } catch {
      setFnfSettlements([]);
    }
  };

  const loadPendingSalaryRevisions = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/pending-salary-revisions?status=pending`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await res.json();
      if (res.ok && result.success) {
        setPendingSalaryRevisions(result.requests || []);
      } else {
        setPendingSalaryRevisions([]);
      }
    } catch {
      setPendingSalaryRevisions([]);
    }
  };

  const completeSalaryRevision = async (reqId) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      await fetch(`${API_BASE_URL}/pending-salary-revisions/${reqId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status: 'completed' }),
      });
      await loadPendingSalaryRevisions();
    } catch {
      setComplianceError('Failed to update salary revision request');
    }
  };

  useEffect(() => {
    const adminId = searchParams.get('admin_id');
    const section = (searchParams.get('section') || '').toLowerCase();
    if (!adminId) return;
    if (section === 'fnf') {
      setCurrentView('payrollLifecycle');
      setLifecycleEmployeeId(String(adminId));
      if (selectedDept && selectedCircle) {
        setPreviousView('employees');
      } else {
        setPreviousView('main');
      }
    }
  }, [searchParams, selectedDept, selectedCircle]);

  const handlePreviewEncashment = async () => {
    const adminId = Number(lifecycleEmployeeId);
    if (!adminId) return;
    const token = localStorage.getItem('token');
    try {
      setComplianceLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/leave-encashment-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ admin_id: adminId, include_cl: fnfIncludeCl }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Preview failed');
      setEncashPreview(result.preview);
    } catch (e) {
      setComplianceError(e?.message || 'Leave encashment preview failed');
    } finally {
      setComplianceLoading(false);
    }
  };

  const handlePreviewFnf = async () => {
    const adminId = Number(lifecycleEmployeeId);
    if (!adminId) return;
    const token = localStorage.getItem('token');
    try {
      setComplianceLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/fnf-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          admin_id: adminId,
          separation_date: fnfSeparationDate,
          last_working_day: fnfLastWorkingDay,
          include_cl_encashment: fnfIncludeCl,
          notice_recovery_days: Number(fnfNoticeDays || 0),
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'FnF preview failed');
      setFnfPreview(result.preview);
    } catch (e) {
      setComplianceError(e?.message || 'FnF preview failed');
    } finally {
      setComplianceLoading(false);
    }
  };

  const handleSaveFnf = async () => {
    const adminId = Number(lifecycleEmployeeId);
    if (!adminId || !fnfPreview?.settlement) return;
    const token = localStorage.getItem('token');
    try {
      setComplianceLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/fnf-settlements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          admin_id: adminId,
          separation_date: fnfSeparationDate,
          last_working_day: fnfLastWorkingDay,
          settlement: fnfPreview.settlement,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Failed to save FnF');
      alert('FnF settlement saved.');
      await loadFnfSettlements(adminId);
    } catch (e) {
      setComplianceError(e?.message || 'Failed to save FnF settlement');
    } finally {
      setComplianceLoading(false);
    }
  };

  const handleUpdateFnfStatus = async (settlementId, status) => {
    const token = localStorage.getItem('token');
    if (!settlementId || !token) return;
    try {
      setFnfStatusUpdatingId(settlementId);
      const res = await fetch(`${API_BASE_URL}/payroll/fnf-settlements/${settlementId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Status update failed');
      if (status === 'paid') {
        alert('F&F marked as paid. Settlement PDF will be emailed to the employee via a secure link.');
      }
      const adminId = Number(lifecycleEmployeeId);
      if (adminId) await loadFnfSettlements(adminId);
    } catch (e) {
      setComplianceError(e?.message || 'Failed to update F&F status');
    } finally {
      setFnfStatusUpdatingId(null);
    }
  };

  const handleDownloadFnfPdf = async (settlementId) => {
    const token = localStorage.getItem('token');
    if (!settlementId || !token) return;
    try {
      const res = await fetch(`${API_BASE_URL}/payroll/fnf-settlements/${settlementId}/pdf`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('PDF download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `fnf-settlement-${settlementId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      setComplianceError(e?.message || 'Failed to download F&F PDF');
    }
  };

  const handleCreateLoan = async () => {
    const adminId = Number(lifecycleEmployeeId);
    if (!adminId) return;
    const token = localStorage.getItem('token');
    try {
      setComplianceLoading(true);
      const res = await fetch(`${API_BASE_URL}/payroll/loans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          admin_id: adminId,
          principal_amount: Number(loanForm.principal_amount || 0),
          emi_monthly: Number(loanForm.emi_monthly || 0),
          description: loanForm.description || undefined,
        }),
      });
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Failed to create loan');
      setLoanForm({ principal_amount: '', emi_monthly: '', description: '' });
      await loadSalaryLoans(adminId);
    } catch (e) {
      setComplianceError(e?.message || 'Failed to create loan');
    } finally {
      setComplianceLoading(false);
    }
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

      const calcNet = (gross, epf, ptax, esic, lwf, tds, arrears = 0, encash = 0, loan = 0, bonus = 0, reimb = 0) => {
        const g = Number(gross || 0) + Number(arrears || 0) + Number(encash || 0) + Number(bonus || 0) + Number(reimb || 0);
        return g - Number(epf || 0) - Number(ptax || 0) - Number(esic || 0) - Number(lwf || 0) - Number(loan || 0) - Number(tds || 0);
      };

      const mapped = (employeesList || []).map((emp) => {
        const p = payrollByAdminId.get(emp.adminId) || {};
        return {
          adminId: emp.adminId,
          empId: emp.id,
          name: emp.name,
          payroll_id: p.payroll_id,
          status: p.status || 'draft',
          one_day_salary: Number(p.one_day_salary || 0),
          gross_salary_for_month: Number(p.gross_salary_for_month || 0),
          actual_working_days: Math.max(0, Number(p.actual_working_days || 0)),
          epf_final: Number(p.epf_final || 0),
          ptax_final: Number(p.ptax_final || 0),
          esic_final: Number(p.esic_final || 0),
          lwf_final: Number(p.lwf_final || 0),
          arrears_gross_final: Number(p.arrears_gross_final || 0),
          leave_encashment_final: Number(p.leave_encashment_final || 0),
          loan_recovery_final: Number(p.loan_recovery_final || 0),
          statutory_bonus_final: Number(p.statutory_bonus_final || 0),
          tds_final: Number(p.tds_final || 0),
          net_salary_final: Number(p.net_salary_final || calcNet(
            p.gross_salary_for_month,
            p.epf_final,
            p.ptax_final,
            p.esic_final,
            p.lwf_final,
            p.tds_final,
            p.arrears_gross_final,
            p.leave_encashment_final,
            p.loan_recovery_final,
            p.statutory_bonus_final,
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

  const payrollRowEditable = (row) => (row?.status || 'draft') === 'draft';

  const handlePayrollStatusUpdate = async (status) => {
    if (!payrollRows.length) return;
    const token = localStorage.getItem('token');
    if (!token) {
      setBulkPayrollError('Please login again.');
      return;
    }
    try {
      setIsPayrollStatusUpdating(true);
      setBulkPayrollError('');
      const res = await fetch(`${API_BASE_URL}/payroll/status`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_ids: payrollRows.map((r) => r.adminId),
          month: bulkPayrollMonth,
          year: bulkPayrollYear.trim(),
          status,
        }),
      });
      const result = await res.json();
      if (!res.ok || (!result.success && !result.updated?.length)) {
        throw new Error(result.message || result.errors?.[0]?.message || 'Status update failed');
      }
      await handleGeneratePayrollForFiltered({ clearMessages: false });
    } catch (e) {
      setBulkPayrollError(e?.message || 'Payroll status update failed');
    } finally {
      setIsPayrollStatusUpdating(false);
    }
  };

  const handleStatutoryBonusRun = async (payoutMode = 'monthly') => {
    if (!payrollRows.length) return;
    const token = localStorage.getItem('token');
    if (!token) {
      setBulkPayrollError('Please login again.');
      return;
    }
    try {
      setIsBonusRunLoading(true);
      setBulkPayrollError('');
      const res = await fetch(`${API_BASE_URL}/payroll/statutory-bonus-run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          admin_ids: payrollRows.map((r) => r.adminId),
          month: bulkPayrollMonth,
          year: bulkPayrollYear.trim(),
          payout_mode: payoutMode,
        }),
      });
      const result = await res.json();
      if (!res.ok || (!result.success && !result.results?.length)) {
        throw new Error(result.message || result.errors?.[0]?.message || 'Bonus run failed');
      }
      await handleGeneratePayrollForFiltered({ clearMessages: false });
    } catch (e) {
      setBulkPayrollError(e?.message || 'Statutory bonus run failed');
    } finally {
      setIsBonusRunLoading(false);
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
        if (!payrollRowEditable(row)) {
          continue;
        }
        try {
          const payload = {
            admin_id: row.adminId,
            month: bulkPayrollMonth,
            year: bulkPayrollYear.trim(),
            epf_final: Number(row.epf_final || 0),
            ptax_final: Number(row.ptax_final || 0),
            esic_final: Number(row.esic_final || 0),
            lwf_final: Number(row.lwf_final || 0),
            arrears_gross_final: Number(row.arrears_gross_final || 0),
            leave_encashment_final: Number(row.leave_encashment_final || 0),
            loan_recovery_final: Number(row.loan_recovery_final || 0),
            tds_final: Number(row.tds_final || 0),
            actual_working_days: Number(row.actual_working_days || 0),
            apply_loan_balance: true,
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
    if (!isValidFinancialYear(bulkForm16Year)) {
      alert('Enter a valid financial year using 8 digits (e.g. 20262027 for 2026-2027).');
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

  const handleTracesCsvImport = async () => {
    if (!isValidFinancialYear(bulkForm16Year)) {
      alert('Enter a valid financial year using 8 digits (e.g. 20262027 for 2026-2027).');
      return;
    }
    if (!tracesCsvFile) {
      alert('Please choose a TRACES CSV file.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }
    try {
      setIsTracesImporting(true);
      setTracesImportResult(null);
      const payload = new FormData();
      payload.append('financial_year', bulkForm16Year.trim());
      payload.append('file', tracesCsvFile);
      const response = await fetch(`${API_BASE_URL}/form16/traces-import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: payload,
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'TRACES import failed');
      }
      setTracesImportResult(result);
      setTracesCsvFile(null);
      alert(`TRACES import complete. Imported: ${result.imported || 0}, Skipped: ${result.skipped || 0}`);
    } catch (error) {
      console.error('TRACES import error:', error);
      alert(error.message || 'TRACES import failed');
    } finally {
      setIsTracesImporting(false);
    }
  };

  const handleDownloadForm16Summary = async () => {
    if (!selectedEmployee?.adminId) return;
    if (!isValidFinancialYear(form16FinancialYear)) {
      alert('Enter a valid financial year (e.g. 2025-26).');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      alert('Please login again.');
      return;
    }
    try {
      const fy = form16FinancialYear.trim();
      const res = await fetch(
        `${API_BASE_URL}/form16/summary/${selectedEmployee.adminId}/download?financial_year=${encodeURIComponent(fy)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `form16-summary-${selectedEmployee.id || selectedEmployee.adminId}-${fy}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert(error.message || 'Unable to download Form 16 summary');
    }
  };

  const handleUploadForm16 = async () => {
    if (!selectedEmployee?.adminId) {
      alert('Employee not selected.');
      return;
    }
    if (!isValidFinancialYear(form16FinancialYear)) {
      alert('Enter a valid financial year using 8 digits (e.g. 20262027 for 2026-2027).');
      return;
    }
    if (!form16File) {
      alert('Please choose a Form 16 file.');
      return;
    }
    if (form16OfficialTraces && !form16File.name?.toLowerCase().endsWith('.pdf')) {
      alert('Official TRACES Form 16 must be a PDF file.');
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
    payload.append('certificate_type', form16OfficialTraces ? 'official_traces' : 'upload_manual');
    payload.append('part_type', form16PartType);
    if (form16Parsed.parsed_gross_salary !== '') {
      payload.append('parsed_gross_salary', form16Parsed.parsed_gross_salary);
    }
    if (form16Parsed.parsed_tds_deducted !== '') {
      payload.append('parsed_tds_deducted', form16Parsed.parsed_tds_deducted);
    }
    if (form16Parsed.parsed_taxable_income !== '') {
      payload.append('parsed_taxable_income', form16Parsed.parsed_taxable_income);
    }
    if (form16Parsed.parsed_annual_tax !== '') {
      payload.append('parsed_annual_tax', form16Parsed.parsed_annual_tax);
    }

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
      setForm16OfficialTraces(false);
      setForm16PartType('combined');
      await loadForm16History(selectedEmployee.adminId);
      await handleCircleSelect(selectedDept, selectedCircle, false);
    } catch (error) {
      console.error('Form 16 upload error:', error);
      alert(error.message || 'Unable to upload Form 16');
    } finally {
      setIsForm16Uploading(false);
    }
  };

  const handleSaveRegimeOverride = async () => {
    if (!selectedEmployee?.adminId) return;
    if (!regimeOverrideForm.reason.trim()) {
      alert('Reason is required for HR regime override.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) return;
    setRegimeOverrideSaving(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/employees/${selectedEmployee.adminId}/tax-regime-override`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            tax_regime: regimeOverrideForm.tax_regime,
            reason: regimeOverrideForm.reason.trim(),
          }),
        }
      );
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Override failed');
      setAccountsProfileSuccess('Tax regime override saved.');
      if (result.profile) {
        setAccountsProfileForm((p) => ({
          ...p,
          tax_regime: result.profile.tax_regime || p.tax_regime,
        }));
      }
    } catch (err) {
      setAccountsProfileError(err.message || 'Unable to save regime override');
    } finally {
      setRegimeOverrideSaving(false);
    }
  };

  const handleClearRegimeOverride = async () => {
    if (!selectedEmployee?.adminId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    setRegimeOverrideSaving(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}/employees/${selectedEmployee.adminId}/tax-regime-override`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
      );
      const result = await res.json();
      if (!res.ok || !result.success) throw new Error(result.message || 'Clear failed');
      setRegimeOverrideForm((p) => ({ ...p, reason: '' }));
      setAccountsProfileSuccess('Tax regime override cleared.');
    } catch (err) {
      setAccountsProfileError(err.message || 'Unable to clear override');
    } finally {
      setRegimeOverrideSaving(false);
    }
  };

  const handleDownloadCtcPdf = async () => {
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
      setCtcPdfDownloading(true);
      setCtcError('');
      const response = await fetch(
        `${API_BASE_URL}/ctc-breakup/${selectedEmployee.adminId}/pdf`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.message || 'Failed to download CTC annexure PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ctc-annexure-${selectedEmployee.id || selectedEmployee.adminId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('CTC PDF download error:', error);
      setCtcError(error.message || 'Unable to download CTC annexure PDF');
    } finally {
      setCtcPdfDownloading(false);
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
        basic_salary: ctcForm.basic_salary,
        dearness_allowance: ctcForm.dearness_allowance || 0,
        hra: ctcComputed.hra_amount ?? ctcForm.hra,
        hra_pct: ctcHraPct ? Number(ctcHraPct) : null,
        ...ctcAllowancePayload(ctcForm),
        gross_salary: ctcComputed.gross_salary,
        net_salary: ctcComputed.net_salary,
        deductions_total: ctcComputed.deductions_total,
        epf: ctcComputed.epf_amount,
        epf_mode: ctcEpfMode,
        epf_pct: ctcEpfMode === 'percent' && ctcEpfPct ? Number(ctcEpfPct) : null,
        esic: ctcComputed.esic_employee_amount,
        esic_employer: ctcComputed.esic_employer_amount,
        ptax: ctcComputed.ptax_amount,
        ptax_month: ctcMonth,
        ptax_state: ctcPtaxState,
        annual_ctc: ctcAnnual ? Number(ctcAnnual) : null,
        annual_ctc_computed: ctcComputed.fixed_ctc_annual ?? ctcComputed.annual_ctc_total,
        variable_ctc_annual: parseMediclaimYearly(ctcVariableAnnual),
        include_pf_admin_in_ctc: ctcIncludePfAdmin,
        include_edli_in_ctc: ctcIncludeEdli,
        include_statutory_bonus_in_ctc: ctcIncludeBonus,
        include_lwf_in_ctc: ctcIncludeLwf,
        mediclaim_yearly: parseMediclaimYearly(ctcMediclaim),
        gratuity_yearly: ctcComputed.gratuity_yearly,
        gratuity_monthly: ctcComputed.gratuity_monthly,
        employer_pf_yearly: ctcComputed.employer_pf_yearly,
        employer_pf_monthly: ctcComputed.employer_pf_monthly,
        pf_admin_yearly: ctcComputed.pf_admin_yearly,
        pf_admin_monthly: ctcComputed.pf_admin_monthly,
        edli_yearly: ctcComputed.edli_yearly,
        edli_monthly: ctcComputed.edli_monthly,
        statutory_bonus_yearly: ctcComputed.statutory_bonus_yearly,
        statutory_bonus_monthly: ctcComputed.statutory_bonus_monthly,
        lwf_employer_yearly: ctcComputed.lwf_employer_yearly,
        employer_esic_yearly: ctcComputed.employer_esic_yearly,
        employer_esic_monthly: ctcComputed.employer_esic_monthly,
        vpf_monthly: ctcComputed.vpf_amount ?? Number(ctcVpfMonthly || 0),
        include_nps_in_ctc: ctcIncludeNps,
        nps_employer_pct: Number(ctcNpsPct || 10),
        reimbursement_monthly: Number(ctcReimbursementMonthly || 0),
        ...ctcMetroHraPayload(ctcMetroMode),
        effective_from: ctcEffectiveFrom,
        revision_note: ctcRevisionNote || undefined,
        include_arrears_preview: true,
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
      if (result.arrears_preview) {
        setCtcArrearsPreview(result.arrears_preview);
      }
      await loadCtcBreakup(selectedEmployee.adminId);
      await loadCtcHistory(selectedEmployee.adminId);
    } catch (error) {
      console.error('CTC breakup save error:', error);
      setCtcError(error.message || 'Unable to save CTC breakup');
    } finally {
      setCtcSaving(false);
    }
  };

  const handlePreviewArrears = async () => {
    if (!selectedEmployee?.adminId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      setCtcError('');
      const today = new Date();
      const response = await fetch(`${API_BASE_URL}/ctc-breakup/arrears-preview`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          admin_id: selectedEmployee.adminId,
          effective_from: ctcEffectiveFrom,
          through_year: today.getFullYear(),
          through_month: today.getMonth() + 1,
          new_gross_monthly: ctcComputed.gross_salary,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Arrears preview failed');
      }
      setCtcArrearsPreview(result.preview || null);
    } catch (error) {
      setCtcError(error.message || 'Unable to preview arrears');
    }
  };

  const handleApplyArrears = async () => {
    if (!selectedEmployee?.adminId || !ctcArrearsPreview?.months?.length) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      setCtcArrearsApplying(true);
      setCtcError('');
      const response = await fetch(`${API_BASE_URL}/payroll/apply-arrears`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          admin_id: selectedEmployee.adminId,
          applications: ctcArrearsPreview.months.map((m) => ({
            year: m.year,
            month_num: m.month_num,
            arrears_gross: m.arrears_gross,
          })),
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to apply arrears');
      }
      setCtcSuccess(
        `Arrears applied to ${(result.updated || []).length} payroll month(s).`,
      );
    } catch (error) {
      setCtcError(error.message || 'Unable to apply arrears');
    } finally {
      setCtcArrearsApplying(false);
    }
  };

  const ctcHistorySnapshot = (item) => {
    const snap = item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : item;
    return {
      ...snap,
      id: item.id ?? snap.id,
      effective_from: item.effective_from || snap.effective_from,
      note: item.note,
      updated_at: item.created_at || item.updated_at || snap.updated_at,
    };
  };

  const ctcHistoryMetric = (value) =>
    Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const renderMainView = () => (
    <div className="fade-in">
      <div className="hr-stats-grid">
        {statsError && <div className="q-error">{statsError}</div>}
        {stats.map((stat, i) => (
          <div
            key={stat.title || i}
            className={`stat-card${stat.clickable ? ' stat-card-clickable' : ''}${stat.hasNotification ? ' stat-card-has-notify' : ''}`}
            role={stat.clickable ? 'button' : undefined}
            tabIndex={stat.clickable ? 0 : undefined}
            onClick={stat.clickable ? stat.onClick : undefined}
            onKeyDown={
              stat.clickable
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      stat.onClick?.();
                    }
                  }
                : undefined
            }
          >
            <div className="stat-card-body">
              {stat.hasNotification && (
                <span className="stat-card-notify" title={stat.notificationText}>
                  <span className="stat-card-notify-dot" aria-hidden="true" />
                  {stat.notificationText}
                </span>
              )}
              <p className="stat-label">{stat.title}</p>
              <h3 className="stat-value">{stat.value}</h3>
              <p className={`stat-sub${stat.hasNotification ? ' stat-sub-alert' : ''}`}>{stat.subtitle}</p>
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

          <div className="table-responsive payroll-dept-wrap">
            <table className="results-table payroll-dept-table">
              <thead>
                <tr>
                  <th>Department</th>
                  <th>Circle Selection</th>
                  <th>Employees</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payrollError && (
                  <tr>
                    <td colSpan="4" className="empty">{payrollError}</td>
                  </tr>
                )}
                {payrollSummary.map((dept) => (
                  <React.Fragment key={dept.department}>
                    <tr>
                      <td className="font-bold" data-label="Department">
                        <div className="payroll-dept-head">
                          <button
                            type="button"
                            className="btn-icon"
                            onClick={() => setExpandedDept(expandedDept === dept.department ? null : dept.department)}
                            aria-label={expandedDept === dept.department ? 'Collapse department' : 'Expand department'}
                          >
                            {expandedDept === dept.department ? <ChevronDown size={18}/> : <ChevronRight size={18}/>}
                          </button>
                          <span>{dept.department}</span>
                        </div>
                      </td>
                      <td data-label="Circle Selection">
                        <select
                          className="table-select"
                          onChange={(e) => handleCircleSelect(dept.department, e.target.value)}
                          value=""
                        >
                          <option value="" disabled>Select Circle</option>
                          {(dept.circles || []).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                      <td data-label="Employees">{dept.employees}</td>
                      <td data-label="Status">
                        <span className="badge-processed">active</span>
                      </td>
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
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
        <div className="emp-dept-header">
          <div className="emp-dept-header__main">
            <span className="emp-dept-header__icon-wrap" aria-hidden>
              <Users size={20} />
            </span>
            <div className="emp-dept-header__text">
              <div className="emp-dept-header__crumbs">
                <span className="emp-dept-chip emp-dept-chip--circle">{selectedCircle}</span>
                <span className="emp-dept-chip__sep" aria-hidden>›</span>
                <span className="emp-dept-chip emp-dept-chip--dept">{selectedDept}</span>
              </div>
              <h3 className="emp-dept-header__title">Employee roster</h3>
            </div>
          </div>
          <div className="emp-dept-header__aside">
            <span className="emp-dept-header__count">
              {employeesList.length} {employeesList.length === 1 ? 'employee' : 'employees'}
            </span>
            <div className="emp-header-toolbar" ref={empHeaderToolbarRef}>
              {hasFeature('account_for_client') ? (
                <button
                  type="button"
                  className="emp-toolbar-btn emp-toolbar-btn--client"
                  onClick={handleDownloadClientAttendanceExcel}
                >
                  <Download size={16} aria-hidden />
                  For Client
                </button>
              ) : null}
              <div className={`emp-toolbar-dropdown${empHeaderMenu === 'bulk' ? ' is-open' : ''}`}>
                <button
                  type="button"
                  className="emp-toolbar-btn emp-toolbar-btn--bulk"
                  aria-expanded={empHeaderMenu === 'bulk'}
                  aria-haspopup="menu"
                  onClick={() => setEmpHeaderMenu((prev) => (prev === 'bulk' ? null : 'bulk'))}
                >
                  <Upload size={16} aria-hidden />
                  Bulk Upload
                  <ChevronDown size={15} className="emp-toolbar-btn__chevron" aria-hidden />
                </button>
                {empHeaderMenu === 'bulk' ? (
                  <div className="emp-toolbar-menu" role="menu">
                    <button
                      type="button"
                      className="emp-toolbar-menu__item emp-toolbar-menu__item--payslip"
                      role="menuitem"
                      onClick={() => {
                        setEmpHeaderMenu(null);
                        handleOpenBulkPayslip();
                      }}
                    >
                      <span className="emp-toolbar-menu__icon"><FileText size={16} aria-hidden /></span>
                      <span className="emp-toolbar-menu__copy">
                        <span className="emp-toolbar-menu__label">Bulk Payslips</span>
                        <span className="emp-toolbar-menu__hint">Upload payslips for this department</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="emp-toolbar-menu__item emp-toolbar-menu__item--form16"
                      role="menuitem"
                      onClick={() => {
                        setEmpHeaderMenu(null);
                        handleOpenBulkForm16();
                      }}
                    >
                      <span className="emp-toolbar-menu__icon"><FileCheck size={16} aria-hidden /></span>
                      <span className="emp-toolbar-menu__copy">
                        <span className="emp-toolbar-menu__label">Bulk Form 16</span>
                        <span className="emp-toolbar-menu__hint">Upload Form 16 for multiple employees</span>
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
              {hasFeature('account_payroll') ? (
                <div className={`emp-toolbar-dropdown${empHeaderMenu === 'payroll' ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    className="emp-toolbar-btn emp-toolbar-btn--payroll"
                    aria-expanded={empHeaderMenu === 'payroll'}
                    aria-haspopup="menu"
                    onClick={() => setEmpHeaderMenu((prev) => (prev === 'payroll' ? null : 'payroll'))}
                  >
                    <Calculator size={16} aria-hidden />
                    Payroll
                    <ChevronDown size={15} className="emp-toolbar-btn__chevron" aria-hidden />
                  </button>
                  {empHeaderMenu === 'payroll' ? (
                    <div className="emp-toolbar-menu" role="menu">
                      <button
                        type="button"
                        className="emp-toolbar-menu__item emp-toolbar-menu__item--payroll"
                        role="menuitem"
                        disabled={isBulkPayrollGenerating}
                        onClick={() => {
                          setEmpHeaderMenu(null);
                          handleOpenBulkPayroll();
                        }}
                      >
                        <span className="emp-toolbar-menu__icon"><Calculator size={16} aria-hidden /></span>
                        <span className="emp-toolbar-menu__copy">
                          <span className="emp-toolbar-menu__label">
                            {isBulkPayrollGenerating ? 'Generating payroll…' : 'Run Payroll'}
                          </span>
                          <span className="emp-toolbar-menu__hint">Generate payroll for this department</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="emp-toolbar-menu__item emp-toolbar-menu__item--compliance"
                        role="menuitem"
                        onClick={() => {
                          setEmpHeaderMenu(null);
                          handleOpenComplianceExports();
                        }}
                      >
                        <span className="emp-toolbar-menu__icon"><FileCheck size={16} aria-hidden /></span>
                        <span className="emp-toolbar-menu__copy">
                          <span className="emp-toolbar-menu__label">Compliance Exports</span>
                          <span className="emp-toolbar-menu__hint">Download statutory compliance files</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="emp-toolbar-menu__item emp-toolbar-menu__item--lifecycle"
                        role="menuitem"
                        onClick={() => {
                          setEmpHeaderMenu(null);
                          handleOpenPayrollLifecycle();
                        }}
                      >
                        <span className="emp-toolbar-menu__icon"><Receipt size={16} aria-hidden /></span>
                        <span className="emp-toolbar-menu__copy">
                          <span className="emp-toolbar-menu__label">Payroll Lifecycle</span>
                          <span className="emp-toolbar-menu__hint">F&amp;F, loans, encashment &amp; settlements</span>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        
        <div className="table-responsive employees-results-wrap">
          <table className="results-table employees-results-table">
            <thead className="thead-teal">
              <tr>
                <th>Employee</th>
                <th className="emp-col-actions">Actions</th>
                <th className="emp-col-working-days">Working days</th>
              </tr>
            </thead>
            <tbody>
              {employeesList.map(emp => (
                <tr key={emp.id}>
                  <td data-label="Employee">
                    <div className="emp-result-identity">
                      <div className="emp-result-name-row">
                        <span className="emp-result-name">{emp.name}</span>
                        <span className="emp-result-empid">{emp.empId}</span>
                      </div>
                      <span className="emp-result-email">{emp.email}</span>
                    </div>
                  </td>
                  <td data-label="Actions">
                    <div className="emp-action-toolbar">
                      <button
                        type="button"
                        className="emp-action-chip emp-action-chip--bank"
                        onClick={() => handleViewBankDetails(emp)}
                      >
                        <Landmark size={14} aria-hidden />
                        Bank
                      </button>
                      <button
                        type="button"
                        className="emp-action-chip emp-action-chip--payslip"
                        onClick={() => handleAddPayslipClick(emp)}
                      >
                        <FileText size={14} aria-hidden />
                        Payslip
                      </button>
                      <button
                        type="button"
                        className="emp-action-chip emp-action-chip--form16"
                        onClick={() => handleAddForm16Click(emp)}
                      >
                        <FileCheck size={14} aria-hidden />
                        Form 16
                      </button>
                      {hasFeature('account_ctc_breakup') ? (
                        <button
                          type="button"
                          className="emp-action-chip emp-action-chip--ctc"
                          onClick={() => handleOpenCtcBreakup(emp)}
                        >
                          <TrendingUp size={14} aria-hidden />
                          CTC
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td data-label="Working days">
                    <span className="emp-working-days-pill">{emp.workingDays}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
      <div className="accounts-upload-card">
        <div className="accounts-upload-card__head">
          <h3 className="accounts-upload-card__title">Add Payslip</h3>
          <p className="accounts-upload-card__sub">
            {selectedEmployee?.name || 'Employee'}
            {selectedEmployee?.id ? ` · ${selectedEmployee.id}` : ''}
          </p>
        </div>
        <div className="accounts-upload-form">
          <div className="accounts-upload-fields accounts-upload-fields--row">
            <div className="input-group">
              <label htmlFor="payslip-month">Month</label>
              <select
                id="payslip-month"
                className="custom-select"
                value={payslipMonth}
                onChange={(e) => setPayslipMonth(e.target.value)}
              >
                <option>January</option><option>February</option><option>March</option><option>April</option>
                <option>May</option><option>June</option><option>July</option><option>August</option>
                <option>September</option><option>October</option><option>November</option><option>December</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="payslip-year">Year</label>
              <input
                id="payslip-year"
                type="number"
                className="custom-select"
                min="2000"
                max="2100"
                placeholder="e.g. 2026"
                value={payslipYear}
                onChange={(e) => setPayslipYear(e.target.value)}
              />
            </div>
          </div>
          <div className="input-group">
            <span className="accounts-upload-label">Payslip file</span>
            <label className="accounts-file-picker">
              <input
                type="file"
                className="accounts-file-picker__input"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => setPayslipFile(e.target.files?.[0] || null)}
              />
              <span className="accounts-file-picker__btn">
                <Upload size={14} aria-hidden />
                Choose file
              </span>
              <span className={`accounts-file-picker__name${payslipFile ? ' accounts-file-picker__name--selected' : ''}`}>
                {payslipFile?.name || 'PDF, JPG, or PNG'}
              </span>
            </label>
          </div>
          <div className="accounts-upload-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleUploadPayslip}
              disabled={isPayslipUploading}
            >
              {isPayslipUploading ? 'Uploading...' : 'Upload Payslip'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setCurrentView('employees')}
              disabled={isPayslipUploading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="table-container-card form16-history-card">
        <h4 className="section-title" style={{ marginBottom: '12px' }}>Payslip Upload History</h4>
        <div className="table-responsive accounts-mobile-wrap">
          <table className="results-table accounts-mobile-table">
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
                  <td colSpan="5" className="accounts-empty">Loading history...</td>
                </tr>
              )}
              {!payslipHistoryLoading && payslipHistoryError && (
                <tr>
                  <td colSpan="5" className="accounts-empty">{payslipHistoryError}</td>
                </tr>
              )}
              {!payslipHistoryLoading && !payslipHistoryError && payslipHistory.length === 0 && (
                <tr>
                  <td colSpan="5" className="accounts-empty">No payslip records found.</td>
                </tr>
              )}
              {!payslipHistoryLoading && !payslipHistoryError && payslipHistory.map((item) => (
                <tr key={item.id}>
                  <td data-label="Month">{item.month || '-'}</td>
                  <td data-label="Year">{item.year || '-'}</td>
                  <td data-label="Uploaded On">{getUploadedOnFromPath(item.file_path)}</td>
                  <td data-label="File">
                    {item.file_path ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => openProtectedFile(item.file_path)}
                      >
                        View
                      </button>
                    ) : '-'}
                  </td>
                  <td data-label="Delete">
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
      <div className="accounts-upload-card">
        <div className="accounts-upload-card__head">
          <h3 className="accounts-upload-card__title">Add Form 16</h3>
          <p className="accounts-upload-card__sub">
            {selectedEmployee?.name || 'Employee'}
            {selectedEmployee?.id ? ` · ${selectedEmployee.id}` : ''}
          </p>
        </div>
        <div className="accounts-upload-form">
          <div className="input-group">
            <label htmlFor="form16-fy">Financial year</label>
            <input
              id="form16-fy"
              type="text"
              className="custom-select accounts-field-mono"
              inputMode="numeric"
              autoComplete="off"
              placeholder="20262027"
              maxLength={9}
              value={form16FinancialYear}
              onChange={(e) => setForm16FinancialYear(formatFinancialYearInput(e.target.value))}
            />
          </div>
          <div className="input-group">
            <span className="accounts-upload-label">Form 16 file</span>
            <label className="accounts-file-picker">
              <input
                type="file"
                className="accounts-file-picker__input"
                accept={form16OfficialTraces ? '.pdf' : '.pdf,.jpg,.jpeg,.png'}
                onChange={(e) => setForm16File(e.target.files?.[0] || null)}
              />
              <span className="accounts-file-picker__btn">
                <Upload size={14} aria-hidden />
                Choose file
              </span>
              <span className={`accounts-file-picker__name${form16File ? ' accounts-file-picker__name--selected' : ''}`}>
                {form16File?.name || (form16OfficialTraces ? 'PDF only' : 'PDF, JPG, or PNG')}
              </span>
            </label>
          </div>
          <div className="accounts-upload-form accounts-upload-form--grid">
            <label className="input-group accounts-checkbox-row">
              <input
                type="checkbox"
                checked={form16OfficialTraces}
                onChange={(e) => setForm16OfficialTraces(e.target.checked)}
              />
              <span>Official TRACES Form 16 (PDF certificate from TRACES portal)</span>
            </label>
            <div className="input-group">
              <label htmlFor="form16-part-type">Certificate part</label>
              <select
                id="form16-part-type"
                className="custom-select"
                value={form16PartType}
                onChange={(e) => setForm16PartType(e.target.value)}
              >
                <option value="combined">Combined (Part A + B)</option>
                <option value="part_a">Part A only</option>
                <option value="part_b">Part B only</option>
              </select>
            </div>
          </div>
          <p className="accounts-upload-card__sub">
            Optional: enter figures from official Form 16 / TRACES for reconciliation
          </p>
          <div className="accounts-upload-form accounts-upload-form--grid">
            <div className="input-group">
              <label>Gross salary (annual)</label>
              <input
                type="number"
                min="0"
                className="custom-select"
                value={form16Parsed.parsed_gross_salary}
                onChange={(e) =>
                  setForm16Parsed((p) => ({ ...p, parsed_gross_salary: e.target.value }))
                }
              />
            </div>
            <div className="input-group">
              <label>TDS deducted</label>
              <input
                type="number"
                min="0"
                className="custom-select"
                value={form16Parsed.parsed_tds_deducted}
                onChange={(e) =>
                  setForm16Parsed((p) => ({ ...p, parsed_tds_deducted: e.target.value }))
                }
              />
            </div>
            <div className="input-group">
              <label>Taxable income</label>
              <input
                type="number"
                min="0"
                className="custom-select"
                value={form16Parsed.parsed_taxable_income}
                onChange={(e) =>
                  setForm16Parsed((p) => ({ ...p, parsed_taxable_income: e.target.value }))
                }
              />
            </div>
            <div className="input-group">
              <label>Annual tax</label>
              <input
                type="number"
                min="0"
                className="custom-select"
                value={form16Parsed.parsed_annual_tax}
                onChange={(e) =>
                  setForm16Parsed((p) => ({ ...p, parsed_annual_tax: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="accounts-upload-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleUploadForm16}
              disabled={isForm16Uploading}
            >
              {isForm16Uploading ? 'Uploading...' : 'Upload Form 16'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={handleDownloadForm16Summary}
              disabled={!selectedEmployee?.adminId || isForm16Uploading}
            >
              <Download size={14} aria-hidden />
              Download computed summary
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setCurrentView('employees')}
              disabled={isForm16Uploading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="table-container-card form16-history-card">
        <h4 className="section-title" style={{ marginBottom: '12px' }}>Form 16 Upload History</h4>
        <div className="table-responsive accounts-mobile-wrap">
          <table className="results-table accounts-mobile-table">
            <thead>
              <tr>
                <th>Financial Year</th>
                <th>Type</th>
                <th>Part</th>
                <th>Uploaded On</th>
                <th>File</th>
              </tr>
            </thead>
            <tbody>
              {form16HistoryLoading && (
                <tr>
                  <td colSpan="5" className="accounts-empty">Loading history...</td>
                </tr>
              )}
              {!form16HistoryLoading && form16HistoryError && (
                <tr>
                  <td colSpan="5" className="accounts-empty">{form16HistoryError}</td>
                </tr>
              )}
              {!form16HistoryLoading && !form16HistoryError && form16History.length === 0 && (
                <tr>
                  <td colSpan="5" className="accounts-empty">No Form 16 records found.</td>
                </tr>
              )}
              {!form16HistoryLoading && !form16HistoryError && form16History.map((item) => (
                <tr key={item.id}>
                  <td data-label="Financial Year">{item.financial_year || '-'}</td>
                  <td data-label="Type">
                    {item.is_official_traces || item.certificate_type === 'official_traces'
                      ? 'Official TRACES'
                      : item.data_source === 'traces'
                        ? 'TRACES import'
                        : 'Manual upload'}
                  </td>
                  <td data-label="Part">
                    {item.part_type === 'part_a'
                      ? 'Part A'
                      : item.part_type === 'part_b'
                        ? 'Part B'
                        : item.part_type === 'combined'
                          ? 'Combined'
                          : '—'}
                  </td>
                  <td data-label="Uploaded On">{formatDateTime(item.created_at)}</td>
                  <td data-label="File">
                    {item.file_path ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => openProtectedFile(item.file_path)}
                      >
                        View
                      </button>
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

  const fetchTdsProjection = async (adminId, formOverrides = {}) => {
    const token = localStorage.getItem('token');
    if (!token || !adminId) return;
    const form = { ...tdsForm, ...formOverrides };
    try {
      setTdsLoading(true);
      setTdsError('');
      const response = await fetch(`${API_BASE_URL}/tds/projection`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          admin_id: adminId,
          financial_year: form.financial_year || defaultFinancialYear(),
          rent_paid_annual: form.rent_paid_annual || 0,
          section_80c_extra: form.section_80c_extra || 0,
          section_80d: form.section_80d || 0,
          is_metro: form.is_metro,
          previous_employer_tds: form.previous_employer_tds || 0,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to load TDS projection');
      }
      setTdsProjection(result.projection || null);
    } catch (error) {
      console.error('TDS projection error:', error);
      setTdsError(error.message || 'Unable to calculate TDS projection');
      setTdsProjection(null);
    } finally {
      setTdsLoading(false);
    }
  };

  useRefreshOnNavigate(() => {
    if (currentView === 'tdsProjection' && selectedEmployee?.adminId) {
      fetchTdsProjection(selectedEmployee.adminId);
    }
  }, [currentView, selectedEmployee?.adminId]);

  const openTdsProjection = () => {
    if (!selectedEmployee?.adminId) return;
    setTdsForm((p) => ({ ...p, financial_year: defaultFinancialYear() }));
    setTdsProjection(null);
    setTdsError('');
    setCurrentView('tdsProjection');
    fetchTdsProjection(selectedEmployee.adminId);
  };

  const renderTdsProjection = () => {
    const p = tdsProjection;
    const regimeLabel = p?.regime_label || p?.employee?.tax_regime || '—';
    const isOldRegime = p?.regime === 'old';

    return (
      <div className="form16-page-stack fade-in">
        <button
          type="button"
          className="btn-back"
          onClick={() => setCurrentView('ctcBreakup')}
        >
          <ArrowLeft size={18} /> Back
        </button>
        <div className="table-container-card tds-page-card">
          <div className="card-header-row tds-page-header">
            <div>
              <h3 className="section-title tds-page-title">
                <Receipt size={20} className="tds-page-title-icon" />
                TDS Projection — {selectedEmployee?.name || 'Employee'}
              </h3>
              <p className="tds-page-subtitle">
                FY {p?.financial_year || tdsForm.financial_year}
                {' · '}
                <span className={`tds-regime-badge tds-regime-badge--${p?.regime || 'new'}`}>
                  {regimeLabel}
                </span>
                {p?.employee?.pan ? ` · PAN ${p.employee.pan}` : ''}
              </p>
            </div>
          </div>

          <div className="tds-page-body">
            {p?.warnings?.length > 0 && (
              <div className="tds-warnings">
                {p.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            )}

            <div className="tds-adjust-grid">
              <div className="input-group">
                <label>Financial Year</label>
                <input
                  className="custom-select"
                  value={tdsForm.financial_year}
                  onChange={(e) =>
                    setTdsForm((prev) => ({
                      ...prev,
                      financial_year: formatFinancialYearInput(e.target.value),
                    }))
                  }
                  placeholder="2025-2026"
                />
              </div>
              {isOldRegime && (
                <>
                  <div className="input-group">
                    <label>Annual Rent Paid (HRA)</label>
                    <input
                      className="custom-select"
                      type="number"
                      min="0"
                      value={tdsForm.rent_paid_annual}
                      onChange={(e) =>
                        setTdsForm((prev) => ({ ...prev, rent_paid_annual: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="input-group tds-metro-check">
                    <label>
                      <input
                        type="checkbox"
                        checked={tdsForm.is_metro}
                        onChange={(e) =>
                          setTdsForm((prev) => ({ ...prev, is_metro: e.target.checked }))
                        }
                      />
                      Metro city (HRA 50% rule)
                    </label>
                  </div>
                  <div className="input-group">
                    <label>80C extra (beyond EPF)</label>
                    <input
                      className="custom-select"
                      type="number"
                      min="0"
                      value={tdsForm.section_80c_extra}
                      onChange={(e) =>
                        setTdsForm((prev) => ({ ...prev, section_80c_extra: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                  <div className="input-group">
                    <label>80D (Mediclaim)</label>
                    <input
                      className="custom-select"
                      type="number"
                      min="0"
                      value={tdsForm.section_80d}
                      onChange={(e) =>
                        setTdsForm((prev) => ({ ...prev, section_80d: e.target.value }))
                      }
                      placeholder="0"
                    />
                  </div>
                </>
              )}
              <div className="input-group">
                <label>Previous employer TDS</label>
                <input
                  className="custom-select"
                  type="number"
                  min="0"
                  value={tdsForm.previous_employer_tds}
                  onChange={(e) =>
                    setTdsForm((prev) => ({ ...prev, previous_employer_tds: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
            </div>

            <button
              type="button"
              className="btn-outline-sm tds-recalc-btn"
              disabled={tdsLoading}
              onClick={() => fetchTdsProjection(selectedEmployee?.adminId)}
            >
              {tdsLoading ? 'Calculating…' : 'Recalculate'}
            </button>

            {tdsLoading && <p className="tds-loading">Calculating TDS projection…</p>}
            {tdsError && !tdsLoading && <div className="q-error tds-error">{tdsError}</div>}

            {!tdsLoading && p && (
              <>
                <div className="tds-hero">
                  <span className="tds-hero-label">Projected Monthly TDS</span>
                  <span className="tds-hero-value">{formatCurrency(p.tds?.monthly_tds)}</span>
                  <span className="tds-hero-meta">
                    Annual tax {formatCurrency(p.tax?.annual_tax)}
                    {' · '}
                    {p.tds?.remaining_months} month(s) remaining in FY
                  </span>
                </div>

                <div className="tds-panels">
                  <section className="tds-panel">
                    <h4>Income (projected)</h4>
                    <ul className="tds-rows">
                      <li><span>Monthly gross</span><span>{formatCurrency(p.income?.monthly_gross)}</span></li>
                      <li><span>Projected annual gross</span><span>{formatCurrency(p.income?.projected_annual_gross)}</span></li>
                      <li><span>Basic (annual)</span><span>{formatCurrency(p.income?.basic_annual)}</span></li>
                      <li><span>HRA (annual)</span><span>{formatCurrency(p.income?.hra_annual)}</span></li>
                    </ul>
                  </section>
                  <section className="tds-panel">
                    <h4>Deductions / Exemptions</h4>
                    <ul className="tds-rows">
                      <li><span>Standard deduction</span><span>{formatCurrency(p.deductions?.standard_deduction)}</span></li>
                      {isOldRegime && (
                        <>
                          <li><span>HRA exemption</span><span>{formatCurrency(p.deductions?.hra_exemption)}</span></li>
                          <li><span>80C (incl. EPF)</span><span>{formatCurrency(p.deductions?.section_80c)}</span></li>
                          <li><span>80D</span><span>{formatCurrency(p.deductions?.section_80d)}</span></li>
                          <li><span>P.Tax (annual)</span><span>{formatCurrency(p.deductions?.professional_tax_annual)}</span></li>
                        </>
                      )}
                      <li className="tds-row--accent"><span>Total exemptions</span><span>{formatCurrency(p.deductions?.total_exemptions)}</span></li>
                      <li className="tds-row--accent"><span>Taxable income</span><span>{formatCurrency(p.taxable_income)}</span></li>
                    </ul>
                  </section>
                </div>

                <section className="tds-panel tds-panel--full">
                  <h4>Tax computation</h4>
                  <ul className="tds-rows">
                    <li><span>Tax before rebate</span><span>{formatCurrency(p.tax?.tax_before_rebate)}</span></li>
                    <li><span>Rebate u/s 87A</span><span>{formatCurrency(p.tax?.rebate_87a)}</span></li>
                    <li><span>Cess ({p.tax?.cess_pct}%)</span><span>{formatCurrency(p.tax?.cess)}</span></li>
                    <li className="tds-row--green"><span>Annual tax</span><span>{formatCurrency(p.tax?.annual_tax)}</span></li>
                  </ul>
                  {p.tax?.slab_breakdown?.length > 0 && (
                    <div className="tds-slab-table-wrap">
                      <table className="results-table tds-slab-table accounts-mobile-table">
                        <thead>
                          <tr>
                            <th>Slab</th>
                            <th>Rate</th>
                            <th>Taxable</th>
                            <th>Tax</th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.tax.slab_breakdown.map((row, idx) => (
                            <tr key={idx}>
                              <td data-label="Slab">
                                {formatCurrency(row.from)}
                                {' – '}
                                {row.to != null ? formatCurrency(row.to) : 'above'}
                              </td>
                              <td data-label="Rate">{row.rate_pct}%</td>
                              <td data-label="Taxable">{formatCurrency(row.taxable_in_band)}</td>
                              <td data-label="Tax">{formatCurrency(row.tax)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="tds-panel tds-panel--full">
                  <h4>Monthly TDS schedule (FY)</h4>
                  <div className="tds-schedule-grid">
                    {(p.tds?.schedule || []).map((row) => (
                      <div
                        key={row.month}
                        className={`tds-schedule-item tds-schedule-item--${row.status || row.source || 'projected'}`}
                      >
                        <span>{row.month_label}</span>
                        <strong>{formatCurrency(row.tds)}</strong>
                        <small>{row.status === 'actual' ? 'Payroll' : 'Projected'}</small>
                      </div>
                    ))}
                  </div>
                </section>

                {p.tax_savings && (
                  <section className="tds-panel tds-panel--full tds-savings-panel">
                    <h4>Tax saved with declaration</h4>
                    <ul className="tds-rows">
                      <li>
                        <span>Annual tax (no declaration)</span>
                        <span>{formatCurrency(p.tax_savings.without_declaration?.annual_tax)}</span>
                      </li>
                      <li>
                        <span>Annual tax (with declaration)</span>
                        <span>{formatCurrency(p.tax_savings.with_declaration?.annual_tax)}</span>
                      </li>
                      <li className="tds-row--green">
                        <span>Tax saved (annual)</span>
                        <span>{formatCurrency(p.tax_savings.tax_saved_annual)}</span>
                      </li>
                      <li>
                        <span>Monthly TDS saved</span>
                        <span>{formatCurrency(p.tax_savings.monthly_tds_saved)}</span>
                      </li>
                    </ul>
                    {p.tax_savings.note && (
                      <p className="tds-rules-note">{p.tax_savings.note}</p>
                    )}
                  </section>
                )}

                {p.variance && (
                  <section className="tds-panel tds-panel--full tds-variance-panel">
                    <h4>TDS variance dashboard</h4>
                    <ul className="tds-rows">
                      <li>
                        <span>Declaration basis</span>
                        <span>{p.variance.declaration_basis === 'final' ? 'Final (approved)' : p.variance.declaration_basis === 'provisional' ? 'Provisional (submitted)' : '—'}</span>
                      </li>
                      <li>
                        <span>YTD gross (payroll)</span>
                        <span>{formatCurrency(p.variance.ytd_gross_payroll)}</span>
                      </li>
                      <li>
                        <span>YTD TDS deducted</span>
                        <span>{formatCurrency(p.variance.ytd_tds_deducted)}</span>
                      </li>
                      <li>
                        <span>Annual tax (projected)</span>
                        <span>{formatCurrency(p.variance.annual_tax_projected)}</span>
                      </li>
                      <li>
                        <span>Remaining tax liability</span>
                        <span>{formatCurrency(p.variance.remaining_tax_liability)}</span>
                      </li>
                      <li className="tds-row--accent">
                        <span>Catch-up TDS needed</span>
                        <span>{formatCurrency(p.variance.catch_up_tds_needed)}</span>
                      </li>
                    </ul>
                  </section>
                )}

                <p className="tds-rules-note">
                  Rules: {p.regime_label || p.rules_version}
                  {p.employee?.tax_regime
                    ? ' · Tax regime from Employee Accounts profile'
                    : ' · Set tax regime in Employee Accounts profile'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

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
        <div className="table-container-card ctc-page-card">
          <div className="card-header-row ctc-page-header-row">
            <h3 className="section-title">CTC Breakup for {selectedEmployee?.name}</h3>
            <div className="ctc-page-header-actions">
              <button
                type="button"
                className="btn-outline-sm ctc-tds-projection-btn"
                onClick={handleDownloadCtcPdf}
                disabled={!selectedEmployee?.adminId || ctcPdfDownloading}
              >
                <Download size={16} />
                {ctcPdfDownloading ? 'Downloading…' : 'CTC PDF'}
              </button>
              <button
                type="button"
                className="btn-outline-sm ctc-tds-projection-btn"
                onClick={openTdsProjection}
                disabled={!selectedEmployee?.adminId}
              >
                <Receipt size={16} />
                TDS Projection
              </button>
            </div>
          </div>
          <div className="ctc-page-body">
          {canEditAccountsProfile && ctcPolicyDraft && (
            <div className="ctc-policy-card">
              <div className="ctc-policy-card__head">
                <h4 className="ctc-policy-card__title">Company CTC Policy</h4>
                <button
                  type="button"
                  className="btn-outline-sm ctc-policy-save-btn"
                  onClick={handleSaveCtcPolicy}
                  disabled={ctcPolicySaving}
                >
                  {ctcPolicySaving ? 'Saving…' : 'Save company policy'}
                </button>
              </div>
              <div className="ctc-policy-grid">
                <div className="input-group">
                  <label>Default P.Tax State</label>
                  <select
                    className="custom-select"
                    value={ctcPolicyDraft.default_ptax_state || 'MH'}
                    onChange={(e) => setCtcPolicyDraft((p) => ({ ...p, default_ptax_state: e.target.value }))}
                  >
                    {(ctcPolicy?.ptax_states || []).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name}{s.levies_pt === false ? ' (No PT)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="input-group">
                  <label>Default HRA %</label>
                  <input
                    className="custom-select"
                    type="number"
                    value={ctcPolicyDraft.default_hra_pct ?? 40}
                    onChange={(e) => setCtcPolicyDraft((p) => ({ ...p, default_hra_pct: Number(e.target.value) }))}
                  />
                </div>
                <div className="input-group">
                  <label>Conveyance cap (monthly)</label>
                  <input
                    className="custom-select"
                    type="number"
                    value={ctcPolicyDraft.conveyance_cap_monthly ?? 1600}
                    onChange={(e) => setCtcPolicyDraft((p) => ({ ...p, conveyance_cap_monthly: Number(e.target.value) }))}
                  />
                </div>
                <div className="input-group">
                  <label>Medical cap (monthly)</label>
                  <input
                    className="custom-select"
                    type="number"
                    value={ctcPolicyDraft.medical_cap_monthly ?? 1250}
                    onChange={(e) => setCtcPolicyDraft((p) => ({ ...p, medical_cap_monthly: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="ctc-form-grid ctc-form-grid--parts">
            <div className="ctc-form-half ctc-form-half--a">
              <h4 className="ctc-form-half-title">Part A</h4>
              <div className="ctc-field-row-2">
                <div className="input-group">
                  <label>Month (for P.Tax)</label>
                  <input className="custom-select" type="month" value={ctcMonth} onChange={(e) => setCtcMonth(e.target.value)} />
                </div>
                <div className="input-group">
                  <label>P.Tax State</label>
                  <select
                    className="custom-select"
                    value={ctcPtaxState}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcPtaxState(e.target.value);
                    }}
                  >
                    {(ctcPolicy?.ptax_states || [{ code: 'MH', name: 'Maharashtra', levies_pt: true }]).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.name} ({s.code}){s.levies_pt === false ? ' — No PT' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="ctc-inline-note">Professional tax uses state slabs; February may differ in some states.</p>
              <div className="input-group">
                <label>Employee ID (Emp_ID)</label>
                <input className="custom-select ctc-readonly-field" value={selectedEmployee?.id || ''} readOnly />
              </div>
              <div className="ctc-field-row-2">
                <div className="input-group">
                  <label>Annual Fixed CTC (₹ p.a.)</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 500000"
                    value={ctcAnnual}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = true;
                      setCtcAnnual(e.target.value);
                    }}
                  />
                </div>
                <div className="input-group">
                  <label>Variable Pay (₹ p.a.)</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="1"
                    min="0"
                    placeholder="e.g. 100000"
                    value={ctcVariableAnnual}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcVariableAnnual(e.target.value);
                    }}
                  />
                </div>
              </div>
              <p className="ctc-inline-note">Fixed CTC derives Basic (40–50% band). Total CTC = Fixed + Variable.</p>
              <div className="input-group">
                <label>Mediclaim (₹ per annum)</label>
                <input
                  className="custom-select"
                  type="number"
                  step="1"
                  min="0"
                  placeholder="e.g. 4000"
                  value={ctcMediclaim}
                  onWheel={blockCtcNumberWheel}
                  onChange={(e) => {
                    ctcWantsReverseRef.current = false;
                    setCtcMediclaim(e.target.value);
                  }}
                />
                <div className="ctc-field-hint">
                  Added to fixed annual CTC. Does not change Basic, HRA, or allowance heads.
                </div>
              </div>
              <div className="input-group ctc-employer-toggles">
                <label>Employer statutory in CTC</label>
                <label className="ctc-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ctcIncludePfAdmin}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcIncludePfAdmin(e.target.checked);
                    }}
                  />
                  Include PF Admin charges (0.5% of PF wages p.a.)
                </label>
                <label className="ctc-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ctcIncludeEdli}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcIncludeEdli(e.target.checked);
                    }}
                  />
                  Include EDLI (0.5% of PF wages p.a.)
                </label>
                <label className="ctc-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ctcIncludeBonus}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcIncludeBonus(e.target.checked);
                    }}
                  />
                  Include Statutory Bonus (8.33% on Basic + DA p.a.)
                </label>
                <label className="ctc-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ctcIncludeLwf}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcIncludeLwf(e.target.checked);
                    }}
                  />
                  Include LWF employer contribution in CTC
                </label>
                <label className="ctc-checkbox-row">
                  <input
                    type="checkbox"
                    checked={ctcIncludeNps}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcIncludeNps(e.target.checked);
                    }}
                  />
                  Include employer NPS (80CCD(2)) in CTC
                </label>
              </div>
              <div className="input-group">
                <label>VPF (₹ / month)</label>
                <input
                  className="custom-select"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Voluntary PF above statutory EPF"
                  value={ctcVpfMonthly}
                  onWheel={blockCtcNumberWheel}
                  onChange={(e) => {
                    ctcWantsReverseRef.current = false;
                    setCtcVpfMonthly(e.target.value);
                  }}
                />
                <div className="ctc-field-hint">
                  Added to employee EPF deduction (statutory + VPF). Does not change employer PF costing.
                </div>
              </div>
              {ctcIncludeNps && (
                <div className="input-group">
                  <label>Employer NPS % of Basic+DA</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    min="0"
                    max="10"
                    value={ctcNpsPct}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcNpsPct(e.target.value);
                    }}
                  />
                </div>
              )}
              <div className="input-group">
                <label>HRA metro (TDS)</label>
                <select
                  className="custom-select"
                  value={ctcMetroMode}
                  onChange={(e) => {
                    ctcWantsReverseRef.current = false;
                    setCtcMetroMode(e.target.value);
                  }}
                >
                  <option value="auto">Auto from work location</option>
                  <option value="metro">Metro (50% HRA exemption)</option>
                  <option value="nonmetro">Non-metro (40%)</option>
                </select>
                {ctcComputed.is_metro_hra != null && (
                  <div className="ctc-field-hint">
                    Resolved for TDS: {ctcComputed.is_metro_hra ? 'Metro' : 'Non-metro'}
                  </div>
                )}
              </div>
              <div className="input-group">
                <label>FBP Reimbursement (₹ / month)</label>
                <input
                  className="custom-select"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Flexible benefit payout in payroll"
                  value={ctcReimbursementMonthly}
                  onWheel={blockCtcNumberWheel}
                  onChange={(e) => {
                    ctcWantsReverseRef.current = false;
                    setCtcReimbursementMonthly(e.target.value);
                  }}
                />
              </div>
              <div className="ctc-field-row-2">
                <div className="input-group">
                  <label>Basic Salary</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.basic_salary}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      if (!ctcApplyingReverseRef.current) {
                        ctcWantsReverseRef.current = false;
                      }
                      setCtcForm((p) => ({ ...p, basic_salary: e.target.value }));
                    }}
                  />
                </div>
                <div className="input-group">
                  <label>Dearness Allowance (DA)</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.dearness_allowance}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcForm((p) => ({ ...p, dearness_allowance: e.target.value }));
                    }}
                  />
                </div>
              </div>
              <p className="ctc-inline-note">Basic + DA: 40–50% of monthly fixed CTC (PF &amp; gratuity wage).</p>
              <div className="input-group">
                <label>HRA (%)</label>
                <input
                  className="custom-select"
                  type="number"
                  step="0.01"
                  placeholder="HRA should be between 5% to 50%"
                  value={ctcHraPct}
                  onWheel={blockCtcNumberWheel}
                  disabled={!Number(ctcAnnual || 0) && ctcBasicWage(ctcForm) <= 0}
                  onChange={(e) => {
                    ctcWantsReverseRef.current = false;
                    setCtcHraPct(e.target.value);
                  }}
                />
                <div className="ctc-field-hint">
                  {Number(ctcAnnual || 0) > 0 || ctcBasicWage(ctcForm) > 0 ? (
                    <span>
                      {ctcHraPct || 40}% — HRA ₹{Number(ctcComputed.hra_amount || 0).toFixed(2)}.
                      Changing HRA (5–50%) updates Annual CTC (total) below.
                    </span>
                  ) : (
                    <span>Enter Annual CTC or Basic Salary + DA to calculate HRA.</span>
                  )}
                </div>
              </div>
            </div>
            <div className="ctc-form-half ctc-form-half--b">
              <h4 className="ctc-form-half-title">Part B — Allowances &amp; Deductions</h4>
              <div className="ctc-field-row-2">
                <div className="input-group">
                  <label>Special Allowance</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.special_allowance}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcForm((p) => ({ ...p, special_allowance: e.target.value }));
                    }}
                  />
                </div>
                <div className="input-group">
                  <label>Conveyance</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.conveyance_allowance}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcForm((p) => ({ ...p, conveyance_allowance: e.target.value }));
                    }}
                  />
                </div>
              </div>
              <div className="ctc-field-row-2">
                <div className="input-group">
                  <label>Medical Allowance</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.medical_allowance}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcForm((p) => ({ ...p, medical_allowance: e.target.value }));
                    }}
                  />
                </div>
                <div className="input-group">
                  <label>LTA</label>
                  <input
                    className="custom-select"
                    type="number"
                    step="0.01"
                    value={ctcForm.lta_allowance}
                    onWheel={blockCtcNumberWheel}
                    onChange={(e) => {
                      ctcWantsReverseRef.current = false;
                      setCtcForm((p) => ({ ...p, lta_allowance: e.target.value }));
                    }}
                  />
                </div>
              </div>
              <p className="ctc-inline-note">Allowance heads stay fixed during reverse CTC solve; only Basic is derived.</p>
              <div className="input-group">
                <label>EPF</label>
                <div className="ctc-epf-stack">
                  <select className="custom-select" value={ctcEpfMode} onChange={(e) => setCtcEpfMode(e.target.value)} disabled={ctcBasicWage(ctcForm) < 15000}>
                    <option value="min">Minimum 1800 (Basic + DA ≥ 15000)</option>
                    <option value="percent">Percentage (Basic + DA ≥ 15000)</option>
                  </select>
                  {ctcEpfMode === 'percent' && ctcBasicWage(ctcForm) >= 15000 && (
                    <input
                      className="custom-select"
                      type="number"
                      step="0.01"
                      placeholder="Enter EPF % (e.g. 8)"
                      value={ctcEpfPct}
                      onWheel={blockCtcNumberWheel}
                      onChange={(e) => setCtcEpfPct(e.target.value)}
                    />
                  )}
                  <input className="custom-select ctc-readonly-field" type="text" readOnly value={`${Number(ctcComputed.epf_amount || 0).toFixed(2)}`} />
                  {ctcBasicWage(ctcForm) < 15000 && (
                    <div className="ctc-field-hint">Basic + DA below 15000: EPF 12% mandatory.</div>
                  )}
                </div>
              </div>
              <div className="input-group ctc-deductions-group">
                <label>P.Tax</label>
                <input className="custom-select ctc-readonly-field" type="text" readOnly value={Number(ctcComputed.ptax_amount || 0).toFixed(2)} />
                {ctcComputed.ptax_gender_unknown && (
                  <div className="ctc-field-hint">Gender not on file — using standard MH slabs. Add gender in employee profile for female exemption up to ₹25,000.</div>
                )}
              </div>
              <div className="input-group ctc-deductions-group">
                <label>ESIC (Employee)</label>
                <input className="custom-select ctc-readonly-field" type="text" readOnly value={Number(ctcComputed.esic_employee_amount || 0).toFixed(2)} />
                {!ctcComputed.esic_applicable && Number(ctcComputed.gross_salary || 0) > 0 && (
                  <div className="ctc-field-hint">Not applicable — monthly gross ₹{Number(ctcComputed.gross_salary || 0).toLocaleString('en-IN')} exceeds ESIC wage ceiling (₹21,000).</div>
                )}
              </div>
              <div className="input-group ctc-deductions-group">
                <label>ESIC (Employer)</label>
                <input className="custom-select ctc-readonly-field" type="text" readOnly value={Number(ctcComputed.esic_employer_amount || 0).toFixed(2)} />
              </div>
            </div>
          </div>
            <div className="ctc-summary-section">
              {ctcCalcError && <div className="q-error">{ctcCalcError}</div>}
              <div className="ctc-monthly-summary">
                <div className="ctc-stat-card">
                  <span className="ctc-stat-card__label">Gross Salary (monthly)</span>
                  <span className="ctc-stat-card__value">{Number(ctcComputed.gross_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="ctc-stat-card ctc-stat-card--deductions">
                  <span className="ctc-stat-card__label">Total Deductions</span>
                  <span className="ctc-stat-card__value">{Number(ctcComputed.deductions_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
                <div className="ctc-stat-card ctc-stat-card--net">
                  <span className="ctc-stat-card__label">Net Salary</span>
                  <span className="ctc-stat-card__value">{Number(ctcComputed.net_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="ctc-annual-panel">
                <h4 className="ctc-annual-panel__title">Annual employer cost &amp; CTC</h4>
                <div className="ctc-annual-stats">
                  {[
                    { label: 'Gratuity', value: ctcComputed.gratuity_yearly },
                    { label: 'Employer PF', value: ctcComputed.employer_pf_yearly },
                    { label: 'PF Admin', value: ctcComputed.pf_admin_yearly },
                    { label: 'EDLI', value: ctcComputed.edli_yearly },
                    { label: 'Bonus', value: ctcComputed.statutory_bonus_yearly },
                    { label: 'LWF', value: ctcComputed.lwf_employer_yearly },
                    { label: 'NPS', value: ctcComputed.nps_employer_yearly },
                    { label: 'EPS', value: ctcComputed.eps_contribution_yearly },
                    { label: 'EPF ER', value: ctcComputed.epf_er_contribution_yearly },
                    { label: 'Employer ESIC', value: ctcComputed.employer_esic_yearly },
                    { label: 'Mediclaim', value: parseMediclaimYearly(ctcMediclaim) },
                    { label: 'Fixed CTC', value: ctcComputed.fixed_ctc_annual || ctcComputed.annual_ctc_total, highlight: 'blue' },
                    { label: 'Variable', value: ctcComputed.variable_ctc_annual },
                    { label: 'Total CTC', value: ctcComputed.total_ctc_annual, highlight: 'green' },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className={`ctc-annual-stat${item.highlight ? ` ctc-annual-stat--${item.highlight}` : ''}`}
                    >
                      <span className="ctc-annual-stat__label">{item.label}</span>
                      <span className="ctc-annual-stat__value">
                        {Number(item.value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          {ctcLoading && <p className="ctc-loading-text">Loading CTC breakup...</p>}
          <div className="ctc-revision-fields">
            <div className="input-group">
              <label htmlFor="ctc-effective-from">Effective from</label>
              <input
                id="ctc-effective-from"
                className="custom-select"
                type="date"
                value={ctcEffectiveFrom}
                onChange={(e) => setCtcEffectiveFrom(e.target.value)}
              />
              <div className="ctc-field-hint">
                Salary revision date — used for arrears from this month onward.
              </div>
            </div>
            <div className="input-group">
              <label htmlFor="ctc-revision-note">Revision note (optional)</label>
              <input
                id="ctc-revision-note"
                className="custom-select"
                type="text"
                placeholder="e.g. Annual increment"
                value={ctcRevisionNote}
                onChange={(e) => setCtcRevisionNote(e.target.value)}
              />
            </div>
          </div>
          {ctcArrearsPreview && (
            <div className="table-container-card" style={{ marginTop: 12, padding: 12 }}>
              <h4 className="section-title" style={{ marginBottom: 8 }}>
                Arrears preview — ₹{Number(ctcArrearsPreview.total_arrears_gross || 0).toFixed(2)} total
              </h4>
              {ctcArrearsPreview.months?.length > 0 ? (
                <div className="table-responsive">
                  <table className="results-table">
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Month</th>
                        <th>Arrears (gross)</th>
                        <th>Payable days</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ctcArrearsPreview.months.map((m) => (
                        <tr key={`${m.year}-${m.month_num}`}>
                          <td>{m.year}</td>
                          <td>{m.month_num}</td>
                          <td>{Number(m.arrears_gross || 0).toFixed(2)}</td>
                          <td>{m.payable_days != null ? m.payable_days : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ color: '#64748b', margin: 0 }}>No arrears due for this revision.</p>
              )}
              <div className="form-actions-row" style={{ marginTop: 12, gap: 8 }}>
                <button
                  type="button"
                  className="btn-outline-sm"
                  onClick={handlePreviewArrears}
                >
                  Refresh preview
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={handleApplyArrears}
                  disabled={ctcArrearsApplying || !ctcArrearsPreview.months?.length}
                >
                  {ctcArrearsApplying ? 'Applying...' : 'Apply arrears to payroll'}
                </button>
              </div>
            </div>
          )}
          <div className="ctc-page-messages">
            {ctcError && <div className="q-error">{ctcError}</div>}
            {ctcSuccess && <div className="q-success">{ctcSuccess}</div>}
          </div>
          <div className="ctc-save-row">
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
        </div>

        <div className="ctc-history-card">
          <button
            type="button"
            className="ctc-history-card__toggle"
            onClick={() => setCtcHistoryExpanded((open) => !open)}
            aria-expanded={ctcHistoryExpanded}
          >
            <div className="ctc-history-card__toggle-text">
              <h4 className="ctc-history-card__title">CTC Revision History</h4>
              <p className="ctc-history-card__subtitle">
                Tracks each salary revision for arrears, payroll, and compliance.
              </p>
            </div>
            <div className="ctc-history-card__toggle-meta">
              {!ctcHistoryLoading && (
                <span className="ctc-history-card__count">
                  {ctcHistory.length} revision{ctcHistory.length === 1 ? '' : 's'}
                </span>
              )}
              {ctcHistoryExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </div>
          </button>

          {ctcHistoryExpanded && (
            <div className="ctc-history-card__body">
              {ctcHistoryLoading && (
                <p className="ctc-history-empty">Loading revision history…</p>
              )}
              {!ctcHistoryLoading && ctcHistoryError && (
                <div className="q-error">{ctcHistoryError}</div>
              )}
              {!ctcHistoryLoading && !ctcHistoryError && ctcHistory.length === 0 && (
                <p className="ctc-history-empty">No revisions yet. Saving CTC breakup creates the first snapshot.</p>
              )}
              {!ctcHistoryLoading && !ctcHistoryError && ctcHistory.length > 0 && (
                <div className="ctc-history-list">
                  {ctcHistory.map((item, index) => {
                    const row = ctcHistorySnapshot(item);
                    const metrics = [
                      { label: 'Basic', value: row.basic_salary },
                      { label: 'DA', value: row.dearness_allowance },
                      { label: 'HRA', value: row.hra },
                      { label: 'Allowances', value: row.other_allowance },
                      { label: 'Gross', value: row.gross_salary },
                      { label: 'EPF', value: row.epf },
                      { label: 'P.Tax', value: row.ptax },
                      { label: 'ESIC', value: row.esic },
                      { label: 'Net', value: row.net_salary, highlight: true },
                    ];
                    return (
                      <article
                        key={row.id || `${row.effective_from}-${row.updated_at}-${index}`}
                        className="ctc-history-entry"
                      >
                        <header className="ctc-history-entry__head">
                          <div>
                            <span className="ctc-history-entry__badge">
                              {index === 0 ? 'Latest' : `Revision ${ctcHistory.length - index}`}
                            </span>
                            <strong className="ctc-history-entry__date">
                              Effective {row.effective_from || '—'}
                            </strong>
                          </div>
                          <span className="ctc-history-entry__updated">
                            Saved {formatDateTime(row.updated_at)}
                          </span>
                        </header>
                        {row.note && (
                          <p className="ctc-history-entry__note">{row.note}</p>
                        )}
                        <div className="ctc-history-entry__metrics">
                          {metrics.map((m) => (
                            <div
                              key={m.label}
                              className={`ctc-history-metric${m.highlight ? ' ctc-history-metric--net' : ''}`}
                            >
                              <span className="ctc-history-metric__label">{m.label}</span>
                              <span className="ctc-history-metric__value">{ctcHistoryMetric(m.value)}</span>
                            </div>
                          ))}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
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
      <div className="accounts-upload-card accounts-upload-card--bulk">
        <div className="accounts-upload-card__head">
          <h3 className="accounts-upload-card__title">Bulk Payslip Upload</h3>
          <p className="accounts-upload-card__sub">Upload multiple payslips for employees in one go</p>
        </div>
        <div className="accounts-upload-form">
          <div className="accounts-upload-fields accounts-upload-fields--row">
            <div className="input-group">
              <label htmlFor="bulk-payslip-month">Month</label>
              <select
                id="bulk-payslip-month"
                className="custom-select"
                value={bulkPayslipMonth}
                onChange={(e) => setBulkPayslipMonth(e.target.value)}
              >
                <option>January</option><option>February</option><option>March</option><option>April</option>
                <option>May</option><option>June</option><option>July</option><option>August</option>
                <option>September</option><option>October</option><option>November</option><option>December</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="bulk-payslip-year">Year</label>
              <input
                id="bulk-payslip-year"
                type="number"
                className="custom-select"
                min="2000"
                max="2100"
                placeholder="e.g. 2026"
                value={bulkPayslipYear}
                onChange={(e) => setBulkPayslipYear(e.target.value)}
              />
            </div>
          </div>
          <div className="input-group">
            <span className="accounts-upload-label">Payslip files</span>
            <label className="accounts-file-picker accounts-file-picker--multi">
              <input
                type="file"
                className="accounts-file-picker__input"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                onChange={(e) => setBulkPayslipFiles(Array.from(e.target.files || []))}
              />
              <span className="accounts-file-picker__btn">
                <Upload size={14} aria-hidden />
                Choose files
              </span>
              <span
                className={`accounts-file-picker__name${
                  bulkPayslipFiles.length ? ' accounts-file-picker__name--selected' : ''
                }`}
              >
                {bulkPayslipFiles.length
                  ? `${bulkPayslipFiles.length} file${bulkPayslipFiles.length === 1 ? '' : 's'} selected`
                  : 'Select multiple PDF, JPG, or PNG files'}
              </span>
            </label>
          </div>
          {bulkPayslipFiles.length > 0 && (
            <ul className="accounts-bulk-file-list">
              {bulkPayslipFiles.map((file, idx) => (
                <li key={`${file.name}-${idx}`}>{file.name}</li>
              ))}
            </ul>
          )}
          <div className="accounts-upload-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleBulkPayslipUpload}
              disabled={isBulkUploading}
            >
              {isBulkUploading ? 'Uploading...' : 'Upload Payslips'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setCurrentView('employees')}
              disabled={isBulkUploading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
      {bulkUploadResult && (
        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>Bulk Upload Result</h4>
          <p><strong>Uploaded:</strong> {bulkUploadResult.uploadedCount}</p>

          <div style={{ marginTop: '10px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Unmatched Files</h5>
            <div className="table-responsive accounts-mobile-wrap">
              <table className="results-table accounts-mobile-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkUploadResult.unmatchedFiles.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="accounts-empty">No unmatched files.</td>
                    </tr>
                  ) : bulkUploadResult.unmatchedFiles.map((item, idx) => (
                    <tr key={`${item.filename}-${idx}`}>
                      <td data-label="Filename">{item.filename}</td>
                      <td data-label="Reason">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Email Failures</h5>
            <div className="table-responsive accounts-mobile-wrap">
              <table className="results-table accounts-mobile-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkUploadResult.emailFailures.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="accounts-empty">No email failures.</td>
                    </tr>
                  ) : bulkUploadResult.emailFailures.map((item, idx) => (
                    <tr key={`${item.email}-${idx}`}>
                      <td data-label="Email">{item.email}</td>
                      <td data-label="Reason">{item.reason}</td>
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
      <div className="accounts-upload-card accounts-upload-card--bulk">
        <div className="accounts-upload-card__head">
          <h3 className="accounts-upload-card__title">Bulk Form 16 Upload</h3>
          <p className="accounts-upload-card__sub">Upload Form 16 documents for multiple employees</p>
        </div>
        <div className="accounts-upload-form">
          <div className="input-group">
            <label htmlFor="bulk-form16-fy">Financial year</label>
            <input
              id="bulk-form16-fy"
              type="text"
              className="custom-select accounts-field-mono"
              inputMode="numeric"
              autoComplete="off"
              placeholder="20262027"
              maxLength={9}
              value={bulkForm16Year}
              onChange={(e) => setBulkForm16Year(formatFinancialYearInput(e.target.value))}
            />
          </div>
          <div className="input-group">
            <span className="accounts-upload-label">Form 16 files</span>
            <label className="accounts-file-picker accounts-file-picker--multi">
              <input
                type="file"
                className="accounts-file-picker__input"
                accept=".pdf,.jpg,.jpeg,.png"
                multiple
                onChange={(e) => setBulkForm16Files(Array.from(e.target.files || []))}
              />
              <span className="accounts-file-picker__btn">
                <Upload size={14} aria-hidden />
                Choose files
              </span>
              <span
                className={`accounts-file-picker__name${
                  bulkForm16Files.length ? ' accounts-file-picker__name--selected' : ''
                }`}
              >
                {bulkForm16Files.length
                  ? `${bulkForm16Files.length} file${bulkForm16Files.length === 1 ? '' : 's'} selected`
                  : 'Select multiple PDF, JPG, or PNG files'}
              </span>
            </label>
          </div>
          {bulkForm16Files.length > 0 && (
            <ul className="accounts-bulk-file-list">
              {bulkForm16Files.map((file, idx) => (
                <li key={`${file.name}-${idx}`}>{file.name}</li>
              ))}
            </ul>
          )}
          <div className="accounts-upload-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleBulkForm16Upload}
              disabled={isBulkForm16Uploading}
            >
              {isBulkForm16Uploading ? 'Uploading...' : 'Upload Form 16'}
            </button>
            <button
              type="button"
              className="btn-outline"
              onClick={() => setCurrentView('employees')}
              disabled={isBulkForm16Uploading}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>

      <div className="accounts-upload-card accounts-upload-card--bulk" style={{ marginTop: 16 }}>
        <div className="accounts-upload-card__head">
          <h3 className="accounts-upload-card__title">TRACES CSV import</h3>
          <p className="accounts-upload-card__sub">
            Import Form 16 Part A figures from TRACES export (PAN or Employee ID, TDS columns)
          </p>
        </div>
        <div className="accounts-upload-form">
          <div className="input-group">
            <span className="accounts-upload-label">TRACES CSV file</span>
            <label className="accounts-file-picker">
              <input
                type="file"
                className="accounts-file-picker__input"
                accept=".csv,.txt"
                onChange={(e) => setTracesCsvFile(e.target.files?.[0] || null)}
              />
              <span className="accounts-file-picker__btn">
                <Upload size={14} aria-hidden />
                Choose CSV
              </span>
              <span
                className={`accounts-file-picker__name${
                  tracesCsvFile ? ' accounts-file-picker__name--selected' : ''
                }`}
              >
                {tracesCsvFile?.name || 'CSV with PAN/Emp ID, Gross, TDS columns'}
              </span>
            </label>
          </div>
          <div className="accounts-upload-actions">
            <button
              type="button"
              className="btn-primary"
              onClick={handleTracesCsvImport}
              disabled={isTracesImporting}
            >
              {isTracesImporting ? 'Importing…' : 'Import TRACES CSV'}
            </button>
          </div>
        </div>
      </div>

      {tracesImportResult && (
        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>TRACES Import Result</h4>
          <p><strong>Imported:</strong> {tracesImportResult.imported}</p>
          <p><strong>Skipped:</strong> {tracesImportResult.skipped}</p>
          {tracesImportResult.errors?.length > 0 && (
            <ul className="accounts-bulk-file-list">
              {tracesImportResult.errors.slice(0, 10).map((err, idx) => (
                <li key={idx}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {bulkForm16UploadResult && (
        <div className="table-container-card form16-history-card">
          <h4 className="section-title" style={{ marginBottom: '12px' }}>Bulk Form16 Upload Result</h4>
          <p><strong>Uploaded:</strong> {bulkForm16UploadResult.uploadedCount}</p>

          <div style={{ marginTop: '10px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Unmatched Files</h5>
            <div className="table-responsive accounts-mobile-wrap">
              <table className="results-table accounts-mobile-table">
                <thead>
                  <tr>
                    <th>Filename</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkForm16UploadResult.unmatchedFiles.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="accounts-empty">No unmatched files.</td>
                    </tr>
                  ) : bulkForm16UploadResult.unmatchedFiles.map((item, idx) => (
                    <tr key={`${item.filename}-${idx}`}>
                      <td data-label="Filename">{item.filename}</td>
                      <td data-label="Reason">{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: '14px' }}>
            <h5 style={{ margin: '0 0 8px 0' }}>Email Failures</h5>
            <div className="table-responsive accounts-mobile-wrap">
              <table className="results-table accounts-mobile-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {bulkForm16UploadResult.emailFailures.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="accounts-empty">No email failures.</td>
                    </tr>
                  ) : bulkForm16UploadResult.emailFailures.map((item, idx) => (
                    <tr key={`${item.email}-${idx}`}>
                      <td data-label="Email">{item.email}</td>
                      <td data-label="Reason">{item.reason}</td>
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

      <div className="table-container-card bulk-payroll-card">
        <div className="bulk-payroll-toolbar">
          <p className="bulk-payroll-toolbar-meta">
            <strong>Circle:</strong> {selectedCircle || '-'}
            <span className="bulk-payroll-toolbar-sep">·</span>
            <strong>Dept:</strong> {selectedDept || '-'}
          </p>
          <div className="bulk-payroll-toolbar-fields">
            <div className="input-group">
              <label htmlFor="bulk-payroll-month">Month</label>
              <select
                id="bulk-payroll-month"
                className="custom-select bulk-payroll-toolbar-select"
                value={bulkPayrollMonth}
                onChange={(e) => setBulkPayrollMonth(e.target.value)}
              >
                <option>January</option><option>February</option><option>March</option><option>April</option>
                <option>May</option><option>June</option><option>July</option><option>August</option>
                <option>September</option><option>October</option><option>November</option><option>December</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="bulk-payroll-year">Year</label>
              <input
                id="bulk-payroll-year"
                type="text"
                className="custom-input-file bulk-payroll-toolbar-input"
                placeholder="2026"
                value={bulkPayrollYear}
                onChange={(e) => setBulkPayrollYear(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-outline-sm bulk-payroll-history-btn"
              onClick={handleOpenPayrollHistory}
            >
              History
            </button>
          </div>
        </div>
        <div className="bulk-payroll-scroll">
          <table className="results-table bulk-payroll-table">
            <thead>
              <tr>
                <th className="bulk-payroll-col-sticky bulk-payroll-col-name">Name</th>
                <th className="bulk-payroll-col-sticky bulk-payroll-col-empid">EmpID</th>
                <th>Status</th>
                <th className="bulk-payroll-col-num">Gross</th>
                <th className="bulk-payroll-col-num">EPF</th>
                <th className="bulk-payroll-col-num">P.Tax</th>
                <th className="bulk-payroll-col-num">ESIC</th>
                <th className="bulk-payroll-col-num">LWF</th>
                <th className="bulk-payroll-col-num">Arrears</th>
                <th className="bulk-payroll-col-num">Bonus</th>
                <th className="bulk-payroll-col-num">TDS</th>
                <th className="bulk-payroll-col-num">Days</th>
                <th className="bulk-payroll-col-num">Net</th>
              </tr>
            </thead>
            <tbody>
              {payrollRows.length === 0 && !isBulkPayrollGenerating && (
                <tr>
                  <td colSpan="13" className="accounts-empty" style={{ padding: 18, color: '#64748b' }}>
                    No employees in this filtered list for the selected month/year.
                  </td>
                </tr>
              )}
              {payrollRows.map((row) => {
                const editable = payrollRowEditable(row);
                const payableDays = Math.max(0, Number(row.actual_working_days || 0));
                const gross = Math.max(
                  0,
                  Number(row.one_day_salary || 0) * payableDays,
                );
                const arrears = Number(row.arrears_gross_final || 0);
                const bonus = Number(row.statutory_bonus_final || 0);
                const net = Math.max(
                  0,
                  Number(gross || 0)
                    + arrears
                    + bonus
                    - Number(row.epf_final || 0)
                    - Number(row.ptax_final || 0)
                    - Number(row.esic_final || 0)
                    - Number(row.lwf_final || 0)
                    - Number(row.tds_final || 0),
                );
                const statusKey = (row.status || 'draft').toLowerCase();
                const statusLabel = statusKey.toUpperCase();
                return (
                  <tr key={row.adminId}>
                    <td className="font-bold bulk-payroll-col-sticky bulk-payroll-col-name" data-label="Name">{row.name}</td>
                    <td className="bulk-payroll-col-sticky bulk-payroll-col-empid" data-label="EmpID">{row.empId}</td>
                    <td data-label="Status">
                      <span className={`bulk-payroll-status bulk-payroll-status--${statusKey}`}>{statusLabel}</span>
                    </td>
                    <td className="bulk-payroll-col-num" data-label="Gross Salary">{Number(gross || 0).toFixed(2)}</td>
                    <td className="bulk-payroll-col-num" data-label="EPF">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.epf_final}
                        disabled={!editable}
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
                    <td className="bulk-payroll-col-num" data-label="P.Tax">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.ptax_final}
                        disabled={!editable}
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
                    <td className="bulk-payroll-col-num" data-label="ESIC">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.esic_final}
                        disabled={!editable}
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
                    <td className="bulk-payroll-col-num" data-label="LWF">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.lwf_final}
                        disabled={!editable}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, lwf_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td className="bulk-payroll-col-num" data-label="Arrears">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.arrears_gross_final}
                        disabled={!editable}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, arrears_gross_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td className="bulk-payroll-col-num" data-label="Bonus">{bonus.toFixed(2)}</td>
                    <td className="bulk-payroll-col-num" data-label="TDS">
                      <input
                        className="bulk-payroll-input"
                        type="number"
                        step="0.01"
                        value={row.tds_final}
                        disabled={!editable}
                        onChange={(e) => {
                          const val = Math.max(0, parseFloat(e.target.value || '0'));
                          setPayrollRows((prev) =>
                            prev.map((r) =>
                              r.adminId === row.adminId
                                ? { ...r, tds_final: val }
                                : r
                            )
                          );
                        }}
                      />
                    </td>
                    <td className="bulk-payroll-col-num" data-label="Actual Working Days">
                      <input
                        className="bulk-payroll-input bulk-payroll-input--days"
                        type="number"
                        step="0.1"
                        value={row.actual_working_days}
                        disabled={!editable}
                        onChange={(e) => {
                          const raw = parseFloat(e.target.value || '0');
                          const val = Number.isFinite(raw) ? Math.max(0, raw) : 0;
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
                    <td className="bulk-payroll-col-num bulk-payroll-net" data-label="Net Salary">{net.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="bulk-payroll-actions">
          <div className="bulk-payroll-actions__secondary">
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => handlePayrollStatusUpdate('reviewed')}
              disabled={isPayrollStatusUpdating || payrollRows.length === 0}
            >
              Mark Reviewed
            </button>
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => handlePayrollStatusUpdate('draft')}
              disabled={isPayrollStatusUpdating || payrollRows.length === 0}
            >
              Reopen Draft
            </button>
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => handlePayrollStatusUpdate('paid')}
              disabled={isPayrollStatusUpdating || payrollRows.length === 0}
            >
              Mark Paid
            </button>
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => handlePayrollStatusUpdate('locked')}
              disabled={isPayrollStatusUpdating || payrollRows.length === 0}
            >
              Lock
            </button>
            <button
              type="button"
              className="btn-outline-sm"
              onClick={() => handleStatutoryBonusRun('monthly')}
              disabled={isBonusRunLoading || payrollRows.length === 0}
            >
              {isBonusRunLoading ? 'Running bonus…' : 'Run Statutory Bonus'}
            </button>
          </div>
          <button
            type="button"
            className="btn-primary bulk-payroll-save-btn"
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
    if (currentView === 'complianceExports') {
      loadPtSummary();
      loadPtCalendar();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, bulkPayrollMonth, bulkPayrollYear, selectedCircle, selectedDept]);

  useEffect(() => {
    if (currentView === 'payrollLifecycle' && lifecycleEmployeeId) {
      const adminId = Number(lifecycleEmployeeId);
      loadSalaryLoans(adminId);
      loadFnfSettlements(adminId);
      loadPendingSalaryRevisions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, lifecycleEmployeeId]);

  useEffect(() => {
    if (currentView === 'payrollHistory') {
      loadPayrollHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, bulkPayrollMonth, bulkPayrollYear, selectedCircle, selectedDept]);

  useEffect(() => {
    if (currentView !== 'expenseClaims') return undefined;
    const delay = expenseClaimFilters.q.trim() ? 400 : 0;
    const timer = window.setTimeout(() => {
      loadExpenseClaims();
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, expenseClaimFilters.circle, expenseClaimFilters.emp_type, expenseClaimFilters.month_year, expenseClaimFilters.q]);

  useRefreshOnNavigate(() => {
    if (currentView === 'expenseClaims') {
      loadExpenseClaims();
    }
  }, [currentView]);

  const renderExpenseClaims = () => (
    <div className="fade-in">
      <button type="button" className="btn-back" onClick={() => setCurrentView('main')}>
        <ArrowLeft size={18} /> Back to Dashboard
      </button>

      <div className="table-container-card" style={{ marginTop: 16 }}>
        <div className="card-header-row">
          <h3 className="section-title">Expense Claims</h3>
        </div>

        <div className="expense-claims-filters">
          <div className="input-group">
            <label>Circle</label>
            <select
              className="custom-select"
              value={expenseClaimFilters.circle}
              onChange={(e) => setExpenseClaimFilters((p) => ({ ...p, circle: e.target.value }))}
            >
              <option value="All">All</option>
              {(expenseClaimFilterOptions.circles || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label>Emp Type</label>
            <select
              className="custom-select"
              value={expenseClaimFilters.emp_type}
              onChange={(e) => setExpenseClaimFilters((p) => ({ ...p, emp_type: e.target.value }))}
            >
              <option value="All">All</option>
              {(expenseClaimFilterOptions.emp_types || []).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="input-group expense-claims-month-year">
            <label>Month &amp; Year</label>
            <input
              type="month"
              className="custom-select expense-claims-month-input"
              value={expenseClaimFilters.month_year}
              onChange={(e) => setExpenseClaimFilters((p) => ({ ...p, month_year: e.target.value }))}
            />
          </div>
          <div className="input-group expense-claims-search">
            <label>Search</label>
            <input
              className="custom-select"
              placeholder="Name, emp ID, email, project"
              value={expenseClaimFilters.q}
              onChange={(e) => setExpenseClaimFilters((p) => ({ ...p, q: e.target.value }))}
            />
          </div>
        </div>

        {expenseClaimsError && <div className="q-error">{expenseClaimsError}</div>}
        {expenseClaimsLoading && <p style={{ color: '#64748b' }}>Loading expense claims...</p>}

        <div className="table-responsive accounts-mobile-wrap">
          <table className="results-table accounts-mobile-table expense-claims-table">
            <thead className="thead-teal">
              <tr>
                <th>Employee</th>
                <th>Emp ID</th>
                <th>Circle</th>
                <th>Department</th>
                <th>Project</th>
                <th>Travel</th>
                <th>Status</th>
                <th>Total</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {!expenseClaimsLoading && expenseClaims.length === 0 && (
                <tr>
                  <td colSpan="9" className="accounts-empty" style={{ padding: 18, color: '#64748b' }}>
                    No expense claims found.
                  </td>
                </tr>
              )}
              {expenseClaims.map((claim) => {
                const expanded = !!expandedClaimIds[claim.id];
                return (
                  <React.Fragment key={claim.id}>
                    <tr>
                      <td className="font-bold" data-label="Employee">
                        <div className="expense-claim-head">
                          <button type="button" className="btn-icon" onClick={() => toggleClaimExpanded(claim.id)}>
                            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                          </button>
                          <span>{claim.employee_name || '-'}</span>
                        </div>
                      </td>
                      <td data-label="Emp ID">{claim.emp_id || '-'}</td>
                      <td data-label="Circle">{claim.circle || '-'}</td>
                      <td data-label="Department">{claim.emp_type || '-'}</td>
                      <td data-label="Project">{claim.project_name || '-'}</td>
                      <td data-label="Travel">
                        {formatClaimDate(claim.travel_from_date)} – {formatClaimDate(claim.travel_to_date)}
                      </td>
                      <td data-label="Status">
                        <span className={claimStatusBadgeClass(claim.status)}>{claim.status}</span>
                      </td>
                      <td data-label="Total">
                        {(claim.line_items?.[0]?.currency || 'INR')} {Number(claim.total_amount || 0).toFixed(2)}
                      </td>
                      <td data-label="Download">
                        <button
                          type="button"
                          className="text-link"
                          disabled={claimExcelDownloading === claim.id}
                          onClick={() => handleDownloadClaimExcel(claim)}
                        >
                          {claimExcelDownloading === claim.id ? 'Downloading…' : 'Claim in excel'}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="expense-claims-expand-row">
                        <td colSpan="9">
                          <table className="results-table expense-claims-lines accounts-mobile-table">
                            <thead>
                              <tr>
                                <th>Sr.</th>
                                <th>Date</th>
                                <th>Purpose</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Attachment</th>
                                <th>Action</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(claim.line_items || []).map((item) => (
                                <tr key={item.id}>
                                  <td data-label="Sr.">{item.sr_no}</td>
                                  <td data-label="Date">{formatClaimDate(item.date)}</td>
                                  <td data-label="Purpose">
                                    <div>{item.purpose || '-'}</div>
                                    {item.status === 'Rejected' && item.rejection_reason ? (
                                      <p className="claim-rejection-note">Reason: {item.rejection_reason}</p>
                                    ) : null}
                                  </td>
                                  <td data-label="Amount">{item.currency || 'INR'} {Number(item.amount || 0).toFixed(2)}</td>
                                  <td data-label="Status">
                                    <span className={claimStatusBadgeClass(item.status)}>{item.status}</span>
                                  </td>
                                  <td data-label="Attachment">
                                    {item.file_path ? (
                                      <button
                                        type="button"
                                        className="text-link"
                                        onClick={() => downloadProtectedFile(item.file_path, item.file_path.split('/').pop())}
                                      >
                                        <Download size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                        Download
                                      </button>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                  <td data-label="Action">
                                    {(item.status || 'Pending') === 'Pending' ? (
                                      <div className="claim-line-actions">
                                        <button
                                          type="button"
                                          className="mini-btn approve"
                                          disabled={claimLineActionLoading === item.id}
                                          onClick={() => handleApproveClaimLineItem(claim.id, item.id)}
                                        >
                                          Approve
                                        </button>
                                        <button
                                          type="button"
                                          className="mini-btn reject"
                                          disabled={claimLineActionLoading === item.id}
                                          onClick={() => handleOpenRejectClaimModal(claim.id, item.id)}
                                        >
                                          Reject
                                        </button>
                                      </div>
                                    ) : (
                                      '-'
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {claimLineActionModal && (
        <div className="claim-reject-modal-overlay" role="presentation" onClick={() => setClaimLineActionModal(null)}>
          <div
            className="claim-reject-modal"
            role="dialog"
            aria-labelledby="claim-reject-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h4 id="claim-reject-title">Reject expense item</h4>
            <p style={{ margin: '0 0 12px', color: '#64748b', fontSize: 14 }}>
              Provide a reason for rejection. This will be emailed to the employee and their manager.
            </p>
            <div className="input-group">
              <label>Rejection reason</label>
              <textarea
                className="custom-select claim-reject-textarea"
                rows={4}
                value={claimRejectionReason}
                onChange={(e) => setClaimRejectionReason(e.target.value)}
                placeholder="Enter reason for rejection..."
              />
            </div>
            {claimLineActionError && <div className="q-error">{claimLineActionError}</div>}
            <div className="claim-reject-modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  setClaimLineActionModal(null);
                  setClaimRejectionReason('');
                  setClaimLineActionError('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={claimLineActionLoading === claimLineActionModal.lineItemId}
                onClick={handleConfirmRejectClaimLineItem}
              >
                Confirm reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const renderPayrollLifecycle = () => (
    <div className="fade-in">
      <button className="btn-back" onClick={() => setCurrentView(previousView || 'employees')}>
        <ArrowLeft size={18} /> Back
      </button>

      <div className="table-container-card" style={{ marginTop: 16 }}>
        <div className="card-header-row">
          <h3 className="section-title">
            Payroll Lifecycle | {selectedCircle} | {selectedDept}
          </h3>
        </div>

        <div className="input-group" style={{ maxWidth: 420, marginBottom: 16 }}>
          <label>Employee</label>
          <select
            className="custom-select"
            value={lifecycleEmployeeId}
            onChange={(e) => setLifecycleEmployeeId(e.target.value)}
          >
            <option value="">— Select —</option>
            {(employeesList || []).map((emp) => (
              <option key={emp.adminId} value={emp.adminId}>
                {emp.name} ({emp.id})
              </option>
            ))}
          </select>
        </div>

        {complianceError && <div className="q-error">{complianceError}</div>}
        {complianceLoading && <p style={{ color: '#64748b' }}>Loading...</p>}

        {pendingSalaryRevisions.length > 0 && (
          <div className="table-container-card" style={{ padding: 12, marginBottom: 16, background: '#fffbeb', borderColor: '#fcd34d' }}>
            <h4 className="section-title">Pending salary revisions (post-probation)</h4>
            <div className="table-responsive">
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Effective from</th>
                    <th>Notes</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingSalaryRevisions.map((req) => (
                    <tr key={req.id}>
                      <td>{req.employee_name} ({req.emp_id || req.admin_id})</td>
                      <td>{req.effective_from || '—'}</td>
                      <td>{req.notes || '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-outline-sm"
                          onClick={() => {
                            setLifecycleEmployeeId(String(req.admin_id));
                            completeSalaryRevision(req.id);
                          }}
                        >
                          Select &amp; mark done
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="table-container-card" style={{ padding: 12, marginBottom: 16 }}>
          <h4 className="section-title">Salary loan</h4>
          <div className="accounts-upload-fields accounts-upload-fields--row">
            <div className="input-group">
              <label>Principal (₹)</label>
              <input
                className="custom-select"
                type="number"
                value={loanForm.principal_amount}
                onChange={(e) => setLoanForm((p) => ({ ...p, principal_amount: e.target.value }))}
              />
            </div>
            <div className="input-group">
              <label>EMI / month (₹)</label>
              <input
                className="custom-select"
                type="number"
                value={loanForm.emi_monthly}
                onChange={(e) => setLoanForm((p) => ({ ...p, emi_monthly: e.target.value }))}
              />
            </div>
            <div className="input-group">
              <label>Description</label>
              <input
                className="custom-select"
                value={loanForm.description}
                onChange={(e) => setLoanForm((p) => ({ ...p, description: e.target.value }))}
              />
            </div>
          </div>
          <button type="button" className="btn-primary" onClick={handleCreateLoan} disabled={complianceLoading || !lifecycleEmployeeId}>
            Add loan
          </button>
          {salaryLoans.length > 0 && (
            <div className="table-responsive" style={{ marginTop: 12 }}>
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>EMI</th>
                    <th>Balance</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {salaryLoans.map((loan) => (
                    <tr key={loan.id}>
                      <td>{loan.description || '—'}</td>
                      <td>{Number(loan.emi_monthly || 0).toFixed(2)}</td>
                      <td>{Number(loan.balance_remaining || 0).toFixed(2)}</td>
                      <td>{loan.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="table-container-card" style={{ padding: 12, marginBottom: 16 }}>
          <h4 className="section-title">Leave encashment preview</h4>
          <label className="ctc-checkbox-row">
            <input type="checkbox" checked={fnfIncludeCl} onChange={(e) => setFnfIncludeCl(e.target.checked)} />
            Include casual leave in encashment
          </label>
          <button type="button" className="btn-outline-sm" style={{ marginTop: 8 }} onClick={handlePreviewEncashment} disabled={!lifecycleEmployeeId}>
            Preview encashment
          </button>
          {encashPreview && (
            <p style={{ marginTop: 8 }}>
              PL: {encashPreview.pl_days} days → ₹{Number(encashPreview.pl_encashment || 0).toFixed(2)}
              {' '}| Total: ₹{Number(encashPreview.total_encashment || 0).toFixed(2)}
            </p>
          )}
        </div>

        <div className="table-container-card" style={{ padding: 12 }}>
          <h4 className="section-title">Full &amp; Final settlement</h4>
          <div className="accounts-upload-fields accounts-upload-fields--row">
            <div className="input-group">
              <label>Separation date</label>
              <input className="custom-select" type="date" value={fnfSeparationDate} onChange={(e) => setFnfSeparationDate(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Last working day</label>
              <input className="custom-select" type="date" value={fnfLastWorkingDay} onChange={(e) => setFnfLastWorkingDay(e.target.value)} />
            </div>
            <div className="input-group">
              <label>Notice recovery (days)</label>
              <input className="custom-select" type="number" min="0" value={fnfNoticeDays} onChange={(e) => setFnfNoticeDays(e.target.value)} />
            </div>
          </div>
          <div className="form-actions-row" style={{ marginTop: 8, gap: 8 }}>
            <button type="button" className="btn-primary" onClick={handlePreviewFnf} disabled={!lifecycleEmployeeId}>
              Preview FnF
            </button>
            <button type="button" className="btn-secondary" onClick={handleSaveFnf} disabled={!fnfPreview?.settlement}>
              Save settlement
            </button>
          </div>
          {fnfPreview?.settlement && (
            <div style={{ marginTop: 12 }}>
              <p><strong>Net payable:</strong> ₹{Number(fnfPreview.settlement.net_payable || 0).toFixed(2)}</p>
              <p style={{ color: '#64748b' }}>
                Earnings ₹{Number(fnfPreview.settlement.earnings?.total || 0).toFixed(2)}
                {' '}| Deductions ₹{Number(fnfPreview.settlement.deductions?.total || 0).toFixed(2)}
              </p>
              {fnfPreview.settlement.earnings?.gratuity?.eligible && (
                <p>Gratuity: ₹{Number(fnfPreview.settlement.earnings.gratuity.gratuity_amount || 0).toFixed(2)}</p>
              )}
            </div>
          )}

          {fnfSettlements.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <h5 className="section-title" style={{ fontSize: '0.95rem' }}>Saved F&amp;F settlements</h5>
              <div className="table-container-card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', minWidth: 520 }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>LWD</th>
                      <th>Net payable</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fnfSettlements.map((row) => (
                      <tr key={row.id}>
                        <td>{row.id}</td>
                        <td>{row.last_working_day || '—'}</td>
                        <td>₹{Number(row.net_payable || 0).toFixed(2)}</td>
                        <td><span className="status-pill">{row.status}</span></td>
                        <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button type="button" className="btn-outline-sm" onClick={() => handleDownloadFnfPdf(row.id)}>
                            PDF
                          </button>
                          {row.status === 'draft' && (
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={fnfStatusUpdatingId === row.id}
                              onClick={() => handleUpdateFnfStatus(row.id, 'finalized')}
                            >
                              Finalize
                            </button>
                          )}
                          {(row.status === 'draft' || row.status === 'finalized') && (
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={fnfStatusUpdatingId === row.id}
                              onClick={() => handleUpdateFnfStatus(row.id, 'paid')}
                            >
                              Mark paid
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderComplianceExports = () => {
    const monthLabel = bulkPayrollMonth;
    const yearLabel = bulkPayrollYear;
    const safeMonth = String(monthLabel || 'month').replace(/\s+/g, '-');
    return (
      <div className="fade-in compliance-page">
        <button className="btn-back" onClick={() => setCurrentView(previousView || 'employees')}>
          <ArrowLeft size={18} /> Back
        </button>

        <div className="table-container-card compliance-page-card">
          <div className="compliance-page-header">
            <div className="compliance-page-header__main">
              <span className="compliance-page-header__icon" aria-hidden>
                <FileCheck size={22} />
              </span>
              <div className="compliance-page-header__text">
                <div className="emp-dept-header__crumbs">
                  <span className="emp-dept-chip emp-dept-chip--circle">{selectedCircle}</span>
                  <span className="emp-dept-chip__sep" aria-hidden>›</span>
                  <span className="emp-dept-chip emp-dept-chip--dept">{selectedDept}</span>
                </div>
                <h3 className="compliance-page-header__title">Statutory compliance exports</h3>
                <p className="compliance-page-header__sub">Download PF, ESIC, PT, bank and TDS files for filing</p>
              </div>
            </div>
          </div>

          <div className="compliance-filters">
            <div className="compliance-filters__label">Payroll period</div>
            <div className="compliance-filters__fields">
              <div className="input-group">
                <label htmlFor="compliance-month">Month</label>
                <select
                  id="compliance-month"
                  className="custom-select"
                  value={bulkPayrollMonth}
                  onChange={(e) => setBulkPayrollMonth(e.target.value)}
                >
                  {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="compliance-year">Year</label>
                <input
                  id="compliance-year"
                  className="custom-select"
                  type="number"
                  value={bulkPayrollYear}
                  onChange={(e) => setBulkPayrollYear(e.target.value)}
                />
              </div>
            </div>
          </div>

          {complianceError ? <div className="q-error compliance-page-alert">{complianceError}</div> : null}
          {complianceLoading ? <p className="compliance-page-loading">Preparing export…</p> : null}

          <div className="compliance-section">
            <h4 className="compliance-section__title">Monthly statutory files</h4>
            <p className="compliance-section__hint">Based on {monthLabel} {yearLabel} payroll for this department</p>
            <div className="compliance-export-grid">
              <button
                type="button"
                className="compliance-export-card compliance-export-card--pf"
                disabled={complianceLoading}
                onClick={() => downloadComplianceCsv(
                  '/compliance/pf-ecr',
                  `pf-ecr-${safeMonth}-${yearLabel}.csv`,
                )}
              >
                <span className="compliance-export-card__icon"><Landmark size={20} aria-hidden /></span>
                <span className="compliance-export-card__body">
                  <span className="compliance-export-card__label">PF ECR</span>
                  <span className="compliance-export-card__meta">CSV for EPFO filing</span>
                </span>
                <Download size={18} className="compliance-export-card__dl" aria-hidden />
              </button>
              <button
                type="button"
                className="compliance-export-card compliance-export-card--esic"
                disabled={complianceLoading}
                onClick={() => downloadComplianceCsv(
                  '/compliance/esic-statement',
                  `esic-${safeMonth}-${yearLabel}.csv`,
                )}
              >
                <span className="compliance-export-card__icon"><Users size={20} aria-hidden /></span>
                <span className="compliance-export-card__body">
                  <span className="compliance-export-card__label">ESIC Statement</span>
                  <span className="compliance-export-card__meta">Employee state insurance</span>
                </span>
                <Download size={18} className="compliance-export-card__dl" aria-hidden />
              </button>
              <button
                type="button"
                className="compliance-export-card compliance-export-card--pt"
                disabled={complianceLoading}
                onClick={() => downloadComplianceCsv(
                  '/compliance/pt-summary',
                  `pt-summary-${safeMonth}-${yearLabel}.csv`,
                )}
              >
                <span className="compliance-export-card__icon"><Receipt size={20} aria-hidden /></span>
                <span className="compliance-export-card__body">
                  <span className="compliance-export-card__label">PT Summary</span>
                  <span className="compliance-export-card__meta">Professional tax deductions</span>
                </span>
                <Download size={18} className="compliance-export-card__dl" aria-hidden />
              </button>
              <button
                type="button"
                className="compliance-export-card compliance-export-card--bank"
                disabled={complianceLoading}
                onClick={() => downloadComplianceCsv(
                  '/compliance/bank-file',
                  `bank-neft-${safeMonth}-${yearLabel}.csv`,
                )}
              >
                <span className="compliance-export-card__icon"><Send size={20} aria-hidden /></span>
                <span className="compliance-export-card__body">
                  <span className="compliance-export-card__label">Bank NEFT File</span>
                  <span className="compliance-export-card__meta">Salary disbursement upload</span>
                </span>
                <Download size={18} className="compliance-export-card__dl" aria-hidden />
              </button>
            </div>
          </div>

          <div className="compliance-form24q">
            <div className="compliance-form24q__head">
              <h4 className="compliance-section__title">Form 24Q (TDS return)</h4>
              <p className="compliance-section__hint">Quarterly TDS statement for salary payments</p>
            </div>
            <div className="compliance-form24q__row">
              <div className="input-group">
                <label htmlFor="compliance-fy">Financial year</label>
                <input
                  id="compliance-fy"
                  className="custom-select"
                  value={complianceFy}
                  onChange={(e) => setComplianceFy(formatFinancialYearInput(e.target.value))}
                  placeholder="2025-26"
                />
              </div>
              <div className="input-group">
                <label htmlFor="compliance-quarter">Quarter</label>
                <select
                  id="compliance-quarter"
                  className="custom-select"
                  value={complianceQuarter}
                  onChange={(e) => setComplianceQuarter(Number(e.target.value))}
                >
                  <option value={1}>Q1 (Apr–Jun)</option>
                  <option value={2}>Q2 (Jul–Sep)</option>
                  <option value={3}>Q3 (Oct–Dec)</option>
                  <option value={4}>Q4 (Jan–Mar)</option>
                </select>
              </div>
              <button
                type="button"
                className="compliance-form24q__btn"
                disabled={complianceLoading || !isValidFinancialYear(complianceFy)}
                onClick={() => downloadComplianceCsv(
                  '/compliance/form-24q',
                  `form-24q-${complianceFy}-Q${complianceQuarter}.csv`,
                  { financial_year: complianceFy, quarter: String(complianceQuarter) },
                )}
              >
                <Download size={18} aria-hidden />
                Download Form 24Q
              </button>
            </div>
          </div>

          {ptSummary ? (
            <div className="compliance-pt-panel">
              <h4 className="compliance-section__title">
                Professional tax — {ptSummary.month_name} {ptSummary.year}
              </h4>
              <p className="compliance-pt-panel__summary">
                Total PT deducted: <strong>₹{Number(ptSummary.total_pt_deducted || 0).toFixed(2)}</strong>
                {ptSummary.states_with_remittance_due?.length > 0 ? (
                  <> · Remittance due: {ptSummary.states_with_remittance_due.join(', ')}</>
                ) : null}
              </p>
              <div className="table-responsive">
                <table className="results-table">
                  <thead className="thead-teal">
                    <tr>
                      <th>State</th>
                      <th>Employees</th>
                      <th>PT Deducted</th>
                      <th>Remits this month</th>
                      <th>Frequency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ptSummary.lines || []).length === 0 && (
                      <tr>
                        <td colSpan="5" className="accounts-empty">No PT deductions for this period.</td>
                      </tr>
                    )}
                    {(ptSummary.lines || []).map((row) => (
                      <tr key={row.state_code}>
                        <td>{row.state_name} ({row.state_code})</td>
                        <td>{row.employee_count}</td>
                        <td>{Number(row.pt_deducted || 0).toFixed(2)}</td>
                        <td>{row.remittance_due ? 'Yes' : 'No'}</td>
                        <td>{row.frequency}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {ptCalendar.length > 0 ? (
            <div className="compliance-pt-panel">
              <h4 className="compliance-section__title">PT remittance calendar ({yearLabel})</h4>
              <div className="table-responsive">
                <table className="results-table">
                  <thead className="thead-teal">
                    <tr>
                      <th>State</th>
                      <th>Frequency</th>
                      <th>Due months</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ptCalendar.filter((s) => s.frequency !== 'none').map((row) => (
                      <tr key={row.state_code}>
                        <td>{row.state_name} ({row.state_code})</td>
                        <td>{row.frequency}</td>
                        <td>{(row.due_months || []).map((m) => calendarMonthName(m)).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  const calendarMonthName = (m) => {
    const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[m] || m;
  };

  const renderPayrollHistory = () => (
    <div className="fade-in">
      <button className="btn-back" onClick={() => setCurrentView(previousView || 'bulkPayroll')}>
        <ArrowLeft size={18} /> Back
      </button>

      <div className="table-container-card">
        <div className="card-header-row">
          <h3 className="section-title payroll-history-title">
            Payroll History | Circle: {selectedCircle || '-'} | Department: {selectedDept || '-'} | Month: {bulkPayrollMonth} | Year: {bulkPayrollYear} | Created At:{' '}
            {payrollHistoryRows.length > 0
              ? (() => {
                  const latest = payrollHistoryRows
                    .map((r) => r.created_at)
                    .filter(Boolean)
                    .sort()
                    .slice(-1)[0];
                  return latest
                    ? formatDateTimeDDMMYYYY(latest, '-')
                    : '-';
                })()
              : '-'}
          </h3>
        </div>

        {payrollHistoryError && <div className="q-error">{payrollHistoryError}</div>}
        {payrollHistoryLoading && <p style={{ color: '#64748b' }}>Loading...</p>}

        <div className="table-responsive accounts-mobile-wrap">
          <table className="results-table accounts-mobile-table">
            <thead className="thead-teal">
              <tr>
                <th>Name</th>
                <th>EmpID</th>
                <th>Gross Salary</th>
                <th>Arrears</th>
                <th>EPF</th>
                <th>P.Tax</th>
                <th>ESIC</th>
                <th>LWF</th>
                <th>TDS</th>
                <th>Actual Working Days</th>
                <th>Net Salary</th>
              </tr>
            </thead>
            <tbody>
              {!payrollHistoryLoading && payrollHistoryRows.length === 0 && (
                <tr>
                  <td colSpan="11" className="accounts-empty" style={{ padding: 18, color: '#64748b' }}>
                    No payroll history found for this month/year.
                  </td>
                </tr>
              )}
              {payrollHistoryRows.map((r) => (
                <tr key={r.admin_id}>
                  <td className="font-bold" data-label="Name">{r.name}</td>
                  <td data-label="EmpID">{r.emp_id}</td>
                  <td data-label="Gross Salary">{Number(r.gross_salary_for_month || 0).toFixed(2)}</td>
                  <td data-label="Arrears">{Number(r.arrears_gross_final || 0).toFixed(2)}</td>
                  <td data-label="EPF">{Number(r.epf_final || 0).toFixed(2)}</td>
                  <td data-label="P.Tax">{Number(r.ptax_final || 0).toFixed(2)}</td>
                  <td data-label="ESIC">{Number(r.esic_final || 0).toFixed(2)}</td>
                  <td data-label="LWF">{Number(r.lwf_final || 0).toFixed(2)}</td>
                  <td data-label="TDS">{Number(r.tds_final || 0).toFixed(2)}</td>
                  <td data-label="Actual Working Days">{Number(r.actual_working_days || 0).toFixed(1)}</td>
                  <td data-label="Net Salary">{Number(r.net_salary_final || 0).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const accountViewVisible =
    (currentView === 'main')
    || (currentView === 'noc_requests')
    || (currentView === 'employees')
    || (currentView === 'addPayslip')
    || (currentView === 'bulkPayslip')
    || (currentView === 'bulkForm16')
    || (currentView === 'bulkPayroll')
    || (currentView === 'payrollHistory')
    || (currentView === 'complianceExports')
    || (currentView === 'payrollLifecycle')
    || (currentView === 'expenseClaims')
    || (currentView === 'taxDeclarations')
    || (currentView === 'taxDeclarationDetail' && selectedTaxDeclId)
    || (currentView === 'addForm16')
    || (currentView === 'ctcBreakup')
    || (currentView === 'tdsProjection')
    || (currentView === 'viewPayslip');

  return (
    <div className="hr-main-container">
      {currentView === 'main' && renderMainView()}
      {currentView === 'noc_requests' && (
        <div className="fade-in">
          <button type="button" className="btn-back" onClick={() => setCurrentView('main')}>
            <ArrowLeft size={18} /> Back to Dashboard
          </button>
          <div className="table-container-card" style={{ marginTop: 16 }}>
            <div className="card-header-row">
              <h3 className="section-title">NOC Requests (Accounts)</h3>
            </div>
            <DepartmentNocPanel apiBase="/api/accounts" />
          </div>
        </div>
      )}
      {currentView === 'employees' && renderEmployeesView()}
      {currentView === 'addPayslip' && renderAddPayslip()}
      {currentView === 'bulkPayslip' && renderBulkPayslip()}
      {currentView === 'bulkForm16' && renderBulkForm16()}
      {currentView === 'bulkPayroll' && renderBulkPayroll()}
      {currentView === 'complianceExports' && renderComplianceExports()}
      {currentView === 'payrollLifecycle' && renderPayrollLifecycle()}
      {currentView === 'payrollHistory' && renderPayrollHistory()}
      {currentView === 'expenseClaims' && renderExpenseClaims()}
      {currentView === 'taxDeclarations' && (
        <TaxDeclarationReview
          apiBase={API_BASE_URL}
          onBack={() => setCurrentView('main')}
          onOpenDetail={(declId) => {
            setSelectedTaxDeclId(declId);
            setCurrentView('taxDeclarationDetail');
          }}
        />
      )}
      {currentView === 'taxDeclarationDetail' && selectedTaxDeclId && (
        <TaxDeclarationReviewDetail
          apiBase={API_BASE_URL}
          declId={selectedTaxDeclId}
          onBack={() => {
            setSelectedTaxDeclId(null);
            setCurrentView('taxDeclarations');
          }}
        />
      )}
      {currentView === 'addForm16' && renderAddForm16()}
      {currentView === 'ctcBreakup' && renderCtcBreakup()}
      {currentView === 'tdsProjection' && renderTdsProjection()}
      {currentView === 'viewPayslip' && (
         <div className="fade-in view-payslip-stack">
            <button className="btn-back" onClick={() => setCurrentView('employees')}><ArrowLeft size={18}/> Back</button>
            <div className="table-container-card accounts-profile-card">
              <div className="card-header-row accounts-profile-header">
                <div>
                  <h3 className="section-title">
                    {hasFeature('account_full_employee_view')
                      ? 'Employee Accounts Profile'
                      : 'Uploaded Documents'}
                  </h3>
                  <p className="accounts-profile-meta">
                    {selectedEmployee?.name || 'Employee'} ({selectedEmployee?.id || '-'}) — {selectedEmployee?.email || '-'}
                  </p>
                </div>
              </div>

              {accountsProfileLoading && <p className="accounts-profile-loading">Loading...</p>}
              {accountsProfileError && <div className="q-error">{accountsProfileError}</div>}
              {accountsProfileSuccess && <div className="q-success">{accountsProfileSuccess}</div>}

              {hasFeature('account_full_employee_view') && (
              <>
              <div className={`accounts-profile-body ${canEditAccountsProfile ? '' : 'accounts-readonly'}`}>
                <section className="accounts-profile-section">
                  <h5 className="accounts-profile-section__title">Employment</h5>
                  <div className="accounts-profile-grid">
                    <div className="input-group">
                      <label>Function</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.function}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, function: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                      />
                    </div>
                    <div className="input-group">
                      <label>Designation</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.designation}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, designation: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                      />
                    </div>
                    <div className="input-group">
                      <label>Location</label>
                      <input
                        className="custom-select"
                        value={accountsProfileForm.location}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, location: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                    <div className="input-group">
                      <label>Date of Joining</label>
                      <input
                        className="custom-select"
                        type="date"
                        value={accountsProfileForm.date_of_joining}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, date_of_joining: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                      />
                    </div>
                    <div className="input-group">
                      <label>Employee ID</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={selectedEmployee?.id || ''}
                        readOnly
                      />
                    </div>
                  </div>
                </section>

                <section className="accounts-profile-section">
                  <h5 className="accounts-profile-section__title">Statutory &amp; IDs</h5>
                  <div className="accounts-profile-grid">
                    <div className="input-group">
                      <label>PAN</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={accountsProfileForm.pan}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pan: e.target.value }))}
                        placeholder="ABCDE1234F"
                        disabled={!canEditAccountsProfile}
                      />
                    </div>
                    <div className="input-group">
                      <label>UAN</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={accountsProfileForm.uan}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, uan: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                    <div className="input-group">
                      <label>PF Account Number</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={accountsProfileForm.pf_account_number}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pf_account_number: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                    <div className="input-group">
                      <label>ESI Number</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={accountsProfileForm.esi_number}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, esi_number: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                    <div className="input-group">
                      <label>PRAN</label>
                      <input
                        className="custom-select accounts-field-mono"
                        value={accountsProfileForm.pran}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, pran: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                  </div>
                </section>

                <section className="accounts-profile-section">
                  <h5 className="accounts-profile-section__title">Bank &amp; Tax</h5>
                  <div className="accounts-profile-grid accounts-profile-grid--stack">
                    <div className="input-group accounts-field-full">
                      <label>Bank Details</label>
                      <textarea
                        className="custom-select"
                        rows={2}
                        value={accountsProfileForm.bank_details}
                        onChange={(e) => setAccountsProfileForm((p) => ({ ...p, bank_details: e.target.value }))}
                        disabled={!canEditAccountsProfile}
                        placeholder="—"
                      />
                    </div>
                    <div className="input-group">
                      <label>Tax Regime</label>
                      <select
                        className="custom-select"
                        value={accountsProfileForm.tax_regime}
                        onChange={(e) =>
                          setAccountsProfileForm((p) => ({ ...p, tax_regime: e.target.value }))
                        }
                        disabled={!canEditAccountsProfile}
                      >
                        <option value="">— Select —</option>
                        {TAX_REGIME_OPTIONS.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                        {accountsProfileForm.tax_regime &&
                        !TAX_REGIME_OPTIONS.includes(accountsProfileForm.tax_regime) ? (
                          <option value={accountsProfileForm.tax_regime}>
                            {accountsProfileForm.tax_regime}
                          </option>
                        ) : null}
                      </select>
                    </div>
                  </div>
                  {canEditAccountsProfile && (
                    <div className="accounts-profile-regime-override">
                      <h5 className="accounts-profile-section__title">HR tax regime override</h5>
                      <p className="accounts-profile-meta">
                        Use when employee cannot change regime after declaration submit.
                      </p>
                      <div className="accounts-profile-grid">
                        <div className="input-group">
                          <label>Override regime</label>
                          <select
                            className="custom-select"
                            value={regimeOverrideForm.tax_regime}
                            onChange={(e) =>
                              setRegimeOverrideForm((p) => ({ ...p, tax_regime: e.target.value }))
                            }
                          >
                            <option value="">— Select —</option>
                            {TAX_REGIME_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                        <div className="input-group accounts-profile-grid__full">
                          <label>Reason (required)</label>
                          <input
                            className="custom-select"
                            value={regimeOverrideForm.reason}
                            onChange={(e) =>
                              setRegimeOverrideForm((p) => ({ ...p, reason: e.target.value }))
                            }
                            placeholder="e.g. Regime correction after HR review"
                          />
                        </div>
                      </div>
                      <div className="form-actions-row">
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={regimeOverrideSaving}
                          onClick={handleSaveRegimeOverride}
                        >
                          {regimeOverrideSaving ? 'Saving…' : 'Save override'}
                        </button>
                        <button
                          type="button"
                          className="btn-outline"
                          disabled={regimeOverrideSaving}
                          onClick={handleClearRegimeOverride}
                        >
                          Clear override
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <div className="form-actions-row accounts-profile-actions">
                {canEditAccountsProfile ? (
                  <button
                    type="button"
                    className="btn-primary"
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
              </>
              )}

              {hasFeature('account_full_employee_view') ? (
                <>
                  <div className="accounts-identity-section">
                    <h4 className="section-title accounts-identity-section__title">Identity &amp; Documents</h4>
                    <EmployeeIdentityDocsPanel
                      documents={selectedEmployee?.documents || {}}
                      accountsProfile={accountsProfileForm}
                      showFullDetails
                      onViewFile={openProtectedFile}
                    />
                  </div>
                  {selectedEmployee?.form16Path && (
                    <div style={{ marginTop: 12 }}>
                      <div className="flex-between" style={{ marginBottom: '6px' }}>
                        <span>Form 16</span>
                        <span>Available</span>
                      </div>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => openProtectedFile(selectedEmployee.form16Path)}
                      >
                        View
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
         </div>
      )}

      {!accountViewVisible && renderMainView()}

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