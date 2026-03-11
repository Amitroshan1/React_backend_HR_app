import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import {AccordionCard} from '../AccordionCard';
import {FileUpload} from '../FileUpload';
import {Input} from '../../common/Input';
import {SelectInput} from '../../common/SelectInput';

// Qualification dropdown options
const qualificationOptions = [
    'High School',
    'Diploma',
    "Bachelor's Degree",
    "Master's Degree",
    'PhD',
    'Other'
];

export const EducationSection = ({
    educationData,
    mode,
    isExpanded,
    onToggle,
    onChange,
    onAdd,
    onRemove,
    onSave,
    onUndo,
    adminId,
    uploadProfileFileUrl,
    errors = {},
}) => {
    const isEditMode = mode === 'edit';

    return (
        <AccordionCard
            title="Education Details"
            subText="Add your academic qualification details"
            sectionName="education"
            isExpanded={isExpanded}
            onToggle={onToggle}
        >
            <div className="education-body">
            {educationData.map((edu, index) => (
                <div key={edu.id} className="education-block">
                    <div className="education-block-header">
                        <h4><span style={GRADIENT_HEADER_STYLE}>Education #{index + 1}</span></h4>
                        {isEditMode && educationData.length > 1 && (
                            <button
                                type="button"
                                onClick={() => onRemove(index)}
                                className="remove-btn"
                            >
                                Remove
                            </button>
                        )}
                    </div>

                    <div className="education-grid">
                        {/* ✅ Qualification Dropdown - same style as other selects */}
                        <div className="education-qualification">
                            <SelectInput
                                label="Qualification"
                                name={`qualification_${index}`}
                                value={edu.qualification}
                                onChange={(e) => onChange(index, 'qualification', e.target.value)}
                                options={qualificationOptions}
                                isMandatory
                                error={errors[`education_${index}_qualification`]}
                            />
                        </div>

                        <Input
                            label="Institution Name"
                            name={`institution_${index}`}
                            value={edu.institution}
                            onChange={(e) =>
                                onChange(index, 'institution', e.target.value)
                            }
                            isMandatory
                            maxLength={100}
                            error={errors[`education_${index}_institution`]}
                        />

                        <Input
                            label="University / Board"
                            name={`university_${index}`}
                            value={edu.university}
                            onChange={(e) =>
                                onChange(index, 'university', e.target.value)
                            }
                            isMandatory
                            maxLength={100}
                            error={errors[`education_${index}_university`]}
                        />

                        <div className="education-date-row">
                            <Input
                                label="From Date"
                                name={`fromDate_${index}`}
                                type="date"
                                value={edu.fromDate}
                                onChange={(e) =>
                                    onChange(index, 'fromDate', e.target.value)
                                }
                                isMandatory
                                error={errors[`education_${index}_fromDate`]}
                            />

                            <Input
                                label="To Date"
                                name={`toDate_${index}`}
                                type="date"
                                value={edu.toDate}
                                onChange={(e) =>
                                    onChange(index, 'toDate', e.target.value)
                                }
                                isMandatory
                                error={errors[`education_${index}_toDate`]}
                            />
                        </div>

                        <Input
                            label="Marks Percentage / CGPA"
                            name={`marks_${index}`}
                            value={edu.marks}
                            onChange={(e) =>
                                onChange(index, 'marks', e.target.value)
                            }
                            isMandatory
                            error={errors[`education_${index}_marks`]}
                        />

                        <FileUpload
                            label="Upload Certificate"
                            name={`education_certificate_${index}`}
                            fileData={edu.certificate}
                            onFileChange={(_, file) =>
                                onChange(index, 'certificate', file)
                            }
                            adminId={adminId}
                            uploadProfileFileUrl={uploadProfileFileUrl}
                            accept=".pdf,.jpg,.jpeg,.png"
                            error={errors[`education_${index}_certificate`]}
                        />
                    </div>
                </div>
            ))}

            {/* ADD EDUCATION */}
            {isEditMode && (
                <button
                    type="button"
                    onClick={onAdd}
                    className="add-section"
                >
                    + Add Education Details
                </button>
            )}

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
                        Save Education Details
                    </button>
                </div>
            )}
            </div>
        </AccordionCard>
    );
};


