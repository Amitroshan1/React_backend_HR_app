import React from 'react';
import {AccordionCard} from '../AccordionCard';
import {FileUpload} from '../FileUpload';
import {Input} from '../../common/Input';
import {SelectInput} from '../../common/SelectInput';

// ✅ Qualification dropdown options
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
            {educationData.map((edu, index) => (
                <div
                    key={edu.id}
                    className="education-block"
                    style={{
                        marginBottom: '25px',
                        borderBottom: '1px solid #eee',
                        paddingBottom: '20px'
                    }}
                >
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
                            />
                        </div>

                        <Input
                            label="Institution Name"
                            value={edu.institution}
                            onChange={(e) =>
                                onChange(index, 'institution', e.target.value)
                            }
                            isMandatory
                        />

                        <Input
                            label="University / Board"
                            value={edu.university}
                            onChange={(e) =>
                                onChange(index, 'university', e.target.value)
                            }
                            isMandatory
                        />

                        <div className="education-date-row">
                            <Input
                                label="From Date"
                                type="date"
                                value={edu.fromDate}
                                onChange={(e) =>
                                    onChange(index, 'fromDate', e.target.value)
                                }
                                isMandatory
                            />

                            <Input
                                label="To Date"
                                type="date"
                                value={edu.toDate}
                                onChange={(e) =>
                                    onChange(index, 'toDate', e.target.value)
                                }
                                isMandatory
                            />
                        </div>

                        <Input
                            label="Marks Percentage / CGPA"
                            value={edu.marks}
                            onChange={(e) =>
                                onChange(index, 'marks', e.target.value)
                            }
                            isMandatory
                        />

                        <FileUpload
                            label="Upload Certificate"
                            name={`education_certificate_${index}`}
                            fileData={edu.certificate}
                            onFileChange={(_, file) =>
                                onChange(index, 'certificate', file)
                            }
                            isMandatory
                        />
                    </div>

                    {/* REMOVE SINGLE EDUCATION */}
                    {isEditMode && educationData.length > 1 && (
                        <div style={{ marginTop: '12px', textAlign: 'right' }}>
                            <button
                                type="button"
                                onClick={() => onRemove(index)}
                                className="remove-btn"
                            >
                                Remove
                            </button>
                        </div>
                    )}
                </div>
            ))}

            {/* ADD EDUCATION */}
            {isEditMode && (
                <button
                    type="button"
                    onClick={onAdd}
                    style={{
                        padding: '10px 15px',
                        border: '1px dashed #3b82f6',
                        background: '#e0f2fe',
                        color: '#3b82f6',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        width: '100%',
                        marginTop: '10px',
                        fontWeight: '600'
                    }}
                >
                    + Add Education Details
                </button>
            )}

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
                            padding: '12px 20px',
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
                        Save Education Details
                    </button>
                </div>
            )}
        </AccordionCard>
    );
};


