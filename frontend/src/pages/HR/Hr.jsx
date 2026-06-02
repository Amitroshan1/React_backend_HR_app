
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Users, UserPlus, UserCheck, Cake, RefreshCw, 
  UserCog, Newspaper, FileText, MapPin, 
  FileCheck, Search, ArrowLeft, ArrowRightLeft, Download, ChevronDown, Key, Clock, Share2, Trash2
} from 'lucide-react';
import './Hr.css';
import './SignUp.css'; 
import { UpdateSignUp } from './UpdateSignUp';
import { AddNewsFeed } from './AddNewsFeed';
import { UpdateLeave } from './UpdateLeave';
import { UpdateManager } from './UpdateManager';
import { AddLocation } from './AddLocation';
import ExitEmployee from './ExitEmployee';
import AddDeptCircle from './AddDeptCircle';
import { LeaveAccrualSummary } from './LeaveAccrualSummary';
import { HolidayCalendar } from './HolidayCalendar';
import { LeaveApplicationUpdation } from './LeaveApplicationUpdation';
import { ExEmployeeDocumentSharing } from './ExEmployeeDocumentSharing';
import { HRAssessmentInvite } from './HRAssessmentInvite';
import { CircleTransferHistory } from './CircleTransferHistory';
import { DepartmentNocPanel } from '../Manager/comps/DepartmentNocPanel';
import '../IT/ReturnRequests.css';
import { hasFeature } from '../../utils/planFeatures';
import { usePersistedView } from '../../hooks/usePersistedView';

const HR_PANEL_VIEWS = [
  'main',
  'updates',
  'signup',
  'update_signup',
  'circle_transfer_history',
  'newsfeed',
  'update_leave',
  'leave_updation',
  'assessment_invite',
  'update_manager',
  'add_location',
  'noc_requests',
  'exit_employee',
  'ex_employee_doc_share',
  'add_dept_circle',
  'reset_password',
  'leave_accrual_monitor',
  'holiday_calendar',
  'add_circle_type',
];

const HR_API_BASE = '/api/HumanResource';
const ACCOUNTS_API_BASE = '/api/accounts';

