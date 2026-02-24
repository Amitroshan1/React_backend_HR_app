import React, { useState, useMemo, useCallback, useEffect } from "react";
import { flushSync } from "react-dom";
import "./../styling/profile.css";
import { GRADIENT_HEADER_STYLE } from '../utils/gradientStyles';
import {
    initialDataState,
    calculateProfileCompletion,
    MANDATORY_FORM_FIELDS,
    MANDATORY_FILES_LIST,
    simulatePincodeLookup} from '../utils/profileUtils';

const API_BASE_URL = "/api/auth";

const TOAST_DURATION_MS = 3000;

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
    const [profileLoading, setProfileLoading] = useState(true);
    const [profileError, setProfileError] = useState(null);
    const [adminId, setAdminId] = useState(null);
    const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

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

    const showToast = useCallback((message, type = 'success') => {
        setToast({ show: true, message, type });
    }, []);
    useEffect(() => {
        if (!toast.show) return;
        const t = setTimeout(() => setToast((prev) => ({ ...prev, show: false })), TOAST_DURATION_MS);
        return () => clearTimeout(t);
    }, [toast.show, toast.message]);

    const applyProfileToState = useCallback((p) => {
        const admin = p.admin || {};
        const emp = p.employee || {};
        const eduList = p.education || [];
        const prevList = p.previous_employment || [];
        const docs = p.documents || {};

        const currentAddr = {
            street: emp.present_address_line1 || '',
            city: emp.present_district || '',
            state: emp.present_state || '',
            district: emp.present_district || '',
            taluka: '',
            pincode: emp.present_pincode || '',
        };
        const permAddr = {
            street: emp.permanent_address_line1 || '',
            city: emp.permanent_district || '',
            state: emp.permanent_state || '',
            district: emp.permanent_district || '',
            taluka: '',
            pincode: emp.permanent_pincode || '',
        };
        const sameAsCurrent = !!(emp.present_address_line1 && emp.permanent_address_line1 &&
            emp.present_address_line1 === emp.permanent_address_line1 && emp.present_pincode === emp.permanent_pincode);

        const form = {
            ...initialDataState.formData,
            fullName: emp.name || admin.first_name || '',
            fatherName: emp.father_name || '',
            motherName: emp.mother_name || '',
            maritalStatus: emp.marital_status || '',
            personalEmail: emp.email || admin.email || '',
            mobile: emp.mobile || admin.mobile || '',
            emergency: emp.emergency_mobile || '',
            nationality: emp.nationality || '',
            dateOfBirth: emp.dob ? emp.dob.split('T')[0] : '',
            gender: emp.gender || '',
            bloodGroup: emp.blood_group || '',
            designation: emp.designation || '',
            employeeId: emp.emp_id || admin.emp_id || '',
            department: admin.circle || '',
            dateOfJoining: admin.doj ? admin.doj.split('T')[0] : '',
            reportingManager: (p.admin && p.admin.reporting_manager) || '',
            employmentType: admin.emp_type || '',
        };

        const prevEmp = prevList.length > 0 ? prevList.map((pe) => ({
            companyName: pe.companyName || '',
            designation: pe.designation || '',
            dateOfLeaving: pe.dateOfLeaving ? pe.dateOfLeaving.split('T')[0] : '',
            experienceYears: pe.experienceYears || '',
        })) : [...initialDataState.previousEmployment];

        const eduDetails = eduList.length > 0 ? eduList.map((e) => ({
            id: e.id || Date.now(),
            qualification: e.qualification || '',
            institution: e.institution || '',
            university: e.university || e.board || '',
            fromDate: e.start ? e.start.split('T')[0] : '',
            toDate: e.end ? e.end.split('T')[0] : '',
            marks: e.marks || '',
            certificate: e.doc_file || null,
        })) : [{ id: Date.now(), qualification: '', institution: '', university: '', fromDate: '', toDate: '', marks: '', certificate: null }];

        const filePaths = {
            aadharFront: docs.aadhaar_front || null,
            aadharBack: docs.aadhaar_back || null,
            panFront: docs.pan_front || null,
            panBack: docs.pan_back || null,
            passbookFront: docs.passbook_front || null,
            appointmentLetter: docs.appointment_letter || null,
        };

        const saved = {
            formData: form,
            currentAddress: currentAddr,
            permanentAddress: sameAsCurrent ? currentAddr : permAddr,
            sameAsCurrent,
            files: filePaths,
            previousEmployment: prevEmp,
            educationDetails: eduDetails,
        };

        setAdminId(admin.id != null ? String(admin.id) : null);
        setSavedData(saved);
        setFormData(form);
        setCurrentAddress(currentAddr);
        setPermanentAddress(sameAsCurrent ? currentAddr : permAddr);
        setSameAsCurrent(sameAsCurrent);
        setFiles(filePaths);
        setPreviousEmployment(prevEmp);
        setEducationDetails(eduDetails);
    }, []);

    const fetchProfile = useCallback(async (options = {}) => {
        const { silent = false } = options;
        const token = localStorage.getItem('token');
        if (!token) {
            if (!silent) setProfileLoading(false);
            return null;
        }
        try {
            if (!silent) setProfileLoading(true);
            const res = await fetch(`${API_BASE_URL}/employee/profile`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` },
            });
            if (res.status === 401) {
                if (!silent) {
                    setProfileError('Session expired. Please log in again.');
                }
                if (!silent) setProfileLoading(false);
                return null;
            }
            if (!res.ok) {
                if (!silent) setProfileError('Failed to load profile.');
                if (!silent) setProfileLoading(false);
                return null;
            }
            const data = await res.json();
            if (!data.success || !data.profile) {
                if (!silent) setProfileLoading(false);
                return null;
            }
            applyProfileToState(data.profile);
            if (!silent) setProfileError(null);
            return data.profile;
        } catch (err) {
            if (!silent) setProfileError('Failed to load profile.');
            return null;
        } finally {
            if (!silent) setProfileLoading(false);
        }
    }, [applyProfileToState]);

    // --- Fetch profile from backend on mount (and on refresh) ---
    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

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

        const permAddr = sameAsCurrent ? currentAddress : permanentAddress;

        // Deep-clone so view mode gets a clean copy that won't be mutated
        const eduList = Array.isArray(educationDetails) ? educationDetails : [];
        const newSavedData = {
            formData: JSON.parse(JSON.stringify(formData)),
            currentAddress: JSON.parse(JSON.stringify(currentAddress)),
            permanentAddress: JSON.parse(JSON.stringify(permAddr)),
            sameAsCurrent,
            files: typeof File !== 'undefined' && Object.values(files || {}).some(v => v instanceof File)
                ? { ...files }
                : JSON.parse(JSON.stringify(files || {})),
            previousEmployment: JSON.parse(JSON.stringify(previousEmployment)),
            educationDetails: eduList.map((e) => ({ ...e })),
        };

        // Force React to commit this state immediately so view mode shows it when we exit edit
        flushSync(() => {
            setSavedData(newSavedData);
            setLastSavedTime(new Date().toLocaleTimeString());
        });

        const runSave = async () => {
            const token = localStorage.getItem('token');

            if (adminId && token) {
                try {
                    // POST /employee
                    const empPayload = {
                        admin_id: parseInt(adminId, 10),
                        name: formData.fullName,
                        email: formData.personalEmail,
                        father_name: formData.fatherName,
                        mother_name: formData.motherName,
                        marital_status: formData.maritalStatus,
                        dob: formData.dateOfBirth,
                        emp_id: formData.employeeId,
                        mobile: formData.mobile,
                        gender: formData.gender,
                        emergency_mobile: formData.emergency,
                        nationality: formData.nationality,
                        blood_group: formData.bloodGroup,
                        designation: formData.designation,
                        permanent_address_line1: permAddr.street,
                        permanent_pincode: permAddr.pincode,
                        permanent_district: permAddr.district,
                        permanent_state: permAddr.state,
                        present_address_line1: currentAddress.street,
                        present_pincode: currentAddress.pincode,
                        present_district: currentAddress.district,
                        present_state: currentAddress.state,
                    };
                    const empRes = await fetch(`${API_BASE_URL}/employee`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(empPayload),
                    });
                    if (!empRes.ok) {
                        const errData = await empRes.json().catch(() => ({}));
                        setSaveStatus(errData.message || 'Failed to save profile');
                        showToast(errData.message || 'Failed to save profile.', 'error');
                        return;
                    }

                    // POST /education (first record only; backend requires start/end)
                    const edu = educationDetails[0];
                    if (edu && edu.fromDate && edu.toDate && (edu.qualification || edu.institution || edu.university || edu.marks)) {
                        const eduPayload = {
                            admin_id: parseInt(adminId, 10),
                            qualification: edu.qualification || '',
                            institution: edu.institution || '',
                            board: edu.university || '',
                            start: edu.fromDate,
                            end: edu.toDate,
                            marks: edu.marks || '',
                            doc_file: typeof edu.certificate === 'string' ? edu.certificate : null,
                        };
                        await fetch(`${API_BASE_URL}/education`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify(eduPayload),
                        });
                    }

                    // POST /upload-docs (paths only; file upload can be separate)
                    const docPayload = {
                        admin_id: parseInt(adminId, 10),
                        aadhaar_front: typeof files.aadharFront === 'string' ? files.aadharFront : null,
                        aadhaar_back: typeof files.aadharBack === 'string' ? files.aadharBack : null,
                        pan_front: typeof files.panFront === 'string' ? files.panFront : null,
                        pan_back: typeof files.panBack === 'string' ? files.panBack : null,
                        appointment_letter: typeof files.appointmentLetter === 'string' ? files.appointmentLetter : null,
                        passbook_front: typeof files.passbookFront === 'string' ? files.passbookFront : null,
                    };
                    await fetch(`${API_BASE_URL}/upload-docs`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(docPayload),
                    });
                } catch (err) {
                    setSaveStatus('Failed to save');
                    showToast('Failed to save profile.', 'error');
                    return;
                }
            }
            setSaveStatus('Saved!');
            showToast('Profile saved successfully.');
            // Do not refetch here: it can overwrite savedData with stale API response. Data already set via flushSync; on next refresh fetchProfile will load from backend.
        };

        setSaveStatus('Saving...');
        runSave();
        return true;
    }, [formData, files, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, educationDetails, adminId, getMandatoryValidationErrors, showToast]);

    const SECTION_SAVE_MESSAGES = {
        personal: 'Personal information saved successfully.',
        address: 'Address saved successfully.',
        employment: 'Employment details saved successfully.',
        education: 'Education details saved successfully.',
        documents: 'Documents saved successfully.',
    };

    const saveSectionToBackend = useCallback(async (sectionName) => {
        const token = localStorage.getItem('token');
        if (!token) {
            showToast('Please log in to save your profile.', 'error');
            return;
        }
        if (!adminId) {
            showToast('Profile not loaded. Please refresh the page and try again.', 'error');
            return;
        }
        const permAddr = sameAsCurrent ? currentAddress : permanentAddress;
        try {
            if (['personal', 'address', 'employment'].includes(sectionName)) {
                const empPayload = {
                    admin_id: parseInt(adminId, 10),
                    name: formData.fullName || '',
                    email: formData.personalEmail || '',
                    father_name: formData.fatherName || '',
                    mother_name: formData.motherName || '',
                    marital_status: formData.maritalStatus || 'Single',
                    dob: formData.dateOfBirth || null,
                    emp_id: formData.employeeId || '',
                    mobile: formData.mobile || '',
                    gender: formData.gender || '',
                    emergency_mobile: formData.emergency || '',
                    nationality: formData.nationality || '',
                    blood_group: formData.bloodGroup || '',
                    designation: formData.designation || '',
                    permanent_address_line1: permAddr.street || '',
                    permanent_pincode: permAddr.pincode || '',
                    permanent_district: permAddr.district || '',
                    permanent_state: permAddr.state || '',
                    present_address_line1: currentAddress.street || '',
                    present_pincode: currentAddress.pincode || '',
                    present_district: currentAddress.district || '',
                    present_state: currentAddress.state || '',
                };
                const empRes = await fetch(`${API_BASE_URL}/employee`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(empPayload),
                });
                const errData = await empRes.json().catch(() => ({}));
                if (!empRes.ok) {
                    showToast(errData.message || 'Failed to save. Please check your data and try again.', 'error');
                    return;
                }
                if (sectionName === 'employment') {
                    const prevRes = await fetch(`${API_BASE_URL}/previous-companies`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ items: previousEmployment }),
                    });
                    if (!prevRes.ok) {
                        const prevErr = await prevRes.json().catch(() => ({}));
                        showToast(prevErr.message || 'Failed to save previous employment.', 'error');
                        return;
                    }
                }
            }
            if (sectionName === 'education') {
                const edu = educationDetails[0];
                if (edu && edu.fromDate && edu.toDate) {
                    const eduPayload = {
                        admin_id: parseInt(adminId, 10),
                        qualification: edu.qualification || '',
                        institution: edu.institution || '',
                        board: edu.university || '',
                        start: edu.fromDate,
                        end: edu.toDate,
                        marks: edu.marks || '',
                        doc_file: typeof edu.certificate === 'string' ? edu.certificate : null,
                    };
                    const eduRes = await fetch(`${API_BASE_URL}/education`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify(eduPayload),
                    });
                    if (!eduRes.ok) {
                        showToast('Failed to save education.', 'error');
                        return;
                    }
                }
            }
            if (sectionName === 'documents') {
                const docPayload = {
                    admin_id: parseInt(adminId, 10),
                    aadhaar_front: typeof files.aadharFront === 'string' ? files.aadharFront : null,
                    aadhaar_back: typeof files.aadharBack === 'string' ? files.aadharBack : null,
                    pan_front: typeof files.panFront === 'string' ? files.panFront : null,
                    pan_back: typeof files.panBack === 'string' ? files.panBack : null,
                    appointment_letter: typeof files.appointmentLetter === 'string' ? files.appointmentLetter : null,
                    passbook_front: typeof files.passbookFront === 'string' ? files.passbookFront : null,
                };
                const docRes = await fetch(`${API_BASE_URL}/upload-docs`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(docPayload),
                });
                if (!docRes.ok) {
                    showToast('Failed to save documents.', 'error');
                    return;
                }
            }
            showToast(SECTION_SAVE_MESSAGES[sectionName] || 'Saved successfully.');
        } catch (err) {
            showToast('Failed to save.', 'error');
        }
    }, [adminId, formData, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, educationDetails, files, showToast]);

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
        setEducationDetails(savedData.educationDetails?.length ? savedData.educationDetails : [
            { id: Date.now(), qualification: '', institution: '', university: '', fromDate: '', toDate: '', marks: '', certificate: null }
        ]);
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
        setEducationDetails(Array.isArray(savedClone.educationDetails) && savedClone.educationDetails.length > 0
            ? savedClone.educationDetails
            : [{ id: Date.now(), qualification: '', institution: '', university: '', fromDate: '', toDate: '', marks: '', certificate: null }]);
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
        if (isCurrent && sameAsCurrent) {
            setPermanentAddress(prev => ({ ...prev, [name]: value }));
        }
        if (name === 'pincode' && value.length === 6) {
            const newDetails = simulatePincodeLookup(value);
            setter(prev => ({ ...prev, ...newDetails }));
            if (isCurrent && sameAsCurrent) {
                setPermanentAddress(prev => ({ ...prev, ...newDetails, pincode: value }));
            }
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
            case 'personal': {
                isValid = validatePersonalSection();
                const designationOk = formData.designation && formData.designation.trim() !== '' && formData.designation !== 'Choose Your Designation';
                if (isValid && !designationOk) {
                    setErrors(prev => ({ ...prev, designation: 'Please select a Designation (in Employment section).' }));
                    showToast('Please select Designation in the Employment section below.', 'error');
                    isValid = false;
                } else if (isValid) {
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
                    setErrors(prev => ({ ...prev, designation: '' }));
                    saveSectionToBackend('personal');
                }
                break;
            }
            case 'address':
                isValid = validateAddressSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        currentAddress,
                        permanentAddress,
                        sameAsCurrent
                    }));
                    saveSectionToBackend('address');
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
                    saveSectionToBackend('employment');
                }
                break;
            case 'documents':
                isValid = validateDocumentsSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        files
                    }));
                    saveSectionToBackend('documents');
                }
                break;
            case 'education':
                isValid = validateEducationSection();
                if (isValid) {
                    setSavedData(prev => ({
                        ...prev,
                        educationDetails
                    }));
                    saveSectionToBackend('education');
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
    const dataToDisplay = showEditCards
        ? { formData, previousEmployment, currentAddress, permanentAddress, sameAsCurrent, files, educationDetails: educationDetails || [] }
        : { ...savedData, educationDetails: savedData.educationDetails || [] };
    const mode = showEditCards ? 'edit' : 'view';

    // 🛑 AVATAR CARD CREATION (MEMOIZED) - STYLES MODIFIED FOR MODERN FONT/AESTHETICS
    const avatarCardComponent = useMemo(() => (
        <div className="profile-summary-card card card--summary" style={{ ...MODERN_FONT_STYLE, textAlign: 'center', padding: '30px 20px' }}>

            <ProfileAvatar
                imageUrl={currentAvatarUrl}
                onImageChange={handleAvatarChange}
            />

            <h3 style={{ margin: '15px 0 5px 0', fontSize: '22px' }}><span style={GRADIENT_HEADER_STYLE}>{dataToDisplay.formData.fullName}</span></h3>
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
                <button className="profile-btn-gradient" onClick={handleEditToggle}>
                    📝 Edit Profile
                </button>
            )}
        </div>
    ), [currentAvatarUrl, dataToDisplay, showEditCards, handleEditToggle]);


    // --- Render Logic ---
    const toastEl = toast.show && (
        <div
            role="alert"
            style={{
                position: 'fixed',
                top: 20,
                right: 20,
                zIndex: 9999,
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '12px 20px',
                background: '#fff',
                borderRadius: 8,
                boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
                borderLeft: `4px solid ${toast.type === 'error' ? '#ef4444' : '#10b981'}`,
                animation: 'profileToastSlide 0.3s ease-out',
            }}
        >
            <span>{toast.type === 'success' ? '✅' : '❌'}</span>
            <p style={{ margin: 0, fontSize: '0.9rem', fontWeight: 500, color: '#1e293b' }}>{toast.message}</p>
            <button
                type="button"
                aria-label="Close"
                style={{ background: 'none', border: 'none', fontSize: '1.2rem', cursor: 'pointer', color: '#94a3b8' }}
                onClick={() => setToast((p) => ({ ...p, show: false }))}
            >
                &times;
            </button>
        </div>
    );

    if (profileLoading) {
        return (
            <>
                <div className="profile-page-container" style={{ ...MODERN_FONT_STYLE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6f9' }}>
                    <p>Loading profile...</p>
                </div>
                {toastEl}
            </>
        );
    }
    if (profileError) {
        return (
            <>
                <div className="profile-page-container" style={{ ...MODERN_FONT_STYLE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, backgroundColor: '#f4f6f9' }}>
                    <p style={{ color: '#b91c1c' }}>{profileError}</p>
                </div>
                {toastEl}
            </>
        );
    }

    if (!showEditCards) {
        // --- VIEW MODE RENDER (ProfileViewLayout) ---
        return (
            <>
            <div className="profile-page-container" style={MODERN_FONT_STYLE}>
                <div className="profile-page-inner">
                <ProfileViewLayout
                    data={dataToDisplay}
                    profileProgress={profileProgress}
                    onEditToggle={handleEditToggle}
                    avatarCardComponent={avatarCardComponent}
                />
                </div>
            </div>
            {toastEl}
            </>
        );
    }

    // --- EDIT MODE RENDER (Accordion Layout) ---
    return (
        <>
        <div
            className="profile-page-container"
            style={MODERN_FONT_STYLE}
        >
            <div className="profile-page-inner">
            {/* TOP STATUS/ACTION BAR */}
            <div className="status-header-bar" style={{
                position: 'sticky', top: 0, zIndex: 10, backgroundColor: 'white',
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}>
                {/* ... (Status feedback unchanged) ... */}

                <div className="status-header-inner">
                    <h2 className="edit-profile-title"><span style={GRADIENT_HEADER_STYLE}>Edit Profile</span></h2>

                    <div className="action-button-container">

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

                        {/* Done button (EDIT MODE) */}
                        <button className="done-btn" onClick={handleDoneEditing}>
                            ✅ Done Editing
                        </button>
                    </div>
                </div>
            </div>

            {/* MAIN CONTENT AREA (Accordion Layout) */}
            <div className="profile-content-wrapper">
                {/* Accordion sections */}
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
                    adminId={adminId}
                    uploadProfileFileUrl={`${API_BASE_URL}/upload-profile-file`}
                />
                </div>
            </div>
            </div>
        </div>
        {toastEl}
        </>
    );
}