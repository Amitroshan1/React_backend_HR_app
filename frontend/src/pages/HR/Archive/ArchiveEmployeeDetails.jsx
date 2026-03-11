import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './Archive.css';

const HR_API_BASE = '/api/HumanResource';

const ArchiveEmployeeDetails = () => {
  const { adminId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [employee, setEmployee] = useState(null);

  const staticBase =
    typeof window !== 'undefined' && window.__BACKEND_STATIC__
      ? window.__BACKEND_STATIC__
      : '';

  const docUrl = (path) => (path ? `${staticBase}/static/uploads/${path}` : null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const res = await fetch(`${HR_API_BASE}/archive/employee/${adminId}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok || !data.success) {
          setError(data.message || 'Failed to load archived employee');
          return;
        }
        setEmployee(data.employee);
      } catch {
        if (!cancelled) setError('Network error while loading archived employee');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminId]);

  const basic = employee?.basic || {};
  const employment = employee?.employment || {};
  const exitInfo = employee?.exit || {};
  const documents = employee?.documents || [];
  const education = employee?.education || [];
  const previous = employee?.previous_employment || [];

  return (
    <div className="archive-container">
      <div className="archive-wrapper">
        <div className="archive-header">
          <button className="btn-back-updates" onClick={() => navigate('/archive-employees')}>
            <ArrowLeft size={20} />
            <span>Back to Archive</span>
          </button>
        </div>

        <div className="title-section">
          <h1 className="page-title">Archived Employee Details</h1>
          <p className="page-subtitle">
            {basic.name || 'Employee'} {employment.emp_id ? `(${employment.emp_id})` : ''}
          </p>
        </div>

        {error && <p className="archive-error">{error}</p>}
        {loading && !error && <p className="archive-error">Loading...</p>}

        {!loading && !error && (
          <div className="archive-details-grid">
            {/* Card 1: Profile */}
            <div className="archive-detail-card">
              <h3>Profile</h3>
              <p><strong>Name:</strong> {basic.name || '—'}</p>
              <p><strong>Email:</strong> {basic.email || '—'}</p>
              <p><strong>Mobile:</strong> {basic.mobile || '—'}</p>
              <p><strong>Username:</strong> {basic.username || '—'}</p>
            </div>

            {/* Card 2: Current Employment & Exit */}
            <div className="archive-detail-card">
              <h3>Employment & Exit</h3>
              <p><strong>Employee ID:</strong> {employment.emp_id || '—'}</p>
              <p><strong>Circle:</strong> {employment.circle || '—'}</p>
              <p><strong>Type:</strong> {employment.emp_type || '—'}</p>
              <p><strong>Date of Joining:</strong> {employment.doj || '—'}</p>
              <hr />
              <p><strong>Exit Date:</strong> {exitInfo.exit_date || '—'}</p>
              <p><strong>Exit Type:</strong> {exitInfo.exit_type || '—'}</p>
              <p><strong>Exit Reason:</strong> {exitInfo.exit_reason || '—'}</p>
            </div>

            {/* Card 3: Previous Company */}
            <div className="archive-detail-card">
              <h3>Previous Company</h3>
              {Array.isArray(previous) && previous.length > 0 ? (
                previous.map((pc, i) => (
                  <div key={i} className="archive-detail-subitem">
                    <p><strong>{pc.companyName || '—'}</strong></p>
                    <p>{pc.designation || '—'}</p>
                    <p>
                      {pc.doj || ''} {pc.dateOfLeaving ? `→ ${pc.dateOfLeaving}` : ''}{' '}
                      {pc.experienceYears ? `(${pc.experienceYears} yrs)` : ''}
                    </p>
                  </div>
                ))
              ) : (
                <p>No previous-company records found.</p>
              )}
            </div>

            {/* Card 4: Documents */}
            <div className="archive-detail-card">
              <h3>Documents</h3>
              {Array.isArray(documents) && documents.length > 0 ? (
                documents.map((d, i) => {
                  const url = docUrl(d.file);
                  const isImage =
                    d.file && /\.(png|jpe?g|gif|webp)$/i.test(d.file || '');

                  return (
                    <div key={i} className="archive-detail-subitem">
                      <p>
                        <strong>{d.doc_type || 'Document'}:</strong>{' '}
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            View file
                          </a>
                        ) : (
                          'Not uploaded'
                        )}
                      </p>

                      {url && isImage && (
                        <img
                          src={url}
                          alt={d.doc_type || 'Document'}
                          style={{
                            maxWidth: '100%',
                            maxHeight: 160,
                            borderRadius: 6,
                            marginTop: 8,
                          }}
                        />
                      )}
                    </div>
                  );
                })
              ) : (
                <p>No documents found.</p>
              )}
            </div>

            {/* Card 5: Education (optional 4th card visible) */}
            <div className="archive-detail-card">
              <h3>Education</h3>
              {Array.isArray(education) && education.length > 0 ? (
                education.map((e, i) => (
                  <div key={i} className="archive-detail-subitem">
                    <p><strong>{e.degree || '—'}</strong> – {e.institute || '—'}</p>
                    <p>Year: {e.year || '—'}</p>
                  </div>
                ))
              ) : (
                <p>No education records found.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ArchiveEmployeeDetails;