function formatDateShort(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function getAuthHeaders() {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ----- HR Profile completeness (same logic as employee Profile) -----
function hrProfileCompleteness(admin, employee, documents, education) {
  const missing = [];
  let score = 0;
  const sectionWeight = 20;

  const v = (x) => (x != null && String(x).trim() !== '');
  const emp = employee || {};
  const doc = documents || {};
  const docKeys = ['aadhaar_front', 'aadhaar_back', 'pan_front', 'pan_back', 'passbook_front', 'appointment_letter'];
  const docLabels = { aadhaar_front: 'Aadhaar (Front)', aadhaar_back: 'Aadhaar (Back)', pan_front: 'PAN (Front)', pan_back: 'PAN (Back)', passbook_front: 'Passbook (Front)', appointment_letter: 'Appointment Letter' };

  // 1. Personal (name, father, marital, email, mobile, nationality, dob, gender)
  const personalFields = [
    { key: 'name', label: 'Full name', val: emp.name || admin?.first_name },
    { key: 'father_name', label: "Father's name", val: emp.father_name },
    { key: 'marital_status', label: 'Marital status', val: emp.marital_status },
    { key: 'email', label: 'Personal email', val: emp.email || admin?.email },
    { key: 'mobile', label: 'Mobile', val: emp.mobile || admin?.mobile },
    { key: 'nationality', label: 'Nationality', val: emp.nationality },
    { key: 'dob', label: 'Date of birth', val: emp.dob },
    { key: 'gender', label: 'Gender', val: emp.gender },
  ];
  const personalMissing = personalFields.filter(f => !v(f.val));
  if (personalMissing.length === 0) score += sectionWeight;
  else personalMissing.forEach(f => missing.push(`Personal: ${f.label}`));

  // 2. Address (present + permanent: line1, pincode, district, state)
  const addrFields = [
    { key: 'present', label: 'Current address (street)', val: emp.present_address_line1 },
    { key: 'present_pincode', label: 'Current pincode', val: emp.present_pincode },
    { key: 'present_district', label: 'Current district', val: emp.present_district },
    { key: 'present_state', label: 'Current state', val: emp.present_state },
    { key: 'permanent', label: 'Permanent address (street)', val: emp.permanent_address_line1 },
    { key: 'permanent_pincode', label: 'Permanent pincode', val: emp.permanent_pincode },
    { key: 'permanent_district', label: 'Permanent district', val: emp.permanent_district },
    { key: 'permanent_state', label: 'Permanent state', val: emp.permanent_state },
  ];
  const addrMissing = addrFields.filter(f => !v(f.val));
  if (addrMissing.length === 0) score += sectionWeight;
  else addrMissing.forEach(f => missing.push(`Address: ${f.label}`));

  // 3. Current employment (designation, emp_id, circle, doj, emp_type)
  const empFields = [
    { key: 'designation', label: 'Designation', val: emp.designation },
    { key: 'emp_id', label: 'Employee ID', val: emp.emp_id || admin?.emp_id },
    { key: 'circle', label: 'Department', val: admin?.circle },
    { key: 'doj', label: 'Date of joining', val: admin?.doj },
    { key: 'emp_type', label: 'Employment type', val: admin?.emp_type },
  ];
  const empMissing = empFields.filter(f => !v(f.val));
  if (empMissing.length === 0) score += sectionWeight;
  else empMissing.forEach(f => missing.push(`Employment: ${f.label}`));

  // 4. Education (at least one with qualification, institution, start, end)
  const eduFilled = education && education.length > 0 && education.some(e => v(e.qualification) && v(e.institution) && v(e.start) && v(e.end));
  if (eduFilled) score += sectionWeight;
  else missing.push('Education: at least one complete entry (qualification, institution, dates)');

  // 5. Documents (all 6)
  const docMissing = docKeys.filter(k => !v(doc[k]));
  if (docMissing.length === 0) score += sectionWeight;
  else docMissing.forEach(k => missing.push(`Document: ${docLabels[k]}`));

  return { score, missing };
}

function hrProfileVal(val) {
  if (val == null || String(val).trim() === '') return null;
  return String(val).trim();
}

// ----- HR Employee Profile view (from Search Employee → Profile) -----
function HrEmployeeProfileView({ employee, onBack }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/employee/profile/${employee.id}`, { headers: getAuthHeaders() });
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success) setProfile(data.profile);
        else setError(data.message || 'Failed to load profile');
      } catch (e) {
        if (!cancelled) setError('Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);
  const p = profile || {};
  const admin = p.admin || {};
  const emp = p.employee || {};
  const docs = p.documents || {};
  const education = p.education || [];
  const previousEmployment = p.previous_employment || [];
  const docBase = (typeof window !== 'undefined' && window.__BACKEND_STATIC__) ? window.__BACKEND_STATIC__ : '';
  const docUrl = (path) => (path ? `${docBase}/static/uploads/${path}` : null);

  const { score, missing } = hrProfileCompleteness(admin, emp, docs, education);
  const notProvided = '— Not provided';
  const notUploaded = 'Not uploaded';

  const row = (label, value) => {
    const display = value != null && String(value).trim() !== '' ? String(value).trim() : notProvided;
    const isMissing = display === notProvided;
    return (
      <div key={label} className="hr-profile-row">
        <span className="hr-profile-label">{label}</span>
        <span className={isMissing ? 'hr-profile-value hr-profile-value--missing' : 'hr-profile-value'}>
          {display}
        </span>
      </div>
    );
  };

  return (
    <div className="hr-sub-page">
      <button className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Search</button>
      <div className="hr-card">
        <h2>Profile – {employee.name}</h2>
        {loading && <p className="hr-loading">Loading...</p>}
        {error && <p className="hr-error">{error}</p>}
        {profile && (
          <>
            {/* Profile completeness block */}
            <div className="hr-profile-completeness">
              <div className="hr-profile-completeness-header">
                <span className="hr-profile-completeness-title">Profile completion</span>
                <span className="hr-profile-completeness-pct">{score}%</span>
              </div>
              <div className="hr-profile-progress-wrap">
                <div className="hr-profile-progress-bar" style={{ width: `${score}%` }} />
              </div>
              <div className="hr-profile-missing-box">
                <span className="hr-profile-missing-title">Request from employee</span>
                {missing.length === 0 ? (
                  <p className="hr-profile-missing-all-ok">All required fields and documents are provided.</p>
                ) : (
                  <ul className="hr-profile-missing-list">
                    {missing.map((m, i) => <li key={i}>{m}</li>)}
                  </ul>
                )}
              </div>
            </div>

            {/* 1. Personal Information */}
            <div className="profile-section">
              <h4>Personal Information</h4>
              <div className="hr-profile-grid">
                {row('Full name', hrProfileVal(emp.name || admin.first_name))}
                {row("Father's name", hrProfileVal(emp.father_name))}
                {row("Mother's name", hrProfileVal(emp.mother_name))}
                {row('Marital status', hrProfileVal(emp.marital_status))}
                {row('Date of birth', emp.dob ? emp.dob.split('T')[0] : null)}
                {row('Gender', hrProfileVal(emp.gender))}
                {row('Blood group', hrProfileVal(emp.blood_group))}
                {row('Nationality', hrProfileVal(emp.nationality))}
                {row('Personal email', hrProfileVal(emp.email || admin.email))}
                {row('Mobile', hrProfileVal(emp.mobile || admin.mobile))}
                {row('Emergency contact', hrProfileVal(emp.emergency_mobile))}
              </div>
            </div>

            {/* 2. Address */}
            <div className="profile-section">
              <h4>Address</h4>
              <div className="hr-profile-address-block">
                <div className="hr-profile-address-sub">
                  <h5>Current address</h5>
                  {row('Street', hrProfileVal(emp.present_address_line1))}
                  {row('Pincode', hrProfileVal(emp.present_pincode))}
                  {row('District', hrProfileVal(emp.present_district))}
                  {row('State', hrProfileVal(emp.present_state))}
                </div>
                <div className="hr-profile-address-sub">
                  <h5>Permanent address</h5>
                  {row('Street', hrProfileVal(emp.permanent_address_line1))}
                  {row('Pincode', hrProfileVal(emp.permanent_pincode))}
                  {row('District', hrProfileVal(emp.permanent_district))}
                  {row('State', hrProfileVal(emp.permanent_state))}
                </div>
              </div>
            </div>

            {/* 3. Current Employment */}
            <div className="profile-section">
              <h4>Current Employment</h4>
              <div className="hr-profile-grid">
                {row('Designation', hrProfileVal(emp.designation))}
                {row('Employee ID', hrProfileVal(emp.emp_id || admin.emp_id))}
                {row('Department', hrProfileVal(admin.circle))}
                {row('Date of joining', admin.doj ? admin.doj.split('T')[0] : null)}
                {row('Employment type', hrProfileVal(admin.emp_type))}
              </div>
            </div>

            {/* 4. Previous Employment */}
            <div className="profile-section">
              <h4>Previous Employment</h4>
              {previousEmployment.length > 0 ? (
                previousEmployment.map((pe, i) => (
                  <div key={i} className="profile-sub-item">
                    <p><strong>{pe.companyName || notProvided}</strong> – {pe.designation || notProvided}</p>
                    <p>{pe.doj || ''} to {pe.dateOfLeaving || ''} {pe.experienceYears && `(${pe.experienceYears} yrs)`}</p>
                  </div>
                ))
              ) : (
                <p className="hr-profile-empty-section">No previous employment recorded.</p>
              )}
            </div>

            {/* 5. Education */}
            <div className="profile-section">
              <h4>Education</h4>
              {education.length > 0 ? (
                education.map((edu, i) => (
                  <div key={i} className="profile-sub-item">
                    <p><strong>{edu.qualification || notProvided}</strong> – {edu.institution || notProvided}</p>
                    <p>{edu.university || edu.board ? `Board/University: ${edu.university || edu.board}` : ''} {edu.start && edu.end ? `${edu.start} to ${edu.end}` : ''} {edu.marks ? ` • ${edu.marks}` : ''}</p>
                    {edu.doc_file ? (
                      <a href={docUrl(edu.doc_file)} target="_blank" rel="noopener noreferrer" className="doc-link">View certificate</a>
                    ) : (
                      <span className="hr-profile-value--missing">{notUploaded}</span>
                    )}
                  </div>
                ))
              ) : (
                <p className="hr-profile-empty-section">No education recorded.</p>
              )}
            </div>

            {/* 6. Documents */}
            <div className="profile-section">
              <h4>Documents (uploaded by employee)</h4>
              <div className="documents-grid">
                {[
                  { key: 'aadhaar_front', label: 'Aadhaar (Front)' },
                  { key: 'aadhaar_back', label: 'Aadhaar (Back)' },
                  { key: 'pan_front', label: 'PAN (Front)' },
                  { key: 'pan_back', label: 'PAN (Back)' },
                  { key: 'passbook_front', label: 'Passbook (Front)' },
                  { key: 'appointment_letter', label: 'Appointment Letter' },
                ].map(({ key, label }) => (
                  <div key={key} className="doc-item">
                    <span>{label}</span>
                    {docs[key] ? (
                      <a href={docUrl(docs[key])} target="_blank" rel="noopener noreferrer" className="doc-link">View</a>
                    ) : (
                      <span className="hr-profile-value--missing">{notUploaded}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

          </>
        )}
      </div>
    </div>
  );
}

// ----- HR Employee Attendance view (from Search Employee → Attendance) -----
function HrEmployeeAttendanceView({ employee, onBack }) {
  const [monthYear, setMonthYear] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [attendance, setAttendance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const [year, month] = monthYear.split('-').map(Number);
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `${HR_API_BASE}/display-details?user_id=${employee.id}&detail_type=Attendance&month=${month}&year=${year}`,
          { headers: getAuthHeaders() }
        );
        const data = await res.json();
        if (cancelled) return;
        if (res.ok && data.success) setAttendance(data);
        else setAttendance(null);
      } catch {
        if (!cancelled) setAttendance(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id, monthYear]);
  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(
        `${HR_API_BASE}/employee/attendance-download/${employee.id}?month=${monthYear}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Attendance_${(employee.name || 'Employee').replace(/\s+/g, '_')}_${monthYear}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="hr-sub-page">
      <button type="button" className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Search</button>
      <div className="hr-card">
        <h2>Attendance – {employee.name}</h2>
        <div className="attendance-controls">
          <input type="month" value={monthYear} onChange={(e) => setMonthYear(e.target.value)} />
          <button type="button" className="btn-download-attendance" onClick={handleDownload} disabled={downloading}>
            <Download size={16} /> {downloading ? 'Downloading...' : 'Download Attendance'}
          </button>
        </div>
        {loading && <p className="hr-loading">Loading...</p>}
        {attendance && attendance.attendance && (
          <div className="attendance-table-wrap">
            <table className="hr-attendance-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Punch In</th>
                  <th>Punch Out</th>
                  <th>Location (Punch In)</th>
                  <th>Location (Punch Out)</th>
                  <th>Work from home</th>
                  <th>Working hour</th>
                </tr>
              </thead>
              <tbody>
                {attendance.attendance.map((row, i) => (
                  <tr key={i}>
                    <td>{row.date}</td>
                    <td>{row.punch_in || '–'}</td>
                    <td>{row.punch_out || '–'}</td>
                    <td>{row.location_status_in || '–'}</td>
                    <td>{row.location_status_out || '–'}</td>
                    <td>{row.is_wfh ? 'WFH' : '–'}</td>
                    <td>{row.today_work || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ----- HR Employee Accounts profile (from Search Employee -> Employee Accounts) -----
const TAX_REGIME_OPTIONS = ['New Tax Regime', 'Old Tax regime'];

function HrEmployeeAccountsView({ employee, onBack }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [documents, setDocuments] = useState({});
  const [form16Path, setForm16Path] = useState(null);
  const [form, setForm] = useState({
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

  const buildFileUrl = (filePath) => {
    if (!filePath) return null;
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) return filePath;
    const normalized = filePath.replace(/^\/+/, '');
    return `${ACCOUNTS_API_BASE}/file/${normalized}`;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      setSuccess('');
      try {
        const [profileRes, docsRes] = await Promise.all([
          fetch(
            `${ACCOUNTS_API_BASE}/employee-accounts-profile?admin_id=${encodeURIComponent(employee.id)}`,
            { headers: getAuthHeaders() }
          ),
          fetch(
            `${ACCOUNTS_API_BASE}/employee-documents/${encodeURIComponent(employee.id)}`,
            { headers: getAuthHeaders() }
          ),
        ]);
        const data = await profileRes.json().catch(() => ({}));
        const docsData = await docsRes.json().catch(() => ({}));
        if (!profileRes.ok || !data.success) {
          throw new Error(data.message || 'Failed to load employee accounts profile');
        }
        if (!docsRes.ok || !docsData.success) {
          throw new Error(docsData.message || 'Failed to load uploaded documents');
        }
        const p = data.profile || {};
        if (!cancelled) {
          setForm({
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
          setDocuments(docsData.documents || {});
          setForm16Path(docsData.form16_path || null);
          if (!data.profile) {
            setSuccess('No profile found. Fill details and Save.');
          }
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [employee.id]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        admin_id: employee.id,
        employee_number: employee.emp_id || null,
        ...form,
        date_of_joining: form.date_of_joining || null,
      };
      const res = await fetch(`${ACCOUNTS_API_BASE}/employee-accounts-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to save profile');
      }
      setSuccess('Employee accounts profile saved successfully.');
    } catch (e2) {
      setError(e2.message || 'Network error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="hr-sub-page">
      <button className="btn-back-updates" onClick={onBack}><ArrowLeft size={16} /> Back to Search</button>
      <div className="hr-card">
        <h2>Employee Accounts – {employee.name}</h2>
        <p style={{ color: '#64748b', marginTop: '-4px' }}>
          Emp ID: {employee.emp_id || 'N/A'} {employee.email ? `• ${employee.email}` : ''}
        </p>
        {loading && <p className="hr-loading">Loading...</p>}
        {error && <p className="hr-error">{error}</p>}
        {success && <p style={{ color: '#166534', fontWeight: 600 }}>{success}</p>}
        {!loading && (
          <form onSubmit={handleSave} className="hr-employee-accounts-form">
            <div className="form-row">
              <div className="form-group">
                <label>Function</label>
                <input value={form.function} onChange={(e) => setForm((p) => ({ ...p, function: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Designation</label>
                <input value={form.designation} onChange={(e) => setForm((p) => ({ ...p, designation: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Location</label>
                <input value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Date of Joining</label>
                <input type="date" value={form.date_of_joining} onChange={(e) => setForm((p) => ({ ...p, date_of_joining: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Bank Details</label>
                <textarea rows={3} value={form.bank_details} onChange={(e) => setForm((p) => ({ ...p, bank_details: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Tax Regime</label>
                <select
                  value={form.tax_regime}
                  onChange={(e) => setForm((p) => ({ ...p, tax_regime: e.target.value }))}
                >
                  <option value="">— Select —</option>
                  {TAX_REGIME_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {form.tax_regime && !TAX_REGIME_OPTIONS.includes(form.tax_regime) ? (
                    <option value={form.tax_regime}>{form.tax_regime}</option>
                  ) : null}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>PAN</label>
                <input value={form.pan} onChange={(e) => setForm((p) => ({ ...p, pan: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>UAN</label>
                <input value={form.uan} onChange={(e) => setForm((p) => ({ ...p, uan: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>PF Account Number</label>
                <input value={form.pf_account_number} onChange={(e) => setForm((p) => ({ ...p, pf_account_number: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>ESI Number</label>
                <input value={form.esi_number} onChange={(e) => setForm((p) => ({ ...p, esi_number: e.target.value }))} />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>PRAN</label>
                <input value={form.pran} onChange={(e) => setForm((p) => ({ ...p, pran: e.target.value }))} />
              </div>
            </div>
            <div className="form-actions">
              <button type="submit" className="btn-create-account" disabled={saving}>
                {saving ? 'Saving...' : 'Save Employee Accounts'}
              </button>
            </div>

            <div className="profile-section hr-employee-docs-section">
              <h4>Uploaded Documents</h4>
              {(() => {
                const docItems = [
                  { key: 'passbook_front', label: 'Passbook' },
                  { key: 'pan_front', label: 'PAN Front' },
                  { key: 'pan_back', label: 'PAN Back' },
                  { key: 'aadhaar_front', label: 'Aadhaar Front' },
                  { key: 'aadhaar_back', label: 'Aadhaar Back' },
                  { key: 'appointment_letter', label: 'Appointment Letter' },
                ];
                const hasAny = docItems.some((d) => !!documents?.[d.key]) || !!form16Path;
                if (!hasAny) return <p className="no-docs">No documents uploaded yet.</p>;
                return (
                  <div className="hr-employee-docs-grid">
                    {docItems.map((d) => (
                      <div key={d.key} className="hr-employee-doc-item">
                        <div className="hr-employee-doc-meta">
                          <span>{d.label}</span>
                          <span>{documents?.[d.key] ? 'Available' : 'Not uploaded'}</span>
                        </div>
                        {documents?.[d.key] && (
                          <button
                            type="button"
                            className="hr-employee-doc-btn"
                            onClick={() => openProtectedFile(documents[d.key])}
                          >
                            View
                          </button>
                        )}
                      </div>
                    ))}
                    <div className="hr-employee-doc-item">
                      <div className="hr-employee-doc-meta">
                        <span>Form 16</span>
                        <span>{form16Path ? 'Available' : 'Not uploaded'}</span>
                      </div>
                      {form16Path && (
                        <button
                          type="button"
                          className="hr-employee-doc-btn"
                          onClick={() => openProtectedFile(form16Path)}
                        >
                          View
                        </button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ----- HR Punch In/Out form (from Search Employee → Punch In/Out) -----
function HrPunchFormView({ employee, onBack }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [punchIn, setPunchIn] = useState('00:00');
  const [punchOut, setPunchOut] = useState('00:00');
  const [sessions, setSessions] = useState([]);
  const [loadingPunch, setLoadingPunch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const toTime = (iso) => {
    if (!iso) return '';
    const s = String(iso).trim();
    const normalized = s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s;
    const d = new Date(normalized);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  };

  const fetchPunchForDate = async (d) => {
    if (!employee?.id || !d) return;
    setLoadingPunch(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${HR_API_BASE}/employee/punch/${employee.id}?date=${encodeURIComponent(d)}`, {
        method: 'GET',
        headers: { ...getAuthHeaders() },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setSessions([]);
        setPunchIn('00:00');
        setPunchOut('00:00');
        setMessage({ type: 'error', text: data.message || 'Failed to load punch data' });
        return;
      }
      const p = data.punch || {};
      const sess = Array.isArray(p.sessions) ? p.sessions : [];
      setSessions(
        sess.map((s) => ({
          id: s.id ?? null,
          clock_in: toTime(s.clock_in) || '',
          clock_out: s.clock_out ? (toTime(s.clock_out) || '') : '',
          repeat_reason: s.repeat_reason || '',
          extended_hours_reason: s.extended_hours_reason || '',
          is_open: !!s.is_open,
        }))
      );
      // Summary fields when there are no session rows: show API times or 00:00 (no 9–18 default)
      setPunchIn(toTime(p.punch_in) || '00:00');
      setPunchOut(toTime(p.punch_out) || '00:00');
    } catch {
      setSessions([]);
      setPunchIn('00:00');
      setPunchOut('00:00');
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setLoadingPunch(false);
    }
  };

  const punchSummary = useMemo(() => {
    const list = Array.isArray(sessions) ? sessions : [];
    const ins = list.map((s) => (s.clock_in || '').trim()).filter(Boolean).sort();
    const outs = list
      .map((s) => (s.clock_out || '').trim())
      .filter(Boolean)
      .sort();
    const hasOpen = list.some((s) => (s.clock_in || '').trim() && !(s.clock_out || '').trim());
    return {
      punch_in: ins[0] || '',
      punch_out: hasOpen ? '' : (outs[outs.length - 1] || ''),
      hasOpen,
    };
  }, [sessions]);

  useEffect(() => {
    fetchPunchForDate(date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, employee?.id]);

  const updateSession = (idx, patch) => {
    setSessions((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addSession = () => {
    setSessions((prev) => [
      ...prev,
      { id: null, clock_in: '00:00', clock_out: '00:00', repeat_reason: '', extended_hours_reason: '', is_open: false },
    ]);
  };

  const removeSession = (idx) => {
    setSessions((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const hasSessions = Array.isArray(sessions) && sessions.length > 0;
      const endpoint = `${HR_API_BASE}/employee/punch/${employee.id}/sessions`;
      const payload = {
        date,
        sessions: hasSessions
          ? sessions.map((s) => ({
              clock_in: s.clock_in || null,
              clock_out: s.clock_out || null,
              repeat_reason: s.repeat_reason || null,
              extended_hours_reason: s.extended_hours_reason || null,
            }))
          : [],
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: data.message || 'Punch updated successfully.' });
        await fetchPunchForDate(date);
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to update punch' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteAttendanceForDate = async () => {
    const ok = window.confirm(
      `Remove all punch data for ${date}?\n\nUse this if attendance was saved on the wrong date. This cannot be undone.`
    );
    if (!ok) return;
    setDeleting(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(
        `${HR_API_BASE}/employee/punch/${employee.id}?date=${encodeURIComponent(date)}`,
        { method: 'DELETE', headers: { ...getAuthHeaders() } }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: data.message || 'Attendance removed.' });
        await fetchPunchForDate(date);
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to delete attendance' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setDeleting(false);
    }
  };
  return (
    <div className="hr-punch-page">
      <div className="hr-punch-page__header">
        <button type="button" className="hr-punch-page__back" onClick={onBack}>
          <ArrowLeft size={18} /> Back to Search
        </button>
      </div>
      <div className="hr-punch-page__container">
        <div className="hr-punch-page__hero">
          <div className="hr-punch-page__hero-icon">
            <Clock size={32} strokeWidth={2} />
          </div>
          <h1 className="hr-punch-page__hero-title">Update Punch In/Out</h1>
          <p className="hr-punch-page__hero-subtitle">
            Correct or add punch times when an employee forgot to punch. Changes are saved to the database.
          </p>
          <div className="hr-punch-page__employee-badge">
            <UserCheck size={18} />
            <span>{employee.name || 'Employee'}</span>
          </div>
        </div>
        <div className="hr-punch-page__card">
          <form onSubmit={handleSubmit} className="hr-punch-form">
            <div className="hr-punch-form__grid">
              <div className="hr-punch-form__field">
                <label className="hr-punch-form__label" htmlFor="hr-punch-date">Date</label>
                <input
                  id="hr-punch-date"
                  type="date"
                  className="hr-punch-form__input"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </div>
              <div className="hr-punch-form__field">
                <label className="hr-punch-form__label" htmlFor="hr-punch-in">Punch In</label>
                <input
                  id="hr-punch-in"
                  type="time"
                  className="hr-punch-form__input hr-punch-form__input--time"
                  value={punchSummary.punch_in || punchIn}
                  readOnly
                  disabled
                />
              </div>
              <div className="hr-punch-form__field">
                <label className="hr-punch-form__label" htmlFor="hr-punch-out">Punch Out</label>
                <input
                  id="hr-punch-out"
                  type="time"
                  className="hr-punch-form__input hr-punch-form__input--time"
                  value={punchSummary.punch_out || punchOut}
                  readOnly
                  disabled
                />
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                <div style={{ fontWeight: 700, color: '#1e293b' }}>Sessions</div>
                <button
                  type="button"
                  onClick={addSession}
                  disabled={submitting || loadingPunch}
                  className="hr-punch-form__submit"
                  style={{ width: 'auto', padding: '10px 14px', fontSize: 13 }}
                >
                  + Add session
                </button>
              </div>
              {loadingPunch ? (
                <p style={{ margin: '10px 0 0', color: '#64748b' }}>Loading sessions…</p>
              ) : sessions.length === 0 ? (
                <p style={{ margin: '10px 0 0', color: '#64748b' }}>
                  No sessions found for this date. Add a session to create one.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                  {sessions.map((s, idx) => (
                    <div
                      key={`${s.id ?? 'new'}-${idx}`}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: 12,
                        background: '#fff',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                        <div className="hr-punch-form__field" style={{ margin: 0 }}>
                          <label className="hr-punch-form__label">In</label>
                          <input
                            type="time"
                            className="hr-punch-form__input hr-punch-form__input--time"
                            value={s.clock_in}
                            onChange={(e) => updateSession(idx, { clock_in: e.target.value })}
                            required
                          />
                        </div>
                        <div className="hr-punch-form__field" style={{ margin: 0 }}>
                          <label className="hr-punch-form__label">Out</label>
                          <input
                            type="time"
                            className="hr-punch-form__input hr-punch-form__input--time"
                            value={s.clock_out}
                            onChange={(e) => updateSession(idx, { clock_out: e.target.value })}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSession(idx)}
                          disabled={submitting || loadingPunch}
                          className="hr-punch-form__submit"
                          style={{
                            width: 'auto',
                            padding: '10px 12px',
                            fontSize: 13,
                            background: '#ef4444',
                            boxShadow: 'none',
                          }}
                        >
                          Remove
                        </button>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, marginTop: 10 }}>
                        <div className="hr-punch-form__field" style={{ margin: 0 }}>
                          <label className="hr-punch-form__label">Repeat punch reason (optional)</label>
                          <input
                            type="text"
                            className="hr-punch-form__input"
                            value={s.repeat_reason}
                            onChange={(e) => updateSession(idx, { repeat_reason: e.target.value })}
                            placeholder="Only for 2nd+ punch-in same day"
                          />
                        </div>
                        <div className="hr-punch-form__field" style={{ margin: 0 }}>
                          <label className="hr-punch-form__label">Extended hours reason (optional)</label>
                          <input
                            type="text"
                            className="hr-punch-form__input"
                            value={s.extended_hours_reason}
                            onChange={(e) => updateSession(idx, { extended_hours_reason: e.target.value })}
                            placeholder="For long sessions crossing midnight"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {message.text && (
              <div className={`hr-punch-form__message hr-punch-form__message--${message.type}`} role="alert">
                {message.text}
              </div>
            )}
            <div className="hr-punch-form__actions-row">
              <button type="submit" className="hr-punch-form__submit" disabled={submitting || deleting}>
                {submitting ? 'Saving...' : 'Save Punch'}
              </button>
              <button
                type="button"
                className="hr-punch-form__submit hr-punch-form__submit--danger"
                disabled={submitting || deleting || loadingPunch}
                onClick={handleDeleteAttendanceForDate}
              >
                <Trash2 size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
                {deleting ? 'Removing…' : 'Delete attendance for this date'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export const Hr = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [view, setView] = usePersistedView({
    storageKey: 'hr_panel_view',
    defaultView: 'main',
    validViews: HR_PANEL_VIEWS,
  });
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState('');
  const [selectedEmployeeType, setSelectedEmployeeType] = useState('');
  const [openDropdownKey, setOpenDropdownKey] = useState(null);
  const [dropdownPosition, setDropdownPosition] = useState(null);
  const dropdownRef = useRef(null);
  const dropdownEmployeeRef = useRef(null);

  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [dashboardError, setDashboardError] = useState(null);
  const [counts, setCounts] = useState({ total_employees: 0, new_joinees_last_30_days: 0, today_punch_in_count: 0 });
  const [birthdays, setBirthdays] = useState([]);
  const [anniversaries, setAnniversaries] = useState([]);

  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchDownloadMonth, setSearchDownloadMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const [searchDownloading, setSearchDownloading] = useState(false);
  const [searchClientDownloading, setSearchClientDownloading] = useState(false);
  const [masterOptions, setMasterOptions] = useState({ departments: [], circles: [] });
  const [masterLoading, setMasterLoading] = useState(false);

  const [signupForm, setSignupForm] = useState({
    user_name: '',
    first_name: '',
    email: '',
    emp_id: '',
    mobile: '',
    doj: '',
    emp_type: '',
    circle: '',
    password: '',
    confirmPassword: ''
  });
  const [signupSubmitting, setSignupSubmitting] = useState(false);
  const [signupError, setSignupError] = useState('');
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [signupEditEmail, setSignupEditEmail] = useState(null); // when set, signup form is in "update" mode
  /** Snapshot when opening edit — used to send only changed fields on update. */
  const [signupEditOriginal, setSignupEditOriginal] = useState(null);
  /** Required when circle changes in edit mode (business effective date). */
  const [circleEffectiveFrom, setCircleEffectiveFrom] = useState('');
  const [circleTransferNotes, setCircleTransferNotes] = useState('');
  /** Last Update SignUp search (filters + rows) so returning from edit keeps results without re-searching. */
  const [updateSignupSearchSnapshot, setUpdateSignupSearchSnapshot] = useState(null);

  const [resetPasswordEmail, setResetPasswordEmail] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [resetPasswordMessage, setResetPasswordMessage] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');

  const openSignupForEdit = (employeeData) => {
    const snapshot = {
      user_name: employeeData.user_name || '',
      first_name: employeeData.first_name || '',
      email: employeeData.email || '',
      emp_id: employeeData.emp_id || '',
      mobile: employeeData.mobile || '',
      doj: (employeeData.doj || '').slice(0, 10),
      emp_type: employeeData.emp_type || '',
      circle: employeeData.circle || '',
    };
    setSignupEditOriginal(snapshot);
    setCircleEffectiveFrom(new Date().toISOString().slice(0, 10));
    setCircleTransferNotes('');
    setSignupForm({
      ...snapshot,
      password: '',
      confirmPassword: ''
    });
    setSignupEditEmail(employeeData.email || null);
    setSignupSuccess(false);
    setSignupError('');
    setView('signup');
  };

  const buildEmployeeUpdatePayload = (form, original) => {
    const norm = (v) => (v ?? '').toString().trim();
    const normDoj = (v) => norm(v).slice(0, 10);
    const payload = {};
    const fields = [
      ['user_name', norm(form.user_name)],
      ['first_name', norm(form.first_name)],
      ['emp_id', norm(form.emp_id)],
      ['mobile', norm(form.mobile).replace(/\s/g, '')],
      ['doj', normDoj(form.doj)],
      ['emp_type', norm(form.emp_type)],
      ['circle', norm(form.circle)],
    ];
    for (const [key, value] of fields) {
      const prev = key === 'doj' ? normDoj(original[key]) : norm(original[key]);
      if (value && value !== prev) {
        payload[key] = value;
      }
    }
    return payload;
  };

  const handleSignupChange = (e) => {
    const { name, value } = e.target;
    if (name === 'mobile') {
      const digitsOnly = value.replace(/\D/g, '').slice(0, 10);
      setSignupForm(prev => ({ ...prev, [name]: digitsOnly }));
    } else {
      setSignupForm(prev => ({ ...prev, [name]: value }));
    }
    setSignupError('');
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError('');
    const { user_name, first_name, email, emp_id, mobile, doj, emp_type, circle, password, confirmPassword } = signupForm;
    const isUpdate = !!signupEditEmail;

    if (!isUpdate) {
      if (!user_name?.trim() || !first_name?.trim() || !email?.trim() || !emp_id?.trim() || !mobile?.trim() || !doj || !emp_type || !circle) {
        setSignupError('Please fill in all required fields (UserName, Full Name, Email, Employee ID, Mobile, DOJ, Employee Type, Circle).');
        return;
      }
      if (mobile.length !== 10) {
        setSignupError('Mobile number must be exactly 10 digits.');
        return;
      }
    } else {
      const mobileTrim = (mobile || '').trim().replace(/\s/g, '');
      if (mobileTrim && mobileTrim.length !== 10) {
        setSignupError('Mobile number must be exactly 10 digits.');
        return;
      }
    }

    if (password && password !== confirmPassword) {
      setSignupError('Password and Confirm Password do not match.');
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      setSignupError('Please log in to create an employee account.');
      return;
    }
    setSignupSubmitting(true);
    try {
      if (signupEditEmail) {
        const updateBody = signupEditOriginal
          ? buildEmployeeUpdatePayload(signupForm, signupEditOriginal)
          : {};
        if (password?.trim()) {
          updateBody.password = password.trim();
        }
        if (updateBody.circle) {
          if (!circleEffectiveFrom) {
            setSignupError('Please enter the effective date when the employee started working in the new circle.');
            setSignupSubmitting(false);
            return;
          }
          updateBody.circle_effective_from = circleEffectiveFrom;
          if (circleTransferNotes.trim()) {
            updateBody.circle_transfer_notes = circleTransferNotes.trim();
          }
        }
        if (Object.keys(updateBody).length === 0) {
          setSignupError('No changes to save. Edit a field or set a new password.');
          setSignupSubmitting(false);
          return;
        }
        // Update existing employee (partial — only changed fields)
        const res = await fetch(
          `${HR_API_BASE}/employee/by-email/${encodeURIComponent(signupEditEmail)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify(updateBody)
          }
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setSignupSuccess(true);
          setUpdateSignupSearchSnapshot((prev) => {
            if (!prev?.employees?.length || !signupEditEmail) return prev;
            const emailLower = signupEditEmail.toLowerCase();
            const nextEmployees = prev.employees.map((emp) =>
              (emp.email || '').toLowerCase() === emailLower
                ? {
                    ...emp,
                    emp_id: emp_id.trim(),
                    first_name: first_name.trim(),
                  }
                : emp
            );
            return { ...prev, employees: nextEmployees };
          });
        } else {
          setSignupError(data.message || 'Failed to update employee.');
        }
      } else {
        // Create new employee
        const res = await fetch(`${HR_API_BASE}/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            user_name: user_name.trim(),
            first_name: first_name.trim(),
            email: email.trim(),
            emp_id: emp_id.trim(),
            mobile: mobile.trim().replace(/\s/g, ''),
            doj,
            emp_type,
            circle,
            ...(password?.trim() ? { password: password.trim() } : {})
          })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setSignupSuccess(true);
          setSignupForm({ user_name: '', first_name: '', email: '', emp_id: '', mobile: '', doj: '', emp_type: '', circle: '', password: '', confirmPassword: '' });
        } else {
          setSignupError(data.message || 'Failed to create account.');
        }
      }
    } catch (err) {
      console.error(err);
      setSignupError('Network error. Please try again.');
    } finally {
      setSignupSubmitting(false);
    }
  };

  const [selectedEmployeeForAction, setSelectedEmployeeForAction] = useState(null);

  const stats = [
    { title: 'Total Employees', value: String(counts.enabled_employees ?? counts.total_employees), subtitle: 'Enabled employees', icon: Users, color: 'blue' },
    { title: 'New Hires', value: String(counts.new_joinees_last_30_days), subtitle: 'Last 30 days', icon: UserPlus, color: 'green' },
    { title: 'Active Today', value: String(counts.today_punch_in_count), subtitle: 'Punched in today', icon: UserCheck, color: 'teal' },
  ];

  const updateOptions = [
    { title: 'Sign Up', icon: UserPlus, description: 'New employee registration' },
    { title: 'Reset Employee Password', icon: Key, description: 'Send password reset link (1 hour)' },
    { title: 'Update_SignUp', icon: UserCog, description: 'Modify signup details' },
    { title: 'Circle Transfer History', icon: ArrowRightLeft, description: 'View circle changes with effective dates' },
    { title: 'News Feed', icon: Newspaper, description: 'Company announcements' },
    { title: 'Update Leave', icon: FileText, description: 'Modify leave records' },
    { title: 'Leave Application Updation', icon: FileText, description: 'Update leave dates/status with auto balance sync' },
    { title: 'Assessment Invite', icon: FileCheck, description: 'Send secure 15-minute assessment links and evaluate submissions' },
    { title: 'Update Manager', icon: UserCog, description: 'Change manager assignments' },
    { title: 'Add Locations', icon: MapPin, description: 'Add office locations' },
    { title: 'NOC Requests', icon: FileCheck, description: 'HR NOC clearance queue from separating employees' },
    { title: 'Exit Employee', icon: Users, description: 'Employee Exit Handling' },
    { title: 'Ex-Employee Document Sharing', icon: Share2, description: 'Send time-limited document links to former staff' },
    { title: 'Add Department And Circle', icon: MapPin, description: 'Add departments and circles Types' },
    { title: 'Leave Accrual Monitor', icon: FileCheck, description: 'Monitor PL/CL scheduler runs' },
    { title: 'Holiday Calendar', icon: FileText, description: 'View yearly holiday list' },
  ];

  const isUpdateOptionAllowed = (title) => {
    if (title === 'Assessment Invite') return hasFeature('hr_assessment_invite');
    if (title === 'Add Department And Circle') return hasFeature('hr_add_dept_circle');
    if (title === 'Ex-Employee Document Sharing') return hasFeature('hr_ex_employee_docs');
    return true;
  };

  const visibleUpdateOptions = updateOptions.filter((o) => isUpdateOptionAllowed(o.title));

  const employeeDetailsOptions = [
    'Profile',
    'Attendance',
    'Punch In/Out',
    ...(hasFeature('hr_employee_accounts') ? ['Employee Accounts'] : []),
  ];

  const handleSearch = async () => {
    if (!selectedCircle || !selectedEmployeeType) {
      alert("Please select both Circle and Employee Type");
      return;
    }
    const token = localStorage.getItem('token');
    if (!token) {
      alert("Please log in to search employees.");
      return;
    }
    setSearchLoading(true);
    try {
      const res = await fetch(
        `${HR_API_BASE}/search?circle=${encodeURIComponent(selectedCircle)}&emp_type=${encodeURIComponent(selectedEmployeeType)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      if (res.ok && data.success && data.employees) {
        setSearchResults(data.employees.map((e) => ({
          name: e.name,
          email: e.email,
          emp_id: e.emp_id || '',
          circle: selectedCircle,
          type: selectedEmployeeType,
          id: e.id
        })));
        setShowSearchResults(true);
      } else {
        setSearchResults([]);
        setShowSearchResults(true);
        if (!data.success && data.message) alert(data.message);
      }
    } catch (err) {
      console.error(err);
      setSearchResults([]);
      setShowSearchResults(true);
    } finally {
      setSearchLoading(false);
    }
  };

  const handleBackToSearch = () => {
    setShowSearchResults(false);
    setOpenDropdownKey(null);
  };

  const handleDownloadAllFromSearch = async () => {
    if (!selectedCircle || !selectedEmployeeType) {
      alert('Please search by Circle and Employee Type first.');
      return;
    }
    setSearchDownloading(true);
    try {
      const res = await fetch(
        `${HR_API_BASE}/download-excel?circle=${encodeURIComponent(selectedCircle)}&emp_type=${encodeURIComponent(selectedEmployeeType)}&month=${searchDownloadMonth}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Download failed');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Attendance_${selectedCircle}_${selectedEmployeeType.replace(/\s+/g, '_')}_${searchDownloadMonth}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || 'Download failed');
    } finally {
      setSearchDownloading(false);
    }
  };

  const extractFilenameFromContentDisposition = (contentDisposition) => {
    if (!contentDisposition) return null;
    const match = contentDisposition.match(/filename\*?=(?:UTF-8''|")?([^";\n]+)/i);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1].replace(/"/g, ''));
    } catch {
      return match[1].replace(/"/g, '');
    }
  };

  const handleDownloadClientAllFromSearch = async () => {
    if (!selectedCircle || !selectedEmployeeType) {
      alert('Please search by Circle and Employee Type first.');
      return;
    }
    setSearchClientDownloading(true);
    try {
      const res = await fetch(
        `${ACCOUNTS_API_BASE}/download-excel-client?circle=${encodeURIComponent(selectedCircle)}&emp_type=${encodeURIComponent(selectedEmployeeType)}&month=${searchDownloadMonth}`,
        { headers: getAuthHeaders() }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Client download failed');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      const contentDisposition = res.headers.get('content-disposition') || '';
      const filenameFromServer = extractFilenameFromContentDisposition(contentDisposition);
      a.download =
        filenameFromServer ||
        `Client_Attendance_${selectedCircle}_${selectedEmployeeType.replace(/\s+/g, '_')}_${searchDownloadMonth}.xlsx`;

      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || 'Client download failed');
    } finally {
      setSearchClientDownloading(false);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) {
      setDashboardLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${HR_API_BASE}/dashboard`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          if (!cancelled) setDashboardError('Failed to load dashboard');
          return;
        }
        const data = await res.json();
        if (cancelled || !data.success) return;
        setCounts({
          total_employees: 0,
          enabled_employees: 0,
          new_joinees_last_30_days: 0,
          today_punch_in_count: 0,
          ...(data.counts || {}),
        });
        setBirthdays(data.birthdays || []);
        setAnniversaries(data.anniversaries || []);
        setDashboardError(null);
      } catch (err) {
        if (!cancelled) setDashboardError('Failed to load dashboard');
      } finally {
        if (!cancelled) setDashboardLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;
    let cancelled = false;
    (async () => {
      setMasterLoading(true);
      try {
        const res = await fetch(`${HR_API_BASE}/master/options`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok && data.success) {
          const departments = data.departments || [];
          const circles = data.circles || [];
          setMasterOptions({ departments, circles });
          setSelectedEmployeeType((prev) => prev || departments[0] || '');
          setSelectedCircle((prev) => prev || circles[0] || '');
          setSignupForm((prev) => ({
            ...prev,
            emp_type: prev.emp_type || departments[0] || '',
            circle: prev.circle || circles[0] || '',
          }));
        }
      } catch (err) {
        console.error(err);
      } finally {
        if (!cancelled) setMasterLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
// }
  
  
     //Added by me 
    // If navigated here with a `view` in location.state, switch to it (e.g. 'updates')
    useEffect(() => {
      if (location && location.state && location.state.view) {
        setView(location.state.view);
      }
    }, [location]);

  // const searchResults = [
  //   { name: 'Amit', email: 'akumar4@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  //   { name: 'Neha', email: 'nphatak@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  //   { name: 'Plasha', email: 'ppal@saffotech.com', circle: selectedCircle, type: selectedEmployeeType },
  // ];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (event.target.closest?.('.results-actions')) return;
      if (event.target.closest?.('.dropdown-menu-list--fixed')) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownKey(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (openDropdownKey === null) {
      setDropdownPosition(null);
      dropdownEmployeeRef.current = null;
      return;
    }
    const emp = searchResults.find((row) => (row.id ?? row.email) === openDropdownKey);
    if (emp) dropdownEmployeeRef.current = emp;
    const updatePosition = () => {
      const btn = dropdownRef.current?.querySelector('.btn-update-toggle');
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const w = 200;
      setDropdownPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.right - w, window.innerWidth - w - 8),
      });
    };
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [openDropdownKey, searchResults]);

  const toggleDropdown = (employeeKey) => {
    setOpenDropdownKey(openDropdownKey === employeeKey ? null : employeeKey);
  };

  const handleOptionClick = (option, emp) => {
    const employee = emp ?? dropdownEmployeeRef.current;
    setOpenDropdownKey(null);
    dropdownEmployeeRef.current = null;
    if (!employee) return;
    setSelectedEmployeeForAction(employee);
    if (option === 'Profile') setView('employee_profile');
    else if (option === 'Attendance') setView('employee_attendance');
    else if (option === 'Punch In/Out') setView('punch_form');
    else if (option === 'Employee Accounts') {
      if (!hasFeature('hr_employee_accounts')) {
        alert('Employee Accounts is not included in your subscription plan.');
        return;
      }
      setView('employee_accounts');
    }
  };

  const handleUpdateCardClick = (title) => {
    if (!isUpdateOptionAllowed(title)) {
      alert('This feature is not included in your subscription plan.');
      return;
    }
    if (title === 'Sign Up') {
      setSignupSuccess(false);
      setSignupError('');
      setSignupEditEmail(null);
      setView('signup');
    } 
    else if (title === 'Update_SignUp') {
      setUpdateSignupSearchSnapshot(null);
      setView('update_signup');
    }
    else if (title === 'Circle Transfer History') {
      setView('circle_transfer_history');
    }
    else if (title === 'News Feed') {
      setView('newsfeed');
    } else if (title === 'Update Leave') {
      setView('update_leave');
    } else if (title === 'Leave Application Updation') {
      setView('leave_updation');
    } else if (title === 'Assessment Invite') {
      setView('assessment_invite');
    } else if (title === 'Update Manager') {setView('update_manager');
  }   else if (title === 'Add Locations') {
    setView('add_location');
  }
  else if (title === 'NOC Requests') {
    setView('noc_requests');
  }
  else if (title === 'Exit Employee') { //New Condition For Exit Employee
  setView('exit_employee');
}
  else if (title === 'Ex-Employee Document Sharing') {
    setView('ex_employee_doc_share');
  }
  else if (title === 'Add Department And Circle') {
  setView('add_dept_circle');
}
else if (title === 'Reset Employee Password') {
  setResetPasswordMessage('');
  setResetPasswordError('');
  setView('reset_password');
}
else if (title === 'Leave Accrual Monitor') {
  setView('leave_accrual_monitor');
}
else if (title === 'Holiday Calendar') {
  setView('holiday_calendar');
}
    else {
      console.log(`Navigating to ${title}`);
    }
  };
if (view === 'ex_employee_doc_share') {
    return <ExEmployeeDocumentSharing onBack={() => setView('updates')} />;
  }

  if (view === 'circle_transfer_history') {
    return (
      <CircleTransferHistory
        onBack={() => setView('updates')}
        circleOptions={masterOptions.circles}
      />
    );
  }

  if (view === 'update_signup') {
    return (
      <UpdateSignUp
        onBack={() => setView('updates')}
        onOpenSignupForEmployee={openSignupForEdit}
        empTypeOptions={masterOptions.departments}
        circleOptions={masterOptions.circles}
        persistedSearch={updateSignupSearchSnapshot}
        onPersistSearch={setUpdateSignupSearchSnapshot}
      />
    );
  }

  if (view === 'newsfeed') {
  return <AddNewsFeed onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />;
}
if (view === 'update_leave'){
  return <UpdateLeave onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />
}
if (view === 'leave_updation'){
  return <LeaveApplicationUpdation onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />
}
if (view === 'assessment_invite'){
  return <HRAssessmentInvite onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} />
}

if (view === 'update_manager') {
  return <UpdateManager onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />;
}

if (view === 'add_location') {
  return <AddLocation onBack={() => setView('updates')} />;
}
if (view === 'exit_employee') {  //new condition for exit employee 
  return <ExitEmployee onBack={() => setView('updates')} />;
}

if (view === 'add_dept_circle') { //new condition for add department and cir.
  return <AddDeptCircle onBack={() => setView('updates')} />;
}

if (view === 'leave_accrual_monitor') {
  return <LeaveAccrualSummary onBack={() => setView('updates')} />;
}

if (view === 'holiday_calendar') {
  return <HolidayCalendar onBack={() => setView('updates')} />;
}

// Simple placeholder view for Add Circle & Employee Type card
if (view === 'add_circle_type') {
  return (
    <div className="add-circle-placeholder">
      <button className="btn-back-updates" onClick={() => setView('updates')}>
        <ArrowLeft size={16} /> Back to Updates
      </button>
      <div style={{padding:20}}>
        <h2>Add Circle & Employee Type</h2>
        <p>This view is a placeholder. Implement the add forms here when ready.</p>
      </div>
    </div>
  );
}
if (view === 'noc_requests') {
  return (
    <div className="hr-main-container fade-in">
      <div className="rr-page" style={{ minHeight: 'auto', padding: '20px' }}>
        <div className="rr-topbar" style={{ marginBottom: 8 }}>
          <button type="button" className="rr-back-btn" onClick={() => setView('updates')}>
            <ArrowLeft size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Back to Updates
          </button>
          <h1 style={{ margin: 0, fontSize: 22, color: '#0f172a' }}>NOC Requests (Human Resource)</h1>
        </div>
        <p style={{ color: '#64748b', marginBottom: 16, maxWidth: 720 }}>
          Separation NOC requests routed to HR. Upload clearance documents when status is Pending.
        </p>
        <DepartmentNocPanel
          apiBase="/api/HumanResource"
          statusFilter="All"
          variant="table"
          requireResignationApprovedToDownload
        />
      </div>
    </div>
  );
}

  // ----- Search Employee actions: Profile, Attendance, Punch In/Out -----
  if (view === 'employee_profile' && selectedEmployeeForAction) {
    return (
      <HrEmployeeProfileView
        employee={selectedEmployeeForAction}
        onBack={() => { setView('main'); setSelectedEmployeeForAction(null); }}
      />
    );
  }
  if (view === 'employee_attendance' && selectedEmployeeForAction) {
    return (
      <HrEmployeeAttendanceView
        employee={selectedEmployeeForAction}
        onBack={() => { setView('main'); setSelectedEmployeeForAction(null); }}
      />
    );
  }
  if (view === 'punch_form' && selectedEmployeeForAction) {
    return (
      <HrPunchFormView
        employee={selectedEmployeeForAction}
        onBack={() => { setView('main'); setSelectedEmployeeForAction(null); }}
      />
    );
  }
  if (view === 'employee_accounts' && selectedEmployeeForAction) {
    return (
      <HrEmployeeAccountsView
        employee={selectedEmployeeForAction}
        onBack={() => { setView('main'); setSelectedEmployeeForAction(null); }}
      />
    );
  }

  // VIEW: Reset employee password (send link, 1 hour expiry)
  if (view === 'reset_password') {
    const handleSendResetLink = async (e) => {
      e.preventDefault();
      const email = (resetPasswordEmail || '').trim();
      if (!email) {
        setResetPasswordError('Enter employee email.');
        return;
      }
      setResetPasswordError('');
      setResetPasswordMessage('');
      setResetPasswordLoading(true);
      try {
        const res = await fetch(`${HR_API_BASE}/send-password-reset`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
          body: JSON.stringify({ employee_email: email }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setResetPasswordMessage(data.message || 'Reset link sent. The link expires in 1 hour.');
          setResetPasswordEmail('');
        } else {
          setResetPasswordError(data.message || 'Failed to send reset link.');
        }
      } catch (err) {
        setResetPasswordError('Network error. Please try again.');
      } finally {
        setResetPasswordLoading(false);
      }
    };
    return (
      <div className="signup-page-container">
        <div className="signup-content-wrapper">
          <button className="btn-back-updates" onClick={() => { setView('updates'); setResetPasswordMessage(''); setResetPasswordError(''); }}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
          <div className="signup-card">
            <div className="card-header">
              <h2>Reset employee password</h2>
              <p>Send a password reset link to the employee&apos;s email. The link is valid for 1 hour. Only that employee can set a new password using the link.</p>
            </div>
            {resetPasswordMessage && (
              <div className="signup-success-msg" style={{ padding: '12px', marginBottom: '16px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>
                {resetPasswordMessage}
              </div>
            )}
            {resetPasswordError && (
              <div className="signup-error-msg" style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {resetPasswordError}
              </div>
            )}
            <form className="signup-form" onSubmit={handleSendResetLink}>
              <div className="form-row">
                <div className="form-group">
                  <label>Employee email <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input
                    type="email"
                    placeholder="employee@company.com"
                    value={resetPasswordEmail}
                    onChange={(e) => setResetPasswordEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <button type="submit" className="btn-create-account" disabled={resetPasswordLoading}>
                  {resetPasswordLoading ? 'Sending…' : 'Send reset link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // VIEW 1: SIGN UP PAGE (create new or update existing)
  if (view === 'signup') {
    const isEditMode = !!signupEditEmail;
    const normCircle = (v) => (v ?? '').toString().trim().toLowerCase();
    const circleChangedInEdit =
      isEditMode &&
      signupEditOriginal &&
      normCircle(signupForm.circle) !== normCircle(signupEditOriginal.circle);
    return (
      <div className="signup-page-container">

        <div className="signup-content-wrapper">
          <button
            type="button"
            className="btn-back-updates"
            onClick={() => {
              const backToUpdateSignUpSearch = !!signupEditEmail;
              setSignupEditEmail(null);
              setSignupEditOriginal(null);
              setCircleEffectiveFrom('');
              setCircleTransferNotes('');
              setSignupError("");
              setView(backToUpdateSignUpSearch ? "update_signup" : "updates");
            }}
          >
            <ArrowLeft size={16} /> {isEditMode ? "Back to Search" : "Back to Updates"}
          </button>

          <div className="signup-card">
            <div className="card-header">
              <h2>{isEditMode ? 'Update Employee Details' : 'Create New Employee Account'}</h2>
              <p>{isEditMode ? 'Change only the fields you need; other details stay as they are.' : 'Fill in the details to register a new employee'}</p>
            </div>
            {signupSuccess && (
              <div className="signup-success-msg" style={{ padding: '12px', marginBottom: '16px', background: '#dcfce7', color: '#166534', borderRadius: '8px' }}>
                {isEditMode ? 'Employee details updated successfully.' : 'Employee onboarded successfully. You can create another or go back.'}
              </div>
            )} 
            {signupError && (
              <div className="signup-error-msg" style={{ padding: '12px', marginBottom: '16px', background: '#fef2f2', color: '#b91c1c', borderRadius: '8px' }}>
                {signupError}
              </div>
            )}
            <form className="signup-form" onSubmit={handleSignupSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>UserName {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="user_name" type="text" placeholder="Create Unique UserName" value={signupForm.user_name} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Full Name {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="first_name" type="text" placeholder="Enter your Full Name" value={signupForm.first_name} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="email" type="email" placeholder="Enter your Email ID" value={signupForm.email} onChange={handleSignupChange} readOnly={isEditMode} disabled={isEditMode} style={isEditMode ? { opacity: 0.9, cursor: 'not-allowed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Employee ID {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="emp_id" type="text" placeholder="Enter your Employee ID" value={signupForm.emp_id} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Number {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="mobile" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={10} placeholder="Enter 10-digit Mobile Number" value={signupForm.mobile} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Date of Joining {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <input name="doj" type="date" value={signupForm.doj} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Employee Type {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <select name="emp_type" value={signupForm.emp_type} onChange={handleSignupChange}>
                    <option value="">Select Employee Type</option>
                    {masterOptions.departments.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Circle {!isEditMode && <span style={{ color: '#b91c1c' }}>*</span>}</label>
                  <select name="circle" value={signupForm.circle} onChange={handleSignupChange}>
                    <option value="">Choose Your Circle</option>
                    {masterOptions.circles.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>

              {circleChangedInEdit ? (
                <div
                  className="form-row"
                  style={{
                    marginTop: 4,
                    padding: '12px 14px',
                    background: '#eff6ff',
                    borderRadius: 8,
                    border: '1px solid #bfdbfe',
                  }}
                >
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>
                      Effective from <span style={{ color: '#b91c1c' }}>*</span>
                    </label>
                    <input
                      type="date"
                      value={circleEffectiveFrom}
                      onChange={(e) => {
                        setCircleEffectiveFrom(e.target.value);
                        setSignupError('');
                      }}
                      required
                    />
                    <p style={{ margin: '6px 0 0', fontSize: '0.85rem', color: '#475569' }}>
                      Date the employee actually started in the new circle (may be earlier than today if HR is updating late).
                    </p>
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label>Note (optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. Late HR update"
                      value={circleTransferNotes}
                      onChange={(e) => setCircleTransferNotes(e.target.value)}
                      maxLength={500}
                    />
                  </div>
                </div>
              ) : null}

              <div className="form-row">
                <div className="form-group">
                  <label>Password (optional)</label>
                  <input name="password" type="password" placeholder="Leave blank to send set-password email" value={signupForm.password} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Confirm Password</label>
                  <input name="confirmPassword" type="password" placeholder="Confirm your Password" value={signupForm.confirmPassword} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-actions">
                <button type="submit" className="btn-create-account" disabled={signupSubmitting}>
                  {signupSubmitting ? (signupEditEmail ? 'Updating...' : 'Creating...') : (signupEditEmail ? 'Update Details' : 'Create Account')}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    );
  }

  // VIEW 2: UPDATES GRID

  if (view === 'updates') {
    return (
      <div className="hr-main-container">
        <button className="btn-back" onClick={() => setView('main')}>
          <ArrowLeft size={18} /> Back to HR Panel
        </button>
        <div className="updates-grid">
          {visibleUpdateOptions.map((option) => (
            <div key={option.title} className="update-card" onClick={() => handleUpdateCardClick(option.title)}>
              <div className="update-icon-box">
                <option.icon size={24} />
              </div>
              <div className="update-text">
                <h4>{option.title}</h4>
                <p>{option.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // VIEW 3: MAIN HR PANEL
  return (
    <div className="hr-main-container">
      {dashboardLoading && <p className="hr-loading">Loading dashboard...</p>}
      {dashboardError && <p className="hr-error">{dashboardError}</p>}

      {!dashboardLoading && (birthdays.length > 0 || anniversaries.length > 0) && (
        <div className="birthday-anniversary-section">
          {birthdays.length > 0 && (
            <div className="birthday-anniversary-card">
              <div className="card-icon-wrapper">
                <div className="icon-circle">
                  <Cake size={24} className="icon-gold" />
                </div>
              </div>
              <div className="card-content-wrapper">
                <div className="card-header-row">
                  <span className="emoji-cake">🎂</span>
                  <h3 className="card-title-text">Birthday (DOB)</h3>
                </div>
                {birthdays.map((b, i) => (
                  <div key={i} className="employee-celebration-block">
                    <h2 className="employee-name-text">{b.name}</h2>
                    <div className="employee-details-row">
                      <span className="detail-item"><strong className="detail-label">Date:</strong> {formatDateShort(b.dob)}</span>
                      {b.designation && <span className="detail-item"><strong className="detail-label">Designation:</strong> {b.designation}</span>}
                      <span className="detail-item"><strong className="detail-label">Email:</strong> {b.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {anniversaries.length > 0 && (
            <div className="birthday-anniversary-card anniversary-card">
              <div className="card-icon-wrapper">
                <div className="icon-circle">
                  <Cake size={24} className="icon-gold" />
                </div>
              </div>
              <div className="card-content-wrapper">
                <div className="card-header-row">
                  <span className="emoji-cake">🎉</span>
                  <h3 className="card-title-text">Work Anniversary (DOJ)</h3>
                </div>
                {anniversaries.map((a, i) => (
                  <div key={i} className="employee-celebration-block">
                    <h2 className="employee-name-text">{a.name}</h2>
                    <div className="employee-details-row">
                      <span className="detail-item"><strong className="detail-label">DOJ:</strong> {formatDateShort(a.doj)}</span>
                      {a.designation && <span className="detail-item"><strong className="detail-label">Designation:</strong> {a.designation}</span>}
                      <span className="detail-item"><strong className="detail-label">Email:</strong> {a.email}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="hr-stats-grid">
        {stats.map((stat) => (
          <div key={stat.title} className={`stat-card stat-card-${stat.color}`}>
            <div className="stat-content">
              <p className="stat-label">{stat.title}</p>
              <h3 className="stat-value">{stat.value}</h3>
              <p className="stat-sub">{stat.subtitle}</p>
            </div>
            <div className={`stat-icon-bg stat-icon-${stat.color}`}>
              <stat.icon size={24} />
            </div>
          </div>
        ))}

        <div className="stat-card stat-card-updates clickable" onClick={() => setView('updates')}>
          <div className="stat-content">
            <p className="stat-label">Updates</p>
            <h3 className="stat-value">{visibleUpdateOptions.length}</h3>
            <p className="stat-sub">Click to manage</p>
          </div>
          <div className="stat-icon-bg stat-icon-updates">
            <RefreshCw size={24} />
          </div>
        </div>
      </div>




<div className={`hr-search-card ${showSearchResults ? 'hr-search-card--results' : ''}`}>
        {!showSearchResults ? (
          <div className="search-section-inner">
            <h3 className="section-title">Search Employees</h3>
            <div className="search-controls">
              <div className="input-group">
                <label>Circle</label>
                <select value={selectedCircle} onChange={(e) => setSelectedCircle(e.target.value)}>
                  <option value="">Choose Your Circle</option>
                  {masterOptions.circles.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="input-group">
                <label>Employee Type</label>
                <select value={selectedEmployeeType} onChange={(e) => setSelectedEmployeeType(e.target.value)}>
                  <option value="">Select Employee Type</option>
                  {masterOptions.departments.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div className="search-btn-wrapper">
                <button className="btn-search" onClick={handleSearch} disabled={searchLoading || masterLoading}>
                  <i className="search-icon"></i> {searchLoading || masterLoading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="results-container">
            <div className="results-header">
               <h3>Results for {selectedCircle} ({selectedEmployeeType})</h3>
            </div>
            <div className="table-outer-wrapper">
              <div className="table-responsive">
                <table className="results-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Circle</th>
                      <th>Type</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {searchResults.map((emp) => {
                      const employeeKey = emp.id ?? emp.email;
                      return (
                      <tr key={employeeKey}>
                        <td>{emp.name}</td>
                        <td>{emp.email}</td>
                        <td>{emp.circle}</td>
                        <td>{emp.type}</td>
                        <td>
                          <div className="dropdown-container" ref={openDropdownKey === employeeKey ? dropdownRef : null}>
                            <button className={`btn-update-toggle ${openDropdownKey === employeeKey ? 'active' : ''}`} onClick={() => toggleDropdown(employeeKey)}>
                              Update <ChevronDown size={14} className={openDropdownKey === employeeKey ? 'rotate-180' : ''} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )})}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="results-actions">
              <button type="button" className="btn-outline" onClick={(e) => { e.stopPropagation(); handleBackToSearch(); }}>Back to Search</button>
              <input type="month" value={searchDownloadMonth} onChange={(e) => setSearchDownloadMonth(e.target.value)} style={{ marginRight: 8 }} />
              <button type="button" className="btn-success" onClick={(e) => { e.stopPropagation(); handleDownloadAllFromSearch(); }} disabled={searchDownloading}>
                <Download size={16}/> {searchDownloading ? 'Downloading...' : 'Download Attendance'}
              </button>
              <button
                type="button"
                className="btn-success"
                onClick={(e) => { e.stopPropagation(); handleDownloadClientAllFromSearch(); }}
                disabled={searchClientDownloading}
              >
                <Download size={16}/> {searchClientDownloading ? 'Downloading...' : 'For Client'}
              </button>
            </div>
          </div>
        )}
      </div>
      {showSearchResults && openDropdownKey !== null && dropdownPosition && createPortal(
        <div
          className="dropdown-menu-list dropdown-menu-list--fixed"
          style={{
            position: 'fixed',
            top: dropdownPosition.top,
            left: dropdownPosition.left,
            width: 200,
            minWidth: 160,
            zIndex: 99999,
          }}
        >
          {employeeDetailsOptions.map((option) => (
            <div
              key={option}
              className="dropdown-item"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOptionClick(option, dropdownEmployeeRef.current); } }}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleOptionClick(option, dropdownEmployeeRef.current); }}
            >
              {option}
            </div>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}

