import React, { useState, useMemo, useCallback } from "react";
import "./../styling/profile.css";
import {
    initialDataState,
    calculateProfileCompletion,
    MANDATORY_FORM_FIELDS,
    MANDATORY_FILES_LIST,
    simulatePincodeLookup} from '../utils/profileUtils';

// import ProgressCircle from './common/ProgressCircle';
import { ProgressCircle } from "./common/ProgressCircle";
import {PersonalInfoSection} from './profile/sections/PersonalInfoSection';
import {AddressSection} from './profile/sections/AddressSection';
import {EmploymentBankSection} from './profile/sections/EmploymentBankSection';
import {EducationSection} from './profile/sections/EducationSection';
import {DocumentUploadSection} from './profile/sections/DocumentUploadSection';
import {ProfileViewLayout} from './profile/ProfileViewLayout';
import {ProfileAvatar} from './profile/ProfileAvatar';

const DEFAULT_AVATAR_URL = '/default-avatar.png'; 

// --- MODERN FONT STACK DEFINITION ---
const MODERN_FONT_STYLE = {
    fontFamily: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
};

export const Profile = () => {
    // Helper for deep cloning the initial data structure
    const getInitialClone = () => JSON.parse(JSON.stringify(initialDataState));
    // --- UI/Control STATES ---
    const [showEditCards, setShowEditCards] = useState(false);
    const [expandedSection, setExpandedSection] = useState(null);
    const [errors, setErrors] = useState({});
    const [currentAvatarUrl, setCurrentAvatarUrl] = useState(DEFAULT_AVATAR_URL);

    // --- SAVED DATA STATE (Initialized with a fresh, deep copy) ---
    const [savedData, setSavedData] = useState(getInitialClone());

    // --- STAGING DATA STATE (Initialized from savedData contents) ---
    const [formData, setFormData] = useState(savedData.formData);
    const [currentAddress, setCurrentAddress] = useState(savedData.currentAddress);
    const [previousEmployment, setPreviousEmployment] = useState(savedData.previousEmployment);
    // Locate your staging states and add this:
    const [educationDetails, setEducationDetails] = useState(() => savedData.educationDetails || [
    { id: Date.now(), qualification: '', institution: '', university: '', fromDate: '', toDate: '', marks: '', certificate: null }
    ]);
    const [permanentAddress, setPermanentAddress] = useState(savedData.permanentAddress);
    const [sameAsCurrent, setSameAsCurrent] = useState(savedData.sameAsCurrent);
    const [files, setFiles] = useState(savedData.files);

    // --- AUTOSAVE STATUS STATES ---
    const [, setSaveStatus] = useState('Ready');
    const [, setLastSavedTime] = useState(null);

    // =========================================================
    // 1. VALIDATION AND SAVE LOGIC
    // =========================================================

    // --- VALIDATION LOGIC (Omitted for brevity) ---
    const getMandatoryValidationErrors = useCallback((currentFormData, currentFiles, currentCurrentAddress, currentPermanentAddress, currentSameAsCurrent) => {
        let newErrors = {};
        let hasMandatoryErrors = false;
        const ADDRESS_MANDATORY_FIELDS = ['street', 'pincode', 'city', 'state', 'district', 'taluka'];

        // 1. FORM FIELD VALIDATION
        MANDATORY_FORM_FIELDS.forEach(key => {
            if (!currentFormData[key] || currentFormData[key].toString().trim() === '' || currentFormData[key] === 'Choose Your Designation') {
                newErrors[key] = `${key} is mandatory.`;
                hasMandatoryErrors = true;
            }
        });

        // 2. ADDRESS VALIDATION
        const validateAddress = (addr, type) => {
            ADDRESS_MANDATORY_FIELDS.forEach(field => {
                const key = `${type}${field.charAt(0).toUpperCase() + field.slice(1)}`;
                if (!addr[field] || addr[field].toString().trim() === '' || (field === 'pincode' && addr.pincode && addr.pincode.length !== 6)) {
                    newErrors[key] = `${field} is mandatory or invalid.`;
                    hasMandatoryErrors = true;
                }
            });
        };
        validateAddress(currentCurrentAddress, 'current');
        if (!currentSameAsCurrent) {
            validateAddress(currentPermanentAddress, 'permanent');
        }

        // 3. DOCUMENT VALIDATION
        MANDATORY_FILES_LIST.forEach(key => {
            if (!currentFiles[key]) {
                newErrors[key] = 'This document is mandatory.';
                hasMandatoryErrors = true;
            }
        });

        return { newErrors, hasMandatoryErrors };
    }, []);

    // --- SAVE LOGIC (Omitted for brevity) ---
    const saveCurrentChanges = useCallback((finalSave = false) => {
        setSaveStatus('Saving...');
        const { newErrors, hasMandatoryErrors } = getMandatoryValidationErrors(
            formData, files, currentAddress, permanentAddress, sameAsCurrent
        );
        setErrors(newErrors);

        if (hasMandatoryErrors) {
            setSaveStatus('Validation Error');
            if (finalSave) {
                // Removed alert for cleaner UX, relying on status/errors
            }
            return false;
        }
        setTimeout(() => {
            setSavedData({
                formData: formData,
                currentAddress: currentAddress,
                permanentAddress: sameAsCurrent ? currentAddress : permanentAddress,
                sameAsCurrent: sameAsCurrent,
                files: files,
                previousEmployment: previousEmployment,
            });
            setLastSavedTime(new Date().toLocaleTimeString());
            setSaveStatus('Saved!');
        }, 300);
        return true;
    }, [formData, files, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, getMandatoryValidationErrors]);

    // --- AVATAR HANDLER (Omitted for brevity) ---
    const handleAvatarChange = (imageBlob) => {
        setSaveStatus('Uploading Image...');
        setTimeout(() => {
            const newUrl = URL.createObjectURL(imageBlob);
            setCurrentAvatarUrl(newUrl);
            setSaveStatus('Saved!');
        }, 500);
    };

    // =========================================================
    // 2. MEMOIZED DATA COMPARISON & PROGRESS (Omitted for brevity)
    // =========================================================


    const profileProgress = useMemo(() => calculateProfileCompletion(
    showEditCards ? formData : savedData.formData,
    showEditCards ? currentAddress : savedData.currentAddress,
    showEditCards ? permanentAddress : savedData.permanentAddress,
    showEditCards ? sameAsCurrent : savedData.sameAsCurrent,
    showEditCards ? files : savedData.files,
    showEditCards ? previousEmployment : savedData.previousEmployment,
    showEditCards ? educationDetails : savedData.educationDetails || []
), [showEditCards, formData, currentAddress, permanentAddress, sameAsCurrent, files, previousEmployment, educationDetails, savedData]);


    // =========================================================
    // 3. MAIN   (Omitted for brevity)
    // =========================================================

    const handleAccordionToggle = (sectionName) => { setExpandedSection(expandedSection === sectionName ? null : sectionName); };

    const handleEditToggle = () => {
        setFormData(savedData.formData);
        setCurrentAddress(savedData.currentAddress);
        setPermanentAddress(savedData.permanentAddress);
        setSameAsCurrent(savedData.sameAsCurrent);
        setFiles(savedData.files);
        setPreviousEmployment(savedData.previousEmployment);
        setShowEditCards(true);
        setExpandedSection('personal');
        setErrors({});
        setSaveStatus('Ready');
    };

    const handleDoneEditing = () => {
        const wasValid = saveCurrentChanges(true);
        if (wasValid) {
            setTimeout(() => {
                setShowEditCards(false);
                setExpandedSection(null);
                setErrors({});
                setSaveStatus('Ready');
            }, 350);
        }
    };

    const handleUndoChanges = () => {
        const savedClone = JSON.parse(JSON.stringify(savedData));
        setFormData(savedClone.formData);
        setCurrentAddress(savedClone.currentAddress);
        setPermanentAddress(savedClone.permanentAddress);
        setSameAsCurrent(savedClone.sameAsCurrent);
        setFiles(savedClone.files);
        setPreviousEmployment(savedClone.previousEmployment);
        setErrors({});
        setSaveStatus('Ready');
        setShowEditCards(false);
        setExpandedSection(null);
    };

    const handleFormChange = (e) => {
        const { name, value } = e.target;
        if (['previousCompanyName', 'previousDesignation', 'dateOfLeaving', 'experienceYears'].includes(name)) return;
        setFormData(prev => ({ ...prev, [name]: value }));
        setErrors(prev => ({ ...prev, [name]: '' }));
    };

    const handleFileChange = (name, fileData) => {
        setFiles(prev => ({ ...prev, [name]: fileData }));
        setErrors(prev => ({ ...prev, [name]: '' }));
    };

    const handleAddressChange = (addressType, e) => {
        const { name, value } = e.target;
        const isCurrent = addressType === 'current';
        const setter = isCurrent ? setCurrentAddress : setPermanentAddress;
        const errorKey = `${addressType}${name.charAt(0).toUpperCase() + name.slice(1)}`;
        setter(prev => ({ ...prev, [name]: value }));
        if (name === 'pincode' && value.length === 6) {
            const newDetails = simulatePincodeLookup(value);
            setter(prev => ({ ...prev, ...newDetails }));
            if (isCurrent && sameAsCurrent) {
                setPermanentAddress(prev => ({ ...prev, ...newDetails, pincode: value }));
            }
        }
        if (isCurrent && sameAsCurrent && name === 'street') {
            setPermanentAddress(prev => ({ ...prev, street: value }));
        }
        setErrors(prev => ({ ...prev, [errorKey]: '' }));
    };

    const handleSameAsCurrentToggle = () => {
        setSameAsCurrent(prev => {
            const newState = !prev;
            if (newState) {
                setPermanentAddress(JSON.parse(JSON.stringify(currentAddress)));
            } else {
                setPermanentAddress({ street: '', city: '', state: '', district: '', taluka: '', pincode: '' });
            }
            return newState;
        });
    };

    const handlePreviousEmploymentChange = (index, name, value) => {
        setPreviousEmployment(prev => {
            const newArray = [...prev];
            newArray[index] = { ...newArray[index], [name]: value };
            return newArray;
        });
    };

    const handleAddPreviousEmployment = () => {
        setPreviousEmployment(prev => [
            ...prev,
            { companyName: '', designation: '', dateOfLeaving: '', experienceYears: '' }
        ]);
    };

    const handleRemovePreviousEmployment = (indexToRemove) => {
        setPreviousEmployment(prev => prev.filter((_, index) => index !== indexToRemove));
    };

    const handleEducationChange = (index, name, value) => {
        setEducationDetails(prev => {
            const newArray = [...prev];
            newArray[index] = { ...newArray[index], [name]: value };
            return newArray;
        });
    };

    const handleAddEducation = () => {
        const newEntry = {
            id: Date.now(),
            qualification: '',
            institution: '',
            university: '',
            fromDate: '',
            toDate: '',
            marks: '',
            certificate: null
        };
        setEducationDetails(prev => [...prev, newEntry]);
    };

    const handleRemoveEducation = (index) => {
        setEducationDetails(prev => prev.filter((_, i) => i !== index));
    };

    // =========================================================
    // 4. PER-SECTION SAVE & UNDO HANDLERS
    // =========================================================

    const PERSONAL_KEYS = [
        'fullName',
        'fatherName',
        'motherName',
        'maritalStatus',
        'personalEmail',
        'mobile',
        'nationality',
        'dateOfBirth',
        'gender',
        'bloodGroup',
        'emergency'
    ];

    const EMPLOYMENT_KEYS = [
        'designation',
        'employeeId',
        'department',
        'dateOfJoining',
        'reportingManager',
        'employmentType'
    ];

    const validatePersonalSection = () => {
        const sectionErrors = {};
        let hasErrors = false;
        const required = [
            'fullName',
            'fatherName',
            'maritalStatus',
            'personalEmail',
            'mobile',
            'nationality',
            'dateOfBirth',
            'gender'
        ];

        required.forEach(key => {
            if (!formData[key] || formData[key].toString().trim() === '') {
                sectionErrors[key] = `${key} is mandatory.`;
                hasErrors = true;
            }
        });

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const validateAddressSection = () => {
        const sectionErrors = {};
        let hasErrors = false;
        const ADDRESS_MANDATORY_FIELDS = ['street', 'pincode', 'city', 'state', 'district', 'taluka'];

        const validateAddress = (addr, type) => {
            ADDRESS_MANDATORY_FIELDS.forEach(field => {
                const key = `${type}${field.charAt(0).toUpperCase() + field.slice(1)}`;
                if (!addr[field] || addr[field].toString().trim() === '' || (field === 'pincode' && addr.pincode && addr.pincode.length !== 6)) {
                    sectionErrors[key] = `${field} is mandatory or invalid.`;
                    hasErrors = true;
                }
            });
        };

        validateAddress(currentAddress, 'current');
        if (!sameAsCurrent) {
            validateAddress(permanentAddress, 'permanent');
        }

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const validateEmploymentSection = () => {
        const sectionErrors = {};
        let hasErrors = false;
        const required = EMPLOYMENT_KEYS;

        required.forEach(key => {
            if (!formData[key] || formData[key].toString().trim() === '') {
                sectionErrors[key] = `${key} is mandatory.`;
                hasErrors = true;
            }
        });

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const validateDocumentsSection = () => {
        const sectionErrors = {};
        let hasErrors = false;

        MANDATORY_FILES_LIST.forEach(key => {
            if (!files[key]) {
                sectionErrors[key] = 'This document is mandatory.';
                hasErrors = true;
            }
        });

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const validateEducationSection = () => {
        const sectionErrors = {};
        let hasErrors = false;

        educationDetails.forEach((edu, index) => {
            const base = `education_${index}_`;
            if (!edu.qualification) {
                sectionErrors[`${base}qualification`] = 'Qualification is mandatory.';
                hasErrors = true;
            }
            if (!edu.institution) {
                sectionErrors[`${base}institution`] = 'Institution is mandatory.';
                hasErrors = true;
            }
            if (!edu.university) {
                sectionErrors[`${base}university`] = 'University is mandatory.';
                hasErrors = true;
            }
            if (!edu.fromDate) {
                sectionErrors[`${base}fromDate`] = 'From date is mandatory.';
                hasErrors = true;
            }
            if (!edu.toDate) {
                sectionErrors[`${base}toDate`] = 'To date is mandatory.';
                hasErrors = true;
            }
            if (!edu.marks) {
                sectionErrors[`${base}marks`] = 'Marks are mandatory.';
                hasErrors = true;
            }
        });

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const handleSectionSave = (sectionName) => {
        let isValid = true;

        switch (sectionName) {
            case 'personal':
                isValid = validatePersonalSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        formData: {
                            ...prev.formData,
                            ...PERSONAL_KEYS.reduce((acc, key) => {
                                acc[key] = formData[key];
                                return acc;
                            }, {})
                        }
                    }));
                }
                break;
            case 'address':
                isValid = validateAddressSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        currentAddress,
                        permanentAddress,
                        sameAsCurrent
                    }));
                }
                break;
            case 'employment':
                isValid = validateEmploymentSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        formData: {
                            ...prev.formData,
                            ...EMPLOYMENT_KEYS.reduce((acc, key) => {
                                acc[key] = formData[key];
                                return acc;
                            }, {})
                        },
                        previousEmployment
                    }));
                }
                break;
            case 'documents':
                isValid = validateDocumentsSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        files
                    }));
                }
                break;
            case 'education':
                isValid = validateEducationSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        educationDetails
                    }));
                }
                break;
            default:
                break;
        }

        return isValid;
    };

    const handleSectionUndo = (sectionName) => {
        const savedClone = JSON.parse(JSON.stringify(savedData));

        switch (sectionName) {
            case 'personal':
                setFormData(prev => ({
                    ...prev,
                    ...PERSONAL_KEYS.reduce((acc, key) => {
                        acc[key] = savedClone.formData[key];
                        return acc;
                    }, {})
                }));
                break;
            case 'address':
                setCurrentAddress(savedClone.currentAddress);
                setPermanentAddress(savedClone.permanentAddress);
                setSameAsCurrent(savedClone.sameAsCurrent);
                break;
            case 'employment':
                setFormData(prev => ({
                    ...prev,
                    ...EMPLOYMENT_KEYS.reduce((acc, key) => {
                        acc[key] = savedClone.formData[key];
                        return acc;
                    }, {})
                }));
                setPreviousEmployment(savedClone.previousEmployment);
                break;
            case 'documents':
                setFiles(savedClone.files);
                break;
            case 'education':
                setEducationDetails(savedClone.educationDetails || []);
                break;
            default:
                break;
        }
    };

    // --- Render Data and Mode Setup ---
    const dataToDisplay = showEditCards ? { formData, previousEmployment, currentAddress, permanentAddress, sameAsCurrent, files } : savedData;
    const mode = showEditCards ? 'edit' : 'view';

    // 🛑 AVATAR CARD CREATION (MEMOIZED) - STYLES MODIFIED FOR MODERN FONT/AESTHETICS
    const avatarCardComponent = useMemo(() => (
        <div style={{ ...MODERN_FONT_STYLE, textAlign: 'center', padding: '30px 20px', backgroundColor: '#fff', borderRadius: '12px', boxShadow: '0 8px 15px rgba(0, 0, 0, 0.08)' }}>

            <ProfileAvatar
                imageUrl={currentAvatarUrl}
                onImageChange={handleAvatarChange}
            />

            <h3 style={{ margin: '15px 0 5px 0', color: '#1f2937', fontSize: '22px', fontWeight: '700' }}>{dataToDisplay.formData.fullName}</h3>
            <p style={{ margin: '0 0 20px 0', color: '#6b7280', fontWeight: '500', fontSize: '15px' }}>
                {dataToDisplay.formData.designation} | {dataToDisplay.formData.employmentType}
            </p>
            <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '20px 0' }} />
            <p style={{ margin: '10px 0', color: '#374151', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📧</span> {dataToDisplay.formData.personalEmail}
            </p>
            <p style={{ margin: '10px 0', color: '#374151', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px', transform: 'rotate(270deg)' }}>📞</span> {dataToDisplay.formData.mobile}
            </p>
            <p style={{ margin: '10px 0 30px 0', color: '#374151', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <span style={{ fontSize: '18px' }}>📍</span> {dataToDisplay.currentAddress.city}, {dataToDisplay.currentAddress.pincode}
            </p>

            {/* 🛑 ENHANCED EDIT PROFILE BUTTON (VIEW MODE) */}
            {!showEditCards && (
                <button
                    onClick={handleEditToggle}
                    style={{
                        marginTop: '15px',
                        padding: '14px 30px',
                        background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)', // Rich Blue Gradient
                        color: 'white',
                        border: 'none',
                        borderRadius: '10px',
                        cursor: 'pointer',
                        fontWeight: '700',
                        fontSize: '16px',
                        width: '100%',
                        boxShadow: '0 6px 15px rgba(59, 130, 246, 0.5)', // Prominent Shadow
                        transition: 'all 0.3s ease',
                        letterSpacing: '0.5px',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 8px 20px rgba(59, 130, 246, 0.7)';
                        e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = '0 6px 15px rgba(59, 130, 246, 0.5)';
                        e.currentTarget.style.transform = 'translateY(0)';
                    }}
                >
                    📝 Edit Profile
                </button>
            )}
        </div>
    ), [currentAvatarUrl, dataToDisplay, showEditCards, handleEditToggle]);


    // --- Render Logic ---
    if (!showEditCards) {
        // --- VIEW MODE RENDER (ProfileViewLayout) ---
        return (
            <div className="profile-page-container" style={{
                ...MODERN_FONT_STYLE, height: '100', minHeight: '100vh', backgroundColor: '#f4f6f9', width: '100%',
                maxWidth: 'none',
                padding: '0',
            }}>
                <ProfileViewLayout
                    data={dataToDisplay}
                    profileProgress={profileProgress}
                    onEditToggle={handleEditToggle}
                    avatarCardComponent={avatarCardComponent}
                />
            </div>
        );
    }

    // --- EDIT MODE RENDER (Accordion Layout) ---
    return (
        <div
            className="profile-page-container"
            style={{
                ...MODERN_FONT_STYLE,
                width: '100%',
                maxWidth: 'none',
                minHeight: '100vh',
                padding: 0,
                backgroundColor: '#f4f6f9',
            }}
        >

            {/* TOP STATUS/ACTION BAR - Styled for Stickiness and Modern Look */}
            <div className="status-header-bar" style={{
                position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'white',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}>
                {/* ... (Status feedback unchanged) ... */}

                <div style={{ padding: '15px 40px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #ddd' }}>
                    <h2 style={{ fontWeight: '700', color: '#1f2937', margin: 0, fontSize: '24px' }}>Edit Profile</h2>

                    <div className="action-button-container" style={{ display: 'flex', gap: '15px' }}>

                        {/* 🛑 ENHANCED DISCARD BUTTON (EDIT MODE) */}
                        <button
                            className="discard-btn"
                            onClick={handleUndoChanges}
                            style={{
                                padding: '10px 20px',
                                backgroundColor: 'transparent',
                                color: '#ef4444',
                                border: '1px solid #ef4444',
                                borderRadius: '6px',
                                fontWeight: '600',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#fef2f2';
                                e.currentTarget.style.transform = 'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        >
                            <span style={{ marginRight: '5px' }}>&larr;</span> Discard Changes
                        </button>

                        {/* 🛑 ENHANCED DONE BUTTON (EDIT MODE) */}
                        <button
                            className="done-btn"
                            onClick={handleDoneEditing}
                            style={{
                                padding: '10px 25px',
                                background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)', // Rich Green Gradient
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                fontWeight: '700',
                                cursor: 'pointer',
                                boxShadow: '0 4px 10px rgba(16, 185, 129, 0.4)',
                                transition: 'all 0.2s ease',
                                letterSpacing: '0.5px',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.boxShadow = '0 6px 15px rgba(16, 185, 129, 0.6)';
                                e.currentTarget.style.transform = 'scale(1.02)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.boxShadow = '0 4px 10px rgba(16, 185, 129, 0.4)';
                                e.currentTarget.style.transform = 'scale(1)';
                            }}
                        >
                            ✅ Done Editing
                        </button>
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT AREA (Accordion Layout) */}
            <div
                className="profile-content-wrapper"
                style={{
                    padding: '24px 24px 40px',
                    width: '100%',
                    boxSizing: 'border-box',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '24px',
                }}
            >
                {/* Top row: Progress + Task Graph + Skills */}
                <div className="edit-header-row">
                    <div className="edit-progress-card">
                        <ProgressCircle progressValue={profileProgress} />
                    </div>

                    <div className="mini-stat-card edit-summary-card">
                        <div className="mini-stat-card-title">Tasks Overview</div>
                        <div style={{ marginTop: '8px' }}>
                            <div style={{ fontSize: '12px', color: '#6b7280', marginBottom: '6px' }}>This Month</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                    <span>Completed</span>
                                    <span>18</span>
                                </div>
                                <div style={{ height: '6px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
                                    <div style={{ width: '78%', height: '100%', background: '#22c55e' }} />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                                    <span>In Progress</span>
                                    <span>5</span>
                                </div>
                                <div style={{ height: '6px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
                                    <div style={{ width: '45%', height: '100%', background: '#3b82f6' }} />
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginTop: '4px' }}>
                                    <span>Pending</span>
                                    <span>3</span>
                                </div>
                                <div style={{ height: '6px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden' }}>
                                    <div style={{ width: '25%', height: '100%', background: '#f97316' }} />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mini-stat-card edit-summary-card">
                        <div className="mini-stat-card-title">Key Skills</div>
                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                { label: 'Automation Testing', level: 'Advanced', width: '85%' },
                                { label: 'JavaScript / React', level: 'Intermediate', width: '70%' },
                                { label: 'Communication', level: 'Advanced', width: '90%' },
                            ].map(skill => (
                                <div key={skill.label}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                                        <span>{skill.label}</span>
                                        <span style={{ color: '#6b7280' }}>{skill.level}</span>
                                    </div>
                                    <div style={{ height: '6px', borderRadius: '999px', background: '#e5e7eb', overflow: 'hidden', marginTop: '3px' }}>
                                        <div style={{ width: skill.width, height: '100%', background: '#6366f1' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* All cards stacked below, spanning whole page width */}
                <div className="sections-column" style={{ width: '100%' }}>
                <PersonalInfoSection
                    data={dataToDisplay.formData}
                    mode={mode}
                    isExpanded={expandedSection === 'personal'}
                    onToggle={() => handleAccordionToggle('personal')}
                    onChange={handleFormChange}
                    onSave={() => handleSectionSave('personal')}
                    onUndo={() => handleSectionUndo('personal')}
                    errors={errors}
                />
                
                <AddressSection
                    currentAddress={dataToDisplay.currentAddress}
                    permanentAddress={dataToDisplay.permanentAddress}
                    sameAsCurrent={dataToDisplay.sameAsCurrent}
                    mode={mode}
                    isExpanded={expandedSection === 'address'}
                    onToggle={() => handleAccordionToggle('address')}
                    onAddressChange={handleAddressChange}
                    onSameAsCurrentToggle={handleSameAsCurrentToggle}
                    onSave={() => handleSectionSave('address')}
                    onUndo={() => handleSectionUndo('address')}
                    errors={errors}
                />
                {/* ... (Other sections omitted for brevity) ... */}
                <EmploymentBankSection
                    data={dataToDisplay.formData}
                    prevEmpData={dataToDisplay.previousEmployment}
                    mode={mode}
                    isExpanded={expandedSection === 'employment'}
                    onToggle={() => handleAccordionToggle('employment')}
                    onFormChange={handleFormChange}
                    onPrevEmpChange={handlePreviousEmploymentChange}
                    onAddPrevEmp={handleAddPreviousEmployment}
                    onRemovePrevEmp={handleRemovePreviousEmployment}
                    onSave={() => handleSectionSave('employment')}
                    onUndo={() => handleSectionUndo('employment')}
                    errors={errors}
                />
                {/* 🛑 4th: Insert EducationSection here */}
                <EducationSection
                    educationData={educationDetails}
                    mode={mode}
                    isExpanded={expandedSection === 'education'}
                    onToggle={() => handleAccordionToggle('education')}
                    onChange={handleEducationChange}
                    onAdd={handleAddEducation}
                    onRemove={handleRemoveEducation}
                    onSave={() => handleSectionSave('education')}
                    onUndo={() => handleSectionUndo('education')}
                />
                <DocumentUploadSection
                    files={dataToDisplay.files}
                    mode={mode}
                    isExpanded={expandedSection === 'documents'}
                    onToggle={() => handleAccordionToggle('documents')}
                    onFileChange={handleFileChange}
                    onSave={() => handleSectionSave('documents')}
                    onUndo={() => handleSectionUndo('documents')}
                    errors={errors}
                />
                </div>
            </div>
        </div>

    );
}