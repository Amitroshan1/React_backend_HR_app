
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { 
  Users, UserPlus, UserCheck, Cake, RefreshCw, 
  UserCog, Newspaper, FileText, MapPin, Building, 
  FileCheck, Search, ArrowLeft, Download, ChevronDown, Key, Clock 
} from 'lucide-react';
import './Hr.css';
import './SignUp.css'; 
import { UpdateSignUp } from './UpdateSignUp';
import { AddNewsFeed } from './AddNewsFeed';
import { UpdateLeave } from './UpdateLeave';
import { UpdateManager } from './UpdateManager';
import { AddAssets } from './AddAssets';
import { AddLocation } from './AddLocation';
import { AddNoc } from './AddNoc';
import ExitEmployee from './ExitEmployee';
import AddDeptCircle from './AddDeptCircle';
import { LeaveAccrualSummary } from './LeaveAccrualSummary';
import { HolidayCalendar } from './HolidayCalendar';

const HR_API_BASE = '/api/HumanResource';

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
                  <th>Location Status</th>
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
                    <td>{row.location_status || '–'}</td>
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

// ----- HR Punch In/Out form (from Search Employee → Punch In/Out) -----
function HrPunchFormView({ employee, onBack }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [punchIn, setPunchIn] = useState('09:00');
  const [punchOut, setPunchOut] = useState('18:00');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setMessage({ type: '', text: '' });
    try {
      const res = await fetch(`${HR_API_BASE}/employee/punch/${employee.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ date, punch_in: punchIn || null, punch_out: punchOut || null }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setMessage({ type: 'success', text: 'Punch updated successfully.' });
      } else {
        setMessage({ type: 'error', text: data.message || 'Failed to update punch' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSubmitting(false);
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
                  value={punchIn}
                  onChange={(e) => setPunchIn(e.target.value)}
                />
              </div>
              <div className="hr-punch-form__field">
                <label className="hr-punch-form__label" htmlFor="hr-punch-out">Punch Out</label>
                <input
                  id="hr-punch-out"
                  type="time"
                  className="hr-punch-form__input hr-punch-form__input--time"
                  value={punchOut}
                  onChange={(e) => setPunchOut(e.target.value)}
                />
              </div>
            </div>
            {message.text && (
              <div className={`hr-punch-form__message hr-punch-form__message--${message.type}`} role="alert">
                {message.text}
              </div>
            )}
            <button type="submit" className="hr-punch-form__submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save Punch'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export const Hr = () => {
  const navigate = useNavigate();
  const location = useLocation();
  
  const [view, setView] = useState('main');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedCircle, setSelectedCircle] = useState('');
  const [selectedEmployeeType, setSelectedEmployeeType] = useState('');
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const dropdownRef = useRef(null);

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

  const [resetPasswordEmail, setResetPasswordEmail] = useState('');
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [resetPasswordMessage, setResetPasswordMessage] = useState('');
  const [resetPasswordError, setResetPasswordError] = useState('');

  const openSignupForEdit = (employeeData) => {
    setSignupForm({
      user_name: employeeData.user_name || '',
      first_name: employeeData.first_name || '',
      email: employeeData.email || '',
      emp_id: employeeData.emp_id || '',
      mobile: employeeData.mobile || '',
      doj: (employeeData.doj || '').slice(0, 10),
      emp_type: employeeData.emp_type || '',
      circle: employeeData.circle || '',
      password: '',
      confirmPassword: ''
    });
    setSignupEditEmail(employeeData.email || null);
    setSignupSuccess(false);
    setSignupError('');
    setView('signup');
  };

  const handleSignupChange = (e) => {
    const { name, value } = e.target;
    setSignupForm(prev => ({ ...prev, [name]: value }));
    setSignupError('');
  };

  const handleSignupSubmit = async (e) => {
    e.preventDefault();
    setSignupError('');
    const { user_name, first_name, email, emp_id, mobile, doj, emp_type, circle, password, confirmPassword } = signupForm;
    if (!user_name?.trim() || !first_name?.trim() || !email?.trim() || !emp_id?.trim() || !mobile?.trim() || !doj || !emp_type || !circle) {
      setSignupError('Please fill in all required fields (UserName, Full Name, Email, Employee ID, Mobile, DOJ, Employee Type, Circle).');
      return;
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
        // Update existing employee
        const res = await fetch(
          `${HR_API_BASE}/employee/by-email/${encodeURIComponent(signupEditEmail)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              user_name: user_name.trim(),
              first_name: first_name.trim(),
              emp_id: emp_id.trim(),
              mobile: mobile.trim().replace(/\s/g, ''),
              doj,
              emp_type,
              circle,
              ...(password?.trim() ? { password: password.trim() } : {})
            })
          }
        );
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
          setSignupSuccess(true);
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

  const employeeDetailsOptions = ['Profile', 'Attendance', 'Punch In/Out'];

  const [selectedEmployeeForAction, setSelectedEmployeeForAction] = useState(null);

  const stats = [
    { title: 'Total Employees', value: String(counts.total_employees), subtitle: 'All active', icon: Users, color: 'blue' },
    { title: 'New Hires', value: String(counts.new_joinees_last_30_days), subtitle: 'Last 30 days', icon: UserPlus, color: 'green' },
    { title: 'Active Today', value: String(counts.today_punch_in_count), subtitle: 'Punched in today', icon: UserCheck, color: 'teal' },
  ];

  const updateOptions = [
    { title: 'Sign Up', icon: UserPlus, description: 'New employee registration' },
    { title: 'Reset Employee Password', icon: Key, description: 'Send password reset link (1 hour)' },
    { title: 'Update_SignUp', icon: UserCog, description: 'Modify signup details' },
    { title: 'News Feed', icon: Newspaper, description: 'Company announcements' },
    { title: 'Update Leave', icon: FileText, description: 'Modify leave records' },
    { title: 'Update Manager', icon: UserCog, description: 'Change manager assignments' },
    { title: 'Add Assets', icon: Building, description: 'Register company assets' },
    { title: 'Add Locations', icon: MapPin, description: 'Add office locations' },
    { title: 'Add NOC', icon: FileCheck, description: 'No Objection Certificate' },
    { title: 'Exit Employee', icon: Users, description: 'Employee Exit Handling' },
    { title: 'Add Department And Circle', icon: MapPin, description: 'Add departments and circles Types' },
    { title: 'Leave Accrual Monitor', icon: FileCheck, description: 'Monitor PL/CL scheduler runs' },
    { title: 'Holiday Calendar', icon: FileText, description: 'View yearly holiday list' },
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
    setOpenDropdownId(null);
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
        setCounts(data.counts || {});
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
      // Don't close dropdown when clicking the results action buttons (Back to Search, Download, month input)
      // so their click handlers can run without being interrupted by a re-render.
      if (event.target.closest?.('.results-actions')) return;
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpenDropdownId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const toggleDropdown = (id) => {
    setOpenDropdownId(openDropdownId === id ? null : id);
  };

  const handleOptionClick = (option, emp) => {
    setOpenDropdownId(null);
    setSelectedEmployeeForAction(emp);
    if (option === 'Profile') setView('employee_profile');
    else if (option === 'Attendance') setView('employee_attendance');
    else if (option === 'Punch In/Out') setView('punch_form');
  };

  const handleUpdateCardClick = (title) => {
    if (title === 'Sign Up') {
      setSignupSuccess(false);
      setSignupError('');
      setSignupEditEmail(null);
      setView('signup');
    } 
    else if (title === 'Update_SignUp') {
      setView('update_signup');
    }
    else if (title === 'News Feed') {
      setView('newsfeed');
    } else if (title === 'Update Leave') {
      setView('update_leave');
    } else if (title === 'Update Manager') {setView('update_manager');
    } else if (title === 'Add Assets') {
    setView('add_assets');
  } else if (title === 'Add Locations') {
    setView('add_location');
  }
  else if (title === 'Add NOC') {
    setView('add_noc');
  }
  else if (title === 'Exit Employee') { //New Condition For Exit Employee
  setView('exit_employee');
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
if (view === 'update_signup') {
    return (
      <UpdateSignUp
        onBack={() => setView('updates')}
        onOpenSignupForEmployee={openSignupForEdit}
        empTypeOptions={masterOptions.departments}
        circleOptions={masterOptions.circles}
      />
    );
  }

  if (view === 'newsfeed') {
  return <AddNewsFeed onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />;
}
if (view === 'update_leave'){
  return <UpdateLeave onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />
}

if (view === 'update_manager') {
  return <UpdateManager onBack={() => setView('updates')} empTypeOptions={masterOptions.departments} circleOptions={masterOptions.circles} />;
}

if (view === 'add_assets') {
  return <AddAssets onBack={() => setView('updates')} />;
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
if (view === 'add_noc') {
return <AddNoc onBack={() => setView('updates')} />;
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
    return (
      <div className="signup-page-container">

        <div className="signup-content-wrapper">
          <button className="btn-back-updates" onClick={() => { setSignupEditEmail(null); setView('updates'); }}>
            <ArrowLeft size={16} /> Back to Updates
          </button>

          <div className="signup-card">
            <div className="card-header">
              <h2>{isEditMode ? 'Update Employee Details' : 'Create New Employee Account'}</h2>
              <p>{isEditMode ? 'Modify details and save to update the employee record.' : 'Fill in the details to register a new employee'}</p>
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
                  <label>UserName <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="user_name" type="text" placeholder="Create Unique UserName" value={signupForm.user_name} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Full Name <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="first_name" type="text" placeholder="Enter your Full Name" value={signupForm.first_name} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Email <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="email" type="email" placeholder="Enter your Email ID" value={signupForm.email} onChange={handleSignupChange} readOnly={isEditMode} disabled={isEditMode} style={isEditMode ? { opacity: 0.9, cursor: 'not-allowed' } : {}} />
                </div>
                <div className="form-group">
                  <label>Employee ID <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="emp_id" type="text" placeholder="Enter your Employee ID" value={signupForm.emp_id} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Mobile Number <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="mobile" type="tel" placeholder="Enter your Mobile Number" value={signupForm.mobile} onChange={handleSignupChange} />
                </div>
                <div className="form-group">
                  <label>Date of Joining <span style={{ color: '#b91c1c' }}>*</span></label>
                  <input name="doj" type="date" value={signupForm.doj} onChange={handleSignupChange} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Employee Type <span style={{ color: '#b91c1c' }}>*</span></label>
                  <select name="emp_type" value={signupForm.emp_type} onChange={handleSignupChange}>
                    <option value="">Select Employee Type</option>
                    {masterOptions.departments.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Circle <span style={{ color: '#b91c1c' }}>*</span></label>
                  <select name="circle" value={signupForm.circle} onChange={handleSignupChange}>
                    <option value="">Choose Your Circle</option>
                    {masterOptions.circles.map((item) => (
                      <option key={item} value={item}>{item}</option>
                    ))}
                  </select>
                </div>
              </div>

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
          {updateOptions.map((option) => (
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
            <h3 className="stat-value">{updateOptions.length}</h3>
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
                    {searchResults.map((emp, i) => (
                      <tr key={i}>
                        <td>{emp.name}</td>
                        <td>{emp.email}</td>
                        <td>{emp.circle}</td>
                        <td>{emp.type}</td>
                        <td>
                          <div className="dropdown-container" ref={openDropdownId === i ? dropdownRef : null}>
                            <button className={`btn-update-toggle ${openDropdownId === i ? 'active' : ''}`} onClick={() => toggleDropdown(i)}>
                              Update <ChevronDown size={14} className={openDropdownId === i ? 'rotate-180' : ''} />
                            </button>
                            {openDropdownId === i && (
                              <div className="dropdown-menu-list">
                                {employeeDetailsOptions.map((option) => (
                                  <div key={option} className="dropdown-item" onClick={() => handleOptionClick(option, emp)}>
                                    {option}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

