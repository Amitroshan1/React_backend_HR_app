import React from 'react';
import {AccordionCard} from '../AccordionCard';
import {Input} from '../../common/Input';
import {SelectInput} from '../../common/SelectInput';
import {Info} from '../../common/Info';
import {PreviousEmploymentCard} from './PreviousEmploymentCard';
import { designationOptions, formatDateForDisplay } from '../../../utils/profileUtils';

const employmentTypeOptions = ['Full-Time', 'Part-Time', 'Contract', 'Internship'];

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

    /* =========================
       CURRENT EMPLOYMENT
    ========================= */
    const primaryContent = isEditMode ? (
        <>
            <h4>Current Employment Details</h4>
            <div className="grid-3">
                <SelectInput
                    label="Designation"
                    name="designation"
                    value={data.designation}
                    onChange={onFormChange}
                    options={designationOptions}
                    error={errors.designation}
                />
                <Input label="Employee ID" name="employeeId" value={data.employeeId} onChange={onFormChange} error={errors.employeeId} />
                <Input label="Department" name="department" value={data.department} onChange={onFormChange} error={errors.department} />
                <Input label="Date of Joining" name="dateOfJoining" type="date" value={data.dateOfJoining} onChange={onFormChange} error={errors.dateOfJoining} />
                <Input label="Reporting Manager" name="reportingManager" value={data.reportingManager} onChange={onFormChange} error={errors.reportingManager} />
                <SelectInput
                    label="Employment Type"
                    name="employmentType"
                    value={data.employmentType}
                    onChange={onFormChange}
                    options={employmentTypeOptions}
                    error={errors.employmentType}
                />
            </div>
        </>
    ) : (
        <>
            <h4>Current Employment Details</h4>
            <div className="grid-3">
                <Info label="Designation" value={data.designation} />
                <Info label="Employee ID" value={data.employeeId} />
                <Info label="Department" value={data.department} />
                <Info label="Date of Joining" value={formatDateForDisplay(data.dateOfJoining)} />
                <Info label="Reporting Manager" value={data.reportingManager} />
                <Info label="Employment Type" value={data.employmentType} />
            </div>
        </>
    );

    /* =========================
       PREVIOUS EMPLOYMENT
    ========================= */
    const historyContent = (
        <div style={{ marginTop: '30px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
            <h3>Previous Employment History</h3>

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
                    style={{
                        padding: '10px 15px',
                        border: '1px dashed #3b82f6',
                        background: '#e0f2fe',
                        color: '#3b82f6',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        width: '100%',
                        marginTop: '12px',
                        fontWeight: '600'
                    }}
                >
                    + Add Previous Employer
                </button>
            )}
        </div>
    );

    /* =========================
       VALIDATION
    ========================= */
    const mandatoryKeys = [
        'designation',
        'employeeId',
        'department',
        'dateOfJoining',
        'reportingManager',
        'employmentType'
    ];
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
                <div
                    style={{
                        marginTop: '28px',
                        borderTop: '1px solid #eee',
                        paddingTop: '20px',
                        display: 'flex',
                        gap: '12px'
                    }}
                >
                    <button
                        type="button"
                        onClick={onUndo}
                        style={{
                            padding: '10px 22px',
                            background: 'transparent',
                            border: '1px solid #9ca3af',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontWeight: '600',
                            flex: 1
                        }}
                    >
                        Undo
                    </button>

                    <button
                        type="button"
                        onClick={onSave}
                        className="entry-save-btn"
                        style={{
                            padding: '14px 30px',
                            background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            fontWeight: '700',
                            fontSize: '16px',
                            boxShadow: '0 6px 15px rgba(59, 130, 246, 0.5)',
                            flex: 2
                        }}
                    >
                        Save Employment Details
                    </button>
                </div>
            )}
        </AccordionCard>
    );
}
