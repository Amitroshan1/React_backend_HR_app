import React, { useState, useCallback, useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { UserAvatar } from '../../components/UserAvatar';
import { useRefreshOnNavigate } from '../../hooks/useRefreshOnNavigate';
import { AdminBreadcrumb, commandCenterCrumbItem } from '../../components/layout/AdminBreadcrumb';
import './EmployeeDetails.css';
import { formatDate, formatDateTimeDDMMYYYY } from '../../utils/dateFormat';

const ADMIN_EMPLOYEE_DETAIL_API = '/api/admin/employees';
const ADMIN_QUERY_API = '/api/admin/queries';

const SECTIONS = ['Leaves', 'Punches', 'Payslips', 'Assets', 'Claims', 'Queries', 'Resignation'];
const STATUSES = ['All', 'Pending', 'Approved', 'Rejected'];
const PAYSLIP_INITIAL = 5;
const PAYSLIP_PAGE = 10;

const PROFILE_FIELDS = [
  { key: 'emp_id', label: 'Employee ID', fallbackKey: 'id' },
  { key: 'email', label: 'Email' },
  { key: 'designation', label: 'Role', fallbackKey: 'emp_type' },
  { key: 'phone', label: 'Phone' },
  { key: 'gender', label: 'Gender' },
  { key: 'dob', label: 'Date of birth', format: 'date' },
  { key: 'address', label: 'Address' },
  { key: 'circle', label: 'Circle' },
];

function displayPunchDate(item) {
  const raw = item?.date || item?.startDate || '';
  if (!raw) return '—';
  const formatted = formatDate(raw, '');
  return formatted || raw;
}

function displayPunchTime(value) {
  if (value == null || value === '') return '—';
  return value;
}

function punchDayLabel(item) {
  if (item.on_leave) {
    return item.leave_type ? `Leave (${item.leave_type})` : 'Leave';
  }
  if (item.is_wfh) return 'WFH';
  return '—';
}

function displayPayslipDate(item) {
  const raw = item?.date || item?.startDate || '';
  if (!raw) return '—';
  const formatted = formatDate(raw, '');
  return formatted || raw;
}

const EmployeeDetails = () => {
  const { id } = useParams();
  const [activeSection, setActiveSection] = useState('Leaves');
  const [activeStatus, setActiveStatus] = useState('All');
  const [employee, setEmployee] = useState(null);
  const [punchPreview, setPunchPreview] = useState([]);
  const [punchesLoading, setPunchesLoading] = useState(false);
  const [payslipLimit, setPayslipLimit] = useState(PAYSLIP_INITIAL);
  const [queryModalOpen, setQueryModalOpen] = useState(false);
  const [queryDetailLoading, setQueryDetailLoading] = useState(false);
  const [queryDetail, setQueryDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadEmployee = useCallback(() => {
    const token = localStorage.getItem('token');
    if (!id || !token) {
      setLoading(false);
      setError(true);
      return;
    }
    setLoading(true);
    setError(false);
    fetch(`${ADMIN_EMPLOYEE_DETAIL_API}/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success && data.employee) {
          setEmployee(data.employee);
          setPayslipLimit(PAYSLIP_INITIAL);
        } else {
          setError(true);
        }
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [id]);

  useRefreshOnNavigate(loadEmployee, [id]);

  useEffect(() => {
    if (activeSection !== 'Punches' || !id) return undefined;
    const token = localStorage.getItem('token');
    if (!token) return undefined;

    let cancelled = false;
    setPunchesLoading(true);
    fetch(`${ADMIN_EMPLOYEE_DETAIL_API}/${id}/punches?days=5`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data.success && Array.isArray(data.punches)) {
          setPunchPreview(data.punches);
        } else {
          setPunchPreview([]);
        }
        setPunchesLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setPunchPreview([]);
          setPunchesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSection, id]);

  useEffect(() => {
    if (activeSection === 'Payslips') {
      setPayslipLimit(PAYSLIP_INITIAL);
    }
  }, [activeSection, id]);

  const openQueryChat = (queryId) => {
    const token = localStorage.getItem('token');
    if (!token) return;
    setQueryModalOpen(true);
    setQueryDetailLoading(true);
    setQueryDetail(null);
    fetch(`${ADMIN_QUERY_API}/${queryId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json().catch(() => ({})))
      .then((data) => {
        if (data.success) {
          setQueryDetail({ query: data.query, chat_messages: data.chat_messages || [] });
        } else {
          setQueryDetail(null);
        }
        setQueryDetailLoading(false);
      })
      .catch(() => {
        setQueryDetail(null);
        setQueryDetailLoading(false);
      });
  };

  if (loading) {
    return (
      <div className="emp-detail">
        <div className="emp-detail__empty">
          <p>Loading employee…</p>
        </div>
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="emp-detail">
        <AdminBreadcrumb
          items={[
            commandCenterCrumbItem(),
            { label: 'Employees', to: '/employees' },
            { label: 'Not found' },
          ]}
        />
        <div className="emp-detail__empty">
          <h2>Employee not found</h2>
        </div>
      </div>
    );
  }

  const allPayslips = employee.payslips || [];
  const visiblePayslips = allPayslips.slice(0, payslipLimit);
  const hasMorePayslips = payslipLimit < allPayslips.length;

  const getActiveData = () => {
    let data = [];
    switch (activeSection) {
      case 'Leaves':
        data = employee.leaves || [];
        break;
      case 'Punches':
        return punchPreview;
      case 'Payslips':
        return visiblePayslips;
      case 'Assets':
        return employee.assets || [];
      case 'Claims':
        data = employee.claims || [];
        break;
      case 'Queries':
        return employee.queries || [];
      case 'Resignation':
        data = employee.resignations || [];
        break;
      default:
        data = [];
    }

    if (activeStatus !== 'All') {
      data = data.filter((item) => (item.status || '').toLowerCase() === activeStatus.toLowerCase());
    }

    return data;
  };

  const activeData = getActiveData();
  const isPunches = activeSection === 'Punches';
  const isPayslips = activeSection === 'Payslips';
  const isAssets = activeSection === 'Assets';
  const isQueries = activeSection === 'Queries';
  const hideStatusFilters = isPunches || isPayslips || isAssets || isQueries;
  const now = new Date();
  const punchesMorePath = `/employee/${id}/punches?month=${now.getMonth() + 1}&year=${now.getFullYear()}`;

  const fieldValue = (field) => {
    let raw = employee[field.key];
    if ((raw == null || raw === '') && field.fallbackKey) {
      raw = employee[field.fallbackKey];
    }
    if (field.format === 'date') return formatDate(raw) || '—';
    return raw || '—';
  };

  return (
    <div className="emp-detail">
      <AdminBreadcrumb
        items={[
          commandCenterCrumbItem(),
          { label: 'Employees', to: '/employees' },
          {
            label: `${employee.name}${employee.emp_id ? ` · ${employee.emp_id}` : ''}`,
          },
        ]}
      />

      <section className="emp-detail__profile" aria-label="Employee profile">
        <div className="emp-detail__avatar-wrap">
          <UserAvatar
            user={employee}
            name={employee.name}
            alt={employee.name}
            className="emp-detail__avatar"
          />
          <h2>{employee.name}</h2>
          {(employee.designation || employee.emp_type) ? (
            <span className="emp-detail__badge">{employee.designation || employee.emp_type}</span>
          ) : null}
        </div>

        <dl className="emp-detail__meta">
          {PROFILE_FIELDS.map((field) => (
            <div key={field.key} className="emp-detail__meta-row">
              <dt>{field.label}</dt>
              <dd title={String(fieldValue(field))}>{fieldValue(field)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="emp-detail__tabs" role="tablist" aria-label="Record sections">
        {SECTIONS.map((section) => (
          <button
            key={section}
            type="button"
            role="tab"
            aria-selected={activeSection === section}
            className={`emp-detail__tab${activeSection === section ? ' is-active' : ''}`}
            onClick={() => setActiveSection(section)}
          >
            {section}
          </button>
        ))}
      </div>

      {!hideStatusFilters ? (
        <div className="emp-detail__status-row" role="group" aria-label="Status filter">
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`emp-detail__chip${activeStatus === status ? ' is-active' : ''}`}
              onClick={() => setActiveStatus(status)}
            >
              {status}
            </button>
          ))}
        </div>
      ) : isPunches ? (
        <p className="emp-detail__section-hint">Last 5 days</p>
      ) : isPayslips ? (
        <p className="emp-detail__section-hint">
          Latest payslips
          {allPayslips.length > 0 ? ` · showing ${visiblePayslips.length} of ${allPayslips.length}` : ''}
        </p>
      ) : isQueries ? (
        <p className="emp-detail__section-hint">Latest 5 queries</p>
      ) : isAssets ? (
        <p className="emp-detail__section-hint">Assigned assets</p>
      ) : null}

      <div className="emp-detail__table-card">
        {isPunches && punchesLoading ? (
          <div className="emp-detail__empty emp-detail__empty--inset">
            <p>Loading punches…</p>
          </div>
        ) : activeData.length > 0 ? (
          <div className="emp-detail__table-wrap">
            {isPunches ? (
              <table className="emp-detail__table emp-detail__table--punches">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Punch in</th>
                    <th>Punch out</th>
                    <th>Day status</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((item) => (
                    <tr key={item.id}>
                      <td>{displayPunchDate(item)}</td>
                      <td>{displayPunchTime(item.punch_in)}</td>
                      <td>{displayPunchTime(item.punch_out)}</td>
                      <td>
                        {item.on_leave || item.is_wfh ? (
                          <span
                            className={`emp-detail__day-tag${
                              item.on_leave ? ' emp-detail__day-tag--leave' : ' emp-detail__day-tag--wfh'
                            }`}
                          >
                            {punchDayLabel(item)}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : isPayslips ? (
              <table className="emp-detail__table emp-detail__table--punches">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Month</th>
                    <th>Year</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((item) => (
                    <tr key={item.id}>
                      <td>{displayPayslipDate(item)}</td>
                      <td>{item.month || '—'}</td>
                      <td>{item.year || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : isAssets ? (
              <table className="emp-detail__table emp-detail__table--punches">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Category</th>
                    <th>Tag / serial</th>
                    <th>Status</th>
                    <th>Assigned</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.name || '—'}
                        {item.quantity != null ? ` ×${item.quantity}` : ''}
                      </td>
                      <td>{item.category || '—'}</td>
                      <td>{item.assetTag || item.serialNumber || '—'}</td>
                      <td>
                        <span className={`emp-detail__status ${(item.status || '').toLowerCase()}`}>
                          {item.status || '—'}
                        </span>
                      </td>
                      <td>{item.assignedDate ? formatDate(item.assignedDate) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : isQueries ? (
              <table className="emp-detail__table emp-detail__table--punches">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Department</th>
                    <th>Status</th>
                    <th>Raised on</th>
                    <th>Chat</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((item) => (
                    <tr key={item.id}>
                      <td title={item.title}>{item.title || '—'}</td>
                      <td>{item.department || '—'}</td>
                      <td>
                        <span className={`emp-detail__status ${(item.status || '').toLowerCase()}`}>
                          {item.status || '—'}
                        </span>
                      </td>
                      <td>{item.created_at ? formatDateTimeDDMMYYYY(item.created_at) : '—'}</td>
                      <td>
                        <button
                          type="button"
                          className="emp-detail__chat-btn"
                          onClick={() => openQueryChat(item.id)}
                        >
                          View chat
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <table className="emp-detail__table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Start date</th>
                    <th>End date</th>
                  </tr>
                </thead>
                <tbody>
                  {activeData.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.type || '—'}</td>
                      <td>
                        <span className={`emp-detail__status ${(item.status || '').toLowerCase()}`}>
                          {item.status || '—'}
                        </span>
                      </td>
                      <td>{item.startDate || '—'}</td>
                      <td>{item.endDate || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <div className="emp-detail__empty emp-detail__empty--inset">
            <p>
              {isPunches
                ? 'No punch records for the last 5 days.'
                : isPayslips
                  ? 'No payslips uploaded or generated for this employee.'
                  : isAssets
                    ? 'No assets assigned to this employee.'
                    : isQueries
                      ? 'No queries raised by this employee.'
                      : `No ${activeSection.toLowerCase()} records found${
                          activeStatus === 'All' ? '' : ` for ${activeStatus.toLowerCase()} status`
                        }.`}
            </p>
          </div>
        )}

        {isPunches ? (
          <div className="emp-detail__more">
            <Link to={punchesMorePath} className="emp-detail__more-link">
              View more
            </Link>
          </div>
        ) : null}

        {isPayslips && hasMorePayslips ? (
          <div className="emp-detail__more">
            <button
              type="button"
              className="emp-detail__more-link emp-detail__more-btn"
              onClick={() => setPayslipLimit((n) => n + PAYSLIP_PAGE)}
            >
              View more
            </button>
          </div>
        ) : null}
      </div>

      {queryModalOpen ? (
        <div
          className="emp-detail__modal-overlay"
          onClick={() => setQueryModalOpen(false)}
          role="presentation"
        >
          <div
            className="emp-detail__modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Query conversation"
          >
            <div className="emp-detail__modal-header">
              <h2>Query chat</h2>
              <button
                type="button"
                className="emp-detail__modal-close"
                onClick={() => setQueryModalOpen(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="emp-detail__modal-body">
              {queryDetailLoading ? (
                <p className="emp-detail__muted">Loading conversation…</p>
              ) : queryDetail ? (
                <>
                  <div className="emp-detail__query-meta">
                    <p><strong>Title:</strong> {queryDetail.query.title || '—'}</p>
                    <p><strong>Department:</strong> {queryDetail.query.department || '—'}</p>
                    <p>
                      <strong>Status:</strong>{' '}
                      <span className={`emp-detail__status ${(queryDetail.query.status || '').toLowerCase()}`}>
                        {queryDetail.query.status || '—'}
                      </span>
                    </p>
                    <p>
                      <strong>Created:</strong>{' '}
                      {formatDateTimeDDMMYYYY(queryDetail.query.created_at)}
                    </p>
                  </div>
                  <div className="emp-detail__chat">
                    <h3>Conversation</h3>
                    {queryDetail.chat_messages.length === 0 ? (
                      <p className="emp-detail__muted">No messages yet.</p>
                    ) : (
                      queryDetail.chat_messages.map((msg, idx) => (
                        <div
                          key={`${msg.created_at}-${idx}`}
                          className={`emp-detail__msg emp-detail__msg--${(msg.user_type || 'other').toLowerCase()}`}
                        >
                          <div className="emp-detail__msg-meta">
                            {msg.by || '—'} · {msg.user_type || '—'} · {formatDateTimeDDMMYYYY(msg.created_at)}
                          </div>
                          <div className="emp-detail__msg-text">{msg.text}</div>
                        </div>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <p className="emp-detail__muted">Failed to load query conversation.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default EmployeeDetails;
