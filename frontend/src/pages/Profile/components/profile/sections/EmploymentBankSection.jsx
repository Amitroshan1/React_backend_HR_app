import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import {AccordionCard} from '../AccordionCard';
import {Input} from '../../common/Input';
import {SelectInput} from '../../common/SelectInput';
import {Info} from '../../common/Info';
import {PreviousEmploymentCard} from './PreviousEmploymentCard';
import {
    formatDateForDisplay,
    hasAdminEmploymentContext,
    shouldShowReportingManager,
} from '../../../utils/profileUtils';

export const EmploymentBankSection = ({ 
    data,
    prevEmpData,
    mode,
    isExpanded,
    onToggle,
    onFormChange,
    onPrevEmpChange,
    onAddPrevEmp,
    onRemovePrevEmp,
    onSave,        // ✅ NEW
    onUndo,        // ✅ NEW
    errors 
}) => {
    const isEditMode = mode === 'edit';
    const showReportingManager = shouldShowReportingManager(data);
    const hasOrgAssignment = hasAdminEmploymentContext(data);

    /* =========================
       CURRENT EMPLOYMENT
    ========================= */
    const primaryContent = isEditMode ? (
        <>
            <h4 className="employment-section-title"><span style={GRADIENT_HEADER_STYLE}>Current Employment Details</span></h4>
            <div className="grid-3">
                <Info label="Designation" value={data.designation || '—'} />
                {!data.designation || data.designation === 'Not Specified' ? (
                    <p className="employment-admin-hint" style={{ gridColumn: '1 / -1' }}>
                        Designation is assigned by HR during signup. Contact HR if it is missing or incorrect.
                    </p>
                ) : null}
                <Info label="Employee ID" value={data.employeeId || '—'} />
                <Info label="Circle / Department" value={data.department || '—'} />
                <Info
                    label="Date of Joining"
                    value={data.dateOfJoining ? formatDateForDisplay(data.dateOfJoining) : '—'}
                />
                <Info label="Employment type" value={data.employmentType || '—'} />
                {showReportingManager && (
                    <Info label="Reporting manager" value={data.reportingManager} />
                )}
            </div>
            {!hasOrgAssignment && (
                <p className="employment-admin-hint">
                    Reporting manager will appear here after HR assigns your employment type and circle.
                </p>
            )}
            {hasOrgAssignment && !showReportingManager && (
                <p className="employment-admin-hint">
                    Reporting manager is not mapped yet for your circle and role. Contact HR if you need an update.
                </p>
            )}
        </>
    ) : (
        <>
            <h4 className="employment-section-title"><span style={GRADIENT_HEADER_STYLE}>Current Employment Details</span></h4>
            <div className="grid-3">
                <Info label="Designation" value={data.designation} />
                <Info label="Employee ID" value={data.employeeId} />
                <Info label="Circle / Department" value={data.department} />
                <Info label="Date of Joining" value={formatDateForDisplay(data.dateOfJoining)} />
                <Info label="Employment type" value={data.employmentType} />
                {showReportingManager && (
                    <Info label="Reporting manager" value={data.reportingManager} />
                )}
            </div>
        </>
    );

    /* =========================
       PREVIOUS EMPLOYMENT
    ========================= */
    const historyContent = (
        <div className="section-divider">
            <h3 className="employment-section-title"><span style={GRADIENT_HEADER_STYLE}>Previous Employment History</span></h3>

            {prevEmpData.map((emp, index) => (
                <PreviousEmploymentCard 
                    key={index} 
                    index={index}
                    employmentData={emp}
                    onChange={onPrevEmpChange}
                    onRemove={onRemovePrevEmp}
                    errors={errors}
                />
            ))}

            {isEditMode && (
                <button 
                    type="button"
                    onClick={onAddPrevEmp}
                    className="add-section"
                >
                    + Add Previous Employer
                </button>
            )}
        </div>
    );

    /* =========================
       VALIDATION
    ========================= */
    const mandatoryKeys = [];
    const hasMandatoryErrors =
        isEditMode && mandatoryKeys.some(key => errors[key]);

    return (
        <AccordionCard
            title="Employment History"
            subText="Your current job details, payroll information, and previous work experience."
            sectionName="employment"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasMandatoryErrors}
        >
            {primaryContent}
            {historyContent}

            {/* SAVE + UNDO */}
            {isEditMode && (
                <div className="section-actions">
                    <button
                        type="button"
                        onClick={onUndo}
                        className="entry-undo-btn"
                    >
                        Undo
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        className="entry-save-btn"
                    >
                        Save Employment Details
                    </button>
                </div>
            )}
        </AccordionCard>
    );
}
