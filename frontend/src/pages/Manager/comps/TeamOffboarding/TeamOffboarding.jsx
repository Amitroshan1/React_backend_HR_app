import { useState } from 'react';
import { useRefreshOnNavigate } from '../../../../hooks/useRefreshOnNavigate';
import { fetchTeamOffboarding } from '../../api';
import { formatDateDDMMYYYY } from '../../../../utils/dateFormat';
import './TeamOffboarding.css';

const statusClass = (status) => {
  const map = {
    initiated: 'team-ob-status--initiated',
    notice: 'team-ob-status--notice',
    clearance: 'team-ob-status--clearance',
    ready: 'team-ob-status--ready',
  };
  return map[status] || '';
};

export const TeamOffboarding = () => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useRefreshOnNavigate(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError('');
        const rows = await fetchTeamOffboarding();
        setMembers(rows);
      } catch (e) {
        setError(e.message || 'Unable to load team offboarding');
        setMembers([]);
      } finally {
        setLoading(false);
      }
    };
    load();
  });

  if (loading) return <p className="team-ob-muted">Loading team separations…</p>;
  if (error) return <p className="team-ob-error">{error}</p>;
  if (!members.length) {
    return <p className="team-ob-muted">No direct reports are currently in the separation pipeline.</p>;
  }

  return (
    <div className="team-ob-panel">
      <p className="team-ob-intro">
        Team members with an active resignation or clearance in progress.
      </p>
      <div className="team-ob-table-wrap">
        <table className="team-ob-table">
          <thead>
            <tr>
              <th>Employee</th>
              <th>Status</th>
              <th>Resignation</th>
              <th>NOC</th>
              <th>Notice end</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.admin_id}>
                <td>
                  <strong>{m.name}</strong>
                  <span className="team-ob-sub">{m.emp_id} · {m.email}</span>
                </td>
                <td>
                  <span className={`team-ob-status ${statusClass(m.status)}`}>
                    {m.status_label}
                  </span>
                </td>
                <td>{formatDateDDMMYYYY(m.resignation_date)}</td>
                <td>
                  {m.noc_summary?.total > 0
                    ? `${m.noc_summary.cleared}/${m.noc_summary.total}`
                    : '—'}
                </td>
                <td>{formatDateDDMMYYYY(m.notice_end_date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
