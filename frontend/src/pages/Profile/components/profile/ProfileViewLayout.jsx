import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';
import { Info } from '../common/Info';
import { ProgressCircle } from '../common/ProgressCircle';
import { ProfileSectionHints } from '../common/ProfileSectionHints';
import { ProfileSummaryCard } from './ProfileSummaryCard';
import { formatDateForDisplay, shouldShowReportingManager } from '../../utils/profileUtils';
import { DOCUMENT_LABELS, documentPreviewUrl } from '../../utils/profileApi';

const formatAddressBlock = (addr) => {
    if (!addr) return '—';
    const parts = [
        addr.street,
        [addr.city, addr.district].filter(Boolean).join(', '),
        addr.state,
        addr.pincode ? `PIN ${addr.pincode}` : '',
    ].filter((p) => p && String(p).trim());
    return parts.length ? parts.join('\n') : '—';
};

const ViewSection = ({ id, title, modifier, children }) => (
    <section id={id} className={`profile-view-card profile-view-card--${modifier}`}>
        <h4>
            <span style={GRADIENT_HEADER_STYLE}>{title}</span>
        </h4>
        {children}
    </section>
);

const InfoGrid = ({ items }) => (
    <div className="grid-3 profile-view-grid">
        {items.map(({ label, value, key }) => (
            <Info key={key || label} label={label} value={value || '—'} />
        ))}
    </div>
);

