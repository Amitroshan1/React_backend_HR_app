import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
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
            <h4 className="employment-section-title"><span style={GRADIENT_HEADER_STYLE}>Current Employment Details</span></h4>
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
            <h4 className="employment-section-title"><span style={GRADIENT_HEADER_STYLE}>Current Employment Details</span></h4>
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
