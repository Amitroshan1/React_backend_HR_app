import React from 'react';
import {AccordionCard} from '../AccordionCard';
import {Input} from '../../common/Input';
import {SelectInput} from '../../common/SelectInput';
import {Info} from '../../common/Info';
import {
    maritalStatusOptions,
    genderOptions,
    bloodGroupOptions,
    nationalityOptions,
    formatDateForDisplay
} from '../../../utils/profileUtils';

export const PersonalInfoSection = ({
    data,
    mode,
    isExpanded,
    onToggle,
    onChange,
    onSave,
    onUndo,
    errors
}) => {
    const isEditMode = mode === 'edit';

    const mandatoryKeys = [
        'fullName',
        'fatherName',
        'maritalStatus',
        'personalEmail',
        'mobile',
        'nationality',
        'dateOfBirth',
        'gender'
    ];

    const hasMandatoryErrors =
        isEditMode && mandatoryKeys.some(key => errors[key]);

    return (
        <AccordionCard
            title="Personal Information"
            subText="Update your basic profile details, marital status, and contact numbers."
            sectionName="personal"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasMandatoryErrors}
        >
            <div className={`personal-info-body ${isEditMode ? 'edit-mode' : 'view-mode'}`}>
                {isEditMode ? (
                    <div className="grid-3 fade-in">
                        <Input
                            label="Full Name"
                            name="fullName"
                            value={data.fullName}
                            onChange={onChange}
                            error={errors.fullName}
                            isMandatory
                        />

                        <Input
                            label="Father's Name"
                            name="fatherName"
                            value={data.fatherName}
                            onChange={onChange}
                            error={errors.fatherName}
                            isMandatory
                        />

                        <Input
                            label="Mother's Name"
                            name="motherName"
                            value={data.motherName}
                            onChange={onChange}
                        />

                        <SelectInput
                            label="Marital Status"
                            name="maritalStatus"
                            value={data.maritalStatus}
                            onChange={onChange}
                            options={maritalStatusOptions}
                            error={errors.maritalStatus}
                            isMandatory
                        />

                        <Input
                            label="Date of Birth"
                            name="dateOfBirth"
                            type="date"
                            value={data.dateOfBirth}
                            onChange={onChange}
                            error={errors.dateOfBirth}
                            isMandatory
                        />

                        <SelectInput
                            label="Gender"
                            name="gender"
                            value={data.gender}
                            onChange={onChange}
                            options={genderOptions}
                            error={errors.gender}
                            isMandatory
                        />

                        <SelectInput
                            label="Blood Group"
                            name="bloodGroup"
                            value={data.bloodGroup}
                            onChange={onChange}
                            options={bloodGroupOptions}
                        />

                        <SelectInput
                            label="Nationality"
                            name="nationality"
                            value={data.nationality}
                            onChange={onChange}
                            options={nationalityOptions}
                            error={errors.nationality}
                            isMandatory
                        />

                        <Input
                            label="Personal Email"
                            name="personalEmail"
                            type="email"
                            value={data.personalEmail}
                            onChange={onChange}
                            error={errors.personalEmail}
                            isMandatory
                        />

                        <Input
                            label="Mobile Number"
                            name="mobile"
                            type="tel"
                            value={data.mobile}
                            onChange={onChange}
                            error={errors.mobile}
                            isMandatory
                        />

                        <Input
                            label="Contact Number"
                            name="emergency"
                            type="tel"
                            value={data.emergency}
                            onChange={onChange}
                        />
                    </div>
                ) : (
                    <div className="grid-3 fade-in">
                        <Info label="Full Name" value={data.fullName} />
                        <Info label="Father's Name" value={data.fatherName} />
                        <Info label="Mother's Name" value={data.motherName} />
                        <Info label="Marital Status" value={data.maritalStatus} />
                        <Info label="Date of Birth" value={formatDateForDisplay(data.dateOfBirth)} />
                        <Info label="Gender" value={data.gender} />
                        <Info label="Blood Group" value={data.bloodGroup} />
                        <Info label="Nationality" value={data.nationality} />
                        <Info label="Personal Email" value={data.personalEmail} />
                        <Info label="Mobile Number" value={data.mobile} />
                        <Info label="Contact Number" value={data.emergency} />
                    </div>
                )}

                {/* SAVE + UNDO */}
                {isEditMode && (
                    <div
                        style={{
                            marginTop: '24px',
                            borderTop: '1px solid #eee',
                            paddingTop: '20px',
                            display: 'flex',
                            gap: '12px'
                        }}
                    >
                        <button
                            type="button"
                            onClick={onUndo}
                            className="entry-undo-btn"
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
                                padding: '12px 24px',
                                background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '700',
                                fontSize: '16px',
                                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                                flex: 2
                            }}
                        >
                            Save Personal Information
                        </button>
                    </div>
                )}
            </div>
        </AccordionCard>
    );
}
 