export const ProfileViewLayout = ({
    data,
    profileProgress,
    sectionCompletion,
    avatarUrl,
    onImageChange,
    onEditToggle,
    onGoToSection,
}) => {
    const sections = sectionCompletion?.sections || [];
    const { formData, currentAddress, permanentAddress, previousEmployment, educationDetails, files } =
        data;

    const personalItems = [
        { label: 'Full name', value: formData.fullName, key: 'fullName' },
        { label: "Father's name", value: formData.fatherName, key: 'father' },
        { label: "Mother's name", value: formData.motherName, key: 'mother' },
        { label: 'Date of birth', value: formatDateForDisplay(formData.dateOfBirth), key: 'dob' },
        { label: 'Gender', value: formData.gender, key: 'gender' },
        { label: 'Marital status', value: formData.maritalStatus, key: 'marital' },
        { label: 'Blood group', value: formData.bloodGroup, key: 'blood' },
        { label: 'Nationality', value: formData.nationality, key: 'nat' },
        { label: 'Personal email', value: formData.personalEmail, key: 'email' },
        {
            label: 'Mobile',
            value: formData.mobileCountryCode
                ? `${formData.mobileCountryCode} ${formData.mobile}`
                : formData.mobile,
            key: 'mobile',
        },
        {
            label: 'Emergency contact',
            value: formData.emergencyCountryCode
                ? `${formData.emergencyCountryCode} ${formData.emergency}`
                : formData.emergency,
            key: 'emergency',
        },
    ];

    const employmentItems = [
        { label: 'Employee ID', value: formData.employeeId, key: 'empId' },
        { label: 'Circle / Department', value: formData.department, key: 'dept' },
        { label: 'Designation', value: formData.designation, key: 'desig' },
        { label: 'Employment type', value: formData.employmentType, key: 'type' },
        {
            label: 'Date of joining',
            value: formatDateForDisplay(formData.dateOfJoining),
            key: 'doj',
        },
        ...(shouldShowReportingManager(formData)
            ? [{ label: 'Reporting manager', value: formData.reportingManager, key: 'rm' }]
            : []),
    ];

    const filledEducation = (educationDetails || []).filter(
        (e) => e.qualification || e.institution || e.university
    );

    return (
        <div className="profile-v2">
            <div className="profile-view-wrapper profile-v2-body">
                <aside className="profile-view-left">
                    <ProfileSummaryCard
                        formData={formData}
                        currentAddress={currentAddress}
                        avatarUrl={avatarUrl}
                        onImageChange={onImageChange}
                        onEdit={onEditToggle}
                        showEditButton
                    />
                    <ProgressCircle progressValue={profileProgress} sections={sections} />
                    <ProfileSectionHints
                        sections={sections}
                        totalPercent={profileProgress}
                        onSectionClick={onGoToSection}
                    />
                </aside>

                <div className="profile-view-right profile-v2-sections">
                    <ViewSection id="profile-personal" title="Personal information" modifier="personal">
                        <InfoGrid items={personalItems} />
                    </ViewSection>

                    <ViewSection id="profile-address" title="Address" modifier="address">
                        <div className="grid-2 profile-address-view">
                            <div className="profile-address-block">
                                <h5>Current address</h5>
                                <pre className="profile-address-text">
                                    {formatAddressBlock(currentAddress)}
                                </pre>
                            </div>
                            <div className="profile-address-block">
                                <h5>Permanent address</h5>
                                <pre className="profile-address-text">
                                    {formatAddressBlock(permanentAddress)}
                                </pre>
                            </div>
                        </div>
                    </ViewSection>

                    <ViewSection
                        id="profile-employment"
                        title="Current employment"
                        modifier="employment"
                    >
                        <InfoGrid items={employmentItems} />
                    </ViewSection>

                    {(previousEmployment || []).length > 0 && (
                        <ViewSection
                            id="profile-previous"
                            title="Previous employment"
                            modifier="previous"
                        >
                            <div className="profile-table-wrap">
                                <table className="profile-data-table">
                                    <thead>
                                        <tr>
                                            <th>Company</th>
                                            <th>Designation</th>
                                            <th>Left on</th>
                                            <th>Experience (yrs)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {previousEmployment.map((row, i) => (
                                            <tr key={i}>
                                                <td>{row.companyName || '—'}</td>
                                                <td>{row.designation || '—'}</td>
                                                <td>
                                                    {formatDateForDisplay(row.dateOfLeaving) || '—'}
                                                </td>
                                                <td>{row.experienceYears || '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </ViewSection>
                    )}

                    <ViewSection id="profile-education" title="Education" modifier="education">
                        {filledEducation.length === 0 ? (
                            <p className="profile-empty-hint">No education records yet.</p>
                        ) : (
                            <div className="profile-table-wrap">
                                <table className="profile-data-table">
                                    <thead>
                                        <tr>
                                            <th>Qualification</th>
                                            <th>Institution</th>
                                            <th>Board / University</th>
                                            <th>Period</th>
                                            <th>Marks</th>
                                            <th>Certificate</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filledEducation.map((row) => (
                                            <tr key={row.id}>
                                                <td>{row.qualification || '—'}</td>
                                                <td>{row.institution || '—'}</td>
                                                <td>{row.university || '—'}</td>
                                                <td>
                                                    {formatDateForDisplay(row.fromDate)} –{' '}
                                                    {formatDateForDisplay(row.toDate)}
                                                </td>
                                                <td>{row.marks || '—'}</td>
                                                <td>
                                                    {row.certificate ? (
                                                        <a
                                                            href={documentPreviewUrl(row.certificate)}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="profile-doc-link"
                                                        >
                                                            View
                                                        </a>
                                                    ) : (
                                                        '—'
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </ViewSection>

                    <ViewSection id="profile-documents" title="Documents" modifier="documents">
                        <ul className="profile-doc-list">
                            {Object.entries(DOCUMENT_LABELS).map(([key, label]) => {
                                const path = files?.[key];
                                const url = documentPreviewUrl(path);
                                return (
                                    <li key={key} className="profile-doc-list-item">
                                        <span className="profile-doc-list-label">{label}</span>
                                        {url ? (
                                            <a
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="profile-doc-link"
                                            >
                                                Uploaded — open
                                            </a>
                                        ) : (
                                            <span className="profile-doc-missing">Not uploaded</span>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    </ViewSection>
                </div>
            </div>
        </div>
    );
};
