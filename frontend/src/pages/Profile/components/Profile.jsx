import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { toast } from "react-toastify";
import "./../styling/profile.css";
import { GRADIENT_HEADER_STYLE } from '../utils/gradientStyles';
import {
    initialDataState,
    getProfileSectionCompletion,
    MANDATORY_FORM_FIELDS,
    MANDATORY_FILES_LIST,
} from '../utils/profileUtils';
import {
    API_BASE_URL,
    mapProfileFromApi,
    normalizePhotoUrl,
    buildEmployeePayload,
    buildEducationItems,
    buildDocPayload,
    fetchEmployeeProfile,
    fetchPincodeDetails,
    postEmployee,
    postEducationReplace,
    postPreviousCompanies,
    postUploadDocs,
    postUploadPhoto,
} from '../utils/profileApi';
import { useUser } from "../../../components/layout/UserContext";

const isValidEmail = (email) => {
    if (!email || typeof email !== 'string') return false;
    const trimmed = email.trim();
    if (!trimmed) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

const NAME_MIN_LEN = 2;
const NAME_MAX_LEN = 100;
const ADDRESS_FIELD_MAX_LEN = 255;
const STREET_MAX_LEN = 400;
const STATE_DISTRICT_MAX_LEN = 100;
const MIN_AGE_YEARS = 18;
const EDU_INST_UNIV_MAX_LEN = 100;

const validateFullName = (val) => {
    if (!val || typeof val !== 'string') return null;
    const t = val.trim();
    if (t.length < NAME_MIN_LEN) return 'Full Name must contain at least 2 characters.';
    if (t.length > NAME_MAX_LEN) return `Full Name cannot exceed ${NAME_MAX_LEN} characters.`;
    const hasLetters = /[a-zA-Z]/.test(t);
    const onlyDigits = /^\d+$/.test(t.replace(/\s/g, ''));
    const onlySpecial = !/[a-zA-Z0-9]/.test(t.replace(/\s/g, ''));
    if (!hasLetters || onlyDigits) return 'Full Name must contain letters (cannot be numbers only).';
    if (onlySpecial) return 'Full Name must contain letters (cannot be special characters only).';
    return null;
};

const validatePersonName = (val, label) => {
    if (!val || typeof val !== 'string') return null;
    const t = val.trim();
    if (t.length < NAME_MIN_LEN) return `${label} must contain at least ${NAME_MIN_LEN} characters.`;
    if (t.length > NAME_MAX_LEN) return `${label} cannot exceed ${NAME_MAX_LEN} characters.`;
    const hasLetters = /[a-zA-Z]/.test(t);
    const onlyDigits = /^\d+$/.test(t.replace(/\s/g, ''));
    const onlySpecial = !/[a-zA-Z0-9]/.test(t.replace(/\s/g, ''));
    if (!hasLetters || onlyDigits) return `${label} must contain letters (cannot be numbers only).`;
    if (onlySpecial) return `${label} must contain letters (cannot be special characters only).`;
    return null;
};

const validateDateOfBirth = (dobStr) => {
    if (!dobStr || typeof dobStr !== 'string') return null;
    const d = new Date(dobStr);
    if (isNaN(d.getTime())) return 'Please enter a valid date.';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    if (d > today) return 'Date of Birth cannot be in the future.';
    const age = Math.floor((today - d) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < MIN_AGE_YEARS) return `You must be at least ${MIN_AGE_YEARS} years old.`;
    return null;
};

import {PersonalInfoSection} from './profile/sections/PersonalInfoSection';
import {AddressSection} from './profile/sections/AddressSection';
import {EmploymentBankSection} from './profile/sections/EmploymentBankSection';
import {EducationSection} from './profile/sections/EducationSection';
import {DocumentUploadSection} from './profile/sections/DocumentUploadSection';
import {ProfileViewLayout} from './profile/ProfileViewLayout';

const DEFAULT_AVATAR_URL =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="50" fill="#2563eb"/>' +
        '<circle cx="50" cy="38" r="16" fill="#fff"/>' +
        '<path d="M22 82c4-14 16-22 28-22s24 8 28 22" fill="#fff"/></svg>'
    ); 

// --- MODERN FONT STACK DEFINITION ---
const MODERN_FONT_STYLE = {
    fontFamily: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
};

export const Profile = () => {
    const { refreshUserData, bumpPhotoVersion } = useUser();
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
    const [hasEmployeeRecord, setHasEmployeeRecord] = useState(false);
    const [pincodeLoading, setPincodeLoading] = useState({ current: false, permanent: false });
    const pincodeLookupSeq = useRef({ current: 0, permanent: 0 });
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
        if (type === 'error') {
            toast.error(message, { autoClose: 5000 });
        } else {
            toast.success(message, { autoClose: 4000 });
        }
    }, []);

    const applyProfileToState = useCallback((p) => {
        const { adminId: aid, saved, avatarUrl, hasEmployeeRecord: hasEmp } = mapProfileFromApi(p);
        setAdminId(aid);
        setHasEmployeeRecord(hasEmp);
        setSavedData(saved);
        setFormData(saved.formData);
        setCurrentAddress(saved.currentAddress);
        setPermanentAddress(saved.permanentAddress);
        setSameAsCurrent(saved.sameAsCurrent);
        setFiles(saved.files);
        setPreviousEmployment(saved.previousEmployment);
        setEducationDetails(saved.educationDetails);
        if (avatarUrl) {
            setCurrentAvatarUrl(`${avatarUrl}?t=${Date.now()}`);
        }
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
            const { ok, status, data } = await fetchEmployeeProfile();
            if (status === 401) {
                if (!silent) {
                    setProfileError('Session expired. Please log in again.');
                }
                if (!silent) setProfileLoading(false);
                return null;
            }
            if (!ok) {
                if (!silent) setProfileError('Failed to load profile.');
                if (!silent) setProfileLoading(false);
                return null;
            }
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
        const ADDRESS_MANDATORY_FIELDS = ['street', 'pincode', 'city', 'state', 'district'];

        // 1. FORM FIELD VALIDATION
        MANDATORY_FORM_FIELDS.forEach(key => {
            if (!currentFormData[key] || currentFormData[key].toString().trim() === '' || currentFormData[key] === 'Choose Your Designation') {
                newErrors[key] = `${key} is mandatory.`;
                hasMandatoryErrors = true;
            }
        });

        // 1b. FULL NAME VALIDATION (min/max, format)
        const fullNameErr = validateFullName(currentFormData?.fullName);
        if (fullNameErr) { newErrors.fullName = fullNameErr; hasMandatoryErrors = true; }

        // 1c. FATHER NAME VALIDATION (min 2, max length)
        const fatherNameErr = validatePersonName(currentFormData?.fatherName, 'Father Name');
        if (fatherNameErr) { newErrors.fatherName = fatherNameErr; hasMandatoryErrors = true; }

        const motherNameVal = currentFormData?.motherName;
        if (motherNameVal && motherNameVal.toString().trim() !== '') {
            const motherNameErr = validatePersonName(motherNameVal, 'Mother Name');
            if (motherNameErr) { newErrors.motherName = motherNameErr; hasMandatoryErrors = true; }
        }

        // 1d. DATE OF BIRTH VALIDATION (no future, min age 18)
        const dobErr = validateDateOfBirth(currentFormData?.dateOfBirth);
        if (dobErr) { newErrors.dateOfBirth = dobErr; hasMandatoryErrors = true; }

        // 1e. EMAIL FORMAT VALIDATION
        const emailVal = currentFormData?.personalEmail;
        if (emailVal && emailVal.toString().trim() !== '') {
            if (!isValidEmail(emailVal)) {
                newErrors.personalEmail = 'Please enter a valid email address.';
                hasMandatoryErrors = true;
            }
        }

        // 1f. MOBILE & EMERGENCY: reject decimals (numeric only)
        const mobileVal = currentFormData?.mobile;
        if (mobileVal && (String(mobileVal).includes('.') || !/^\d*$/.test(String(mobileVal)))) {
            newErrors.mobile = 'Mobile Number must contain only digits (no decimals).';
            hasMandatoryErrors = true;
        }
        const emergencyVal = currentFormData?.emergency;
        if (emergencyVal && (String(emergencyVal).includes('.') || !/^\d*$/.test(String(emergencyVal)))) {
            newErrors.emergency = 'Contact Number must contain only digits (no decimals).';
            hasMandatoryErrors = true;
        }

        // 2. ADDRESS VALIDATION (including max length)
        const validateAddress = (addr, type) => {
            ADDRESS_MANDATORY_FIELDS.forEach(field => {
                const key = `${type}${field.charAt(0).toUpperCase() + field.slice(1)}`;
                const val = addr[field];
                if (!val || val.toString().trim() === '') {
                    newErrors[key] = `${field} is mandatory.`;
                    hasMandatoryErrors = true;
                } else if (field === 'pincode') {
                    const pincodeStr = val ? String(val).trim() : '';
                    if (pincodeStr.length !== 6) {
                        newErrors[key] = 'Pincode must be 6 digits.';
                        hasMandatoryErrors = true;
                    } else if (/\./.test(pincodeStr) || !/^\d+$/.test(pincodeStr)) {
                        newErrors[key] = 'Pincode must be 6 digits only (no decimals).';
                        hasMandatoryErrors = true;
                    }
                } else if (field === 'street' && val && val.toString().length > STREET_MAX_LEN) {
                    newErrors[key] = `Street Address cannot exceed ${STREET_MAX_LEN} characters.`;
                    hasMandatoryErrors = true;
                } else if (['state', 'district', 'city'].includes(field) && val && val.toString().length > STATE_DISTRICT_MAX_LEN) {
                    const label = field.charAt(0).toUpperCase() + field.slice(1);
                    newErrors[key] = `${label} cannot exceed ${STATE_DISTRICT_MAX_LEN} characters.`;
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

    // --- SAVE LOGIC ---
    const saveCurrentChanges = useCallback(async (finalSave = false) => {
        setSaveStatus('Saving...');
        const { newErrors, hasMandatoryErrors } = getMandatoryValidationErrors(
            formData, files, currentAddress, permanentAddress, sameAsCurrent
        );
        setErrors(newErrors);

        if (hasMandatoryErrors) {
            setSaveStatus('Validation Error');
            showToast('Please fix validation errors before saving.', 'error');
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
            if (!adminId || !token) {
                setSaveStatus('Ready');
                showToast('Session expired or profile not loaded. Please refresh the page.', 'error');
                return false;
            }
            let successMsg = 'Profile saved successfully.';
            try {
                    const empPayload = buildEmployeePayload({
                        adminId,
                        formData,
                        currentAddress,
                        permanentAddress,
                        sameAsCurrent,
                    });
                    const { ok: empOk, data: empData } = await postEmployee(empPayload);
                    if (!empOk) {
                        const msg = empData.message || 'Failed to save profile';
                        setSaveStatus(msg);
                        showToast(msg, 'error');
                        if (msg.toLowerCase().includes('street')) {
                            setErrors((prev) => ({ ...prev, currentStreet: msg, permanentStreet: msg }));
                        }
                        if (msg.toLowerCase().includes('email')) {
                            setErrors((prev) => ({ ...prev, personalEmail: msg }));
                        }
                        return false;
                    }
                    if (empData?.message?.trim()) successMsg = empData.message.trim();
                    setHasEmployeeRecord(true);

                    const eduItems = buildEducationItems(educationDetails);
                    const { ok: eduOk, data: eduData } = await postEducationReplace(eduItems);
                    if (!eduOk) {
                        showToast(eduData.message || 'Failed to save education.', 'error');
                        return false;
                    }

                    const prevRes = await postPreviousCompanies(previousEmployment);
                    if (!prevRes.ok) {
                        showToast(prevRes.data.message || 'Failed to save previous employment.', 'error');
                        return false;
                    }

                    const docPayload = buildDocPayload(adminId, files);
                    const { ok: docOk, data: docData } = await postUploadDocs(docPayload);
                    if (!docOk) {
                        showToast(docData.message || 'Failed to save documents.', 'error');
                        return false;
                    }
            } catch (err) {
                setSaveStatus('Failed to save');
                showToast('Failed to save profile.', 'error');
                return false;
            }
            setSaveStatus('Saved!');
            showToast(successMsg, 'success');
            return true;
        };

        setSaveStatus('Saving...');
        const success = await runSave();
        return success;
    }, [formData, files, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, educationDetails, adminId, getMandatoryValidationErrors, showToast]);

    const SECTION_SAVE_MESSAGES = {
        personal: 'Personal information saved successfully.',
        address: 'Address saved successfully.',
        employment: 'Employment details saved successfully.',
        education: 'Education details saved successfully.',
        documents: 'Documents saved successfully.',
    };

    const SECTION_ERROR_MESSAGES = {
        personal: 'Please fix errors in Personal Information before saving.',
        address: 'Please fix address validation errors before saving.',
        employment: 'Please fix employment details before saving.',
        education: 'Please fix education validation errors before saving.',
        documents: 'Please fix document issues before saving.',
    };

    const saveSectionToBackend = useCallback(async (sectionName) => {
        const token = localStorage.getItem('token');
        if (!token) {
            showToast('Please log in to save your profile.', 'error');
            return false;
        }
        if (!adminId) {
            showToast('Profile not loaded. Please refresh the page and try again.', 'error');
            return false;
        }
        try {
            let successMsg = SECTION_SAVE_MESSAGES[sectionName] || 'Saved successfully.';
            if (['personal', 'address', 'employment'].includes(sectionName)) {
                const empPayload = buildEmployeePayload({
                    adminId,
                    formData,
                    currentAddress,
                    permanentAddress,
                    sameAsCurrent,
                });
                const { ok: empOk, data: errData } = await postEmployee(empPayload);
                if (!empOk) {
                    const msg = errData.message || 'Failed to save. Please check your data and try again.';
                    showToast(msg, 'error');
                    if (msg.toLowerCase().includes('email')) {
                        setErrors((prev) => ({ ...prev, personalEmail: msg }));
                    }
                    if (sectionName === 'address' && msg.toLowerCase().includes('street')) {
                        setErrors((prev) => ({ ...prev, currentStreet: msg, permanentStreet: msg }));
                    }
                    return false;
                }
                if (errData?.message?.trim()) successMsg = errData.message.trim();
                setHasEmployeeRecord(true);
                if (sectionName === 'employment') {
                    const prevRes = await postPreviousCompanies(previousEmployment);
                    if (!prevRes.ok) {
                        showToast(prevRes.data.message || 'Failed to save previous employment.', 'error');
                        return false;
                    }
                }
            }
            if (sectionName === 'education') {
                const items = buildEducationItems(educationDetails);
                const { ok: eduOk, data: eduData } = await postEducationReplace(items);
                if (!eduOk) {
                    showToast(eduData.message || 'Failed to save education.', 'error');
                    return false;
                }
                if (eduData?.message?.trim()) successMsg = eduData.message.trim();
            }
            if (sectionName === 'documents') {
                const docPayload = buildDocPayload(adminId, files);
                const { ok: docOk, data: docData } = await postUploadDocs(docPayload);
                if (!docOk) {
                    showToast(docData.message || 'Failed to save documents.', 'error');
                    return false;
                }
                if (docData?.message?.trim()) successMsg = docData.message.trim();
            }
            showToast(successMsg, 'success');
            if (['personal', 'address', 'employment'].includes(sectionName)) {
                setErrors((prev) => ({ ...prev, personalEmail: '' }));
            }
            return true;
        } catch (err) {
            showToast('Failed to save.', 'error');
            return false;
        }
    }, [adminId, formData, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, educationDetails, files, showToast]);

    // --- AVATAR HANDLER ---
    const handleAvatarChange = async (imageBlob, validationError) => {
        if (!imageBlob) {
            if (validationError) showToast(validationError, 'error');
            return;
        }
        setSaveStatus('Uploading Image...');
        const token = localStorage.getItem('token');
        if (!token) {
            showToast('Please log in again.', 'error');
            setSaveStatus('Ready');
            return;
        }
        try {
            const { ok, data } = await postUploadPhoto(imageBlob);
            if (ok && data.success && data.photo_url) {
                const normalizedUrl = normalizePhotoUrl(data.photo_url);
                setCurrentAvatarUrl(`${normalizedUrl}?t=${Date.now()}`);
                setHasEmployeeRecord(true);
                showToast('Profile picture updated successfully.');
                setSaveStatus('Saved!');
                bumpPhotoVersion?.();
                refreshUserData();
                fetchProfile({ silent: true });
            } else {
                showToast(data.message || 'Failed to upload photo.', 'error');
                setSaveStatus('Ready');
            }
        } catch (err) {
            console.error('Photo upload error:', err);
            showToast('Failed to upload photo.', 'error');
            setSaveStatus('Ready');
        }
    };

    // =========================================================
    // 2. MEMOIZED DATA COMPARISON & PROGRESS (Omitted for brevity)
    // =========================================================


    const sectionCompletion = useMemo(
        () =>
            getProfileSectionCompletion(
                showEditCards ? formData : savedData.formData,
                showEditCards ? currentAddress : savedData.currentAddress,
                showEditCards ? permanentAddress : savedData.permanentAddress,
                showEditCards ? sameAsCurrent : savedData.sameAsCurrent,
                showEditCards ? files : savedData.files,
                showEditCards ? previousEmployment : savedData.previousEmployment,
                showEditCards ? educationDetails : savedData.educationDetails || []
            ),
        [
            showEditCards,
            formData,
            currentAddress,
            permanentAddress,
            sameAsCurrent,
            files,
            previousEmployment,
            educationDetails,
            savedData,
        ]
    );

    const profileProgress = sectionCompletion.totalPercent;


    // =========================================================
    // 3. MAIN   (Omitted for brevity)
    // =========================================================

    const handleAccordionToggle = (sectionName) => { setExpandedSection(expandedSection === sectionName ? null : sectionName); };

    const enterEditMode = useCallback((openSection = 'personal') => {
        setFormData(savedData.formData);
        setCurrentAddress(savedData.currentAddress);
        setPermanentAddress(savedData.permanentAddress);
        setSameAsCurrent(savedData.sameAsCurrent);
        setFiles(savedData.files);
        setPreviousEmployment(savedData.previousEmployment);
        setEducationDetails(
            savedData.educationDetails?.length
                ? savedData.educationDetails
                : [
                      {
                          id: Date.now(),
                          qualification: '',
                          institution: '',
                          university: '',
                          fromDate: '',
                          toDate: '',
                          marks: '',
                          certificate: null,
                      },
                  ]
        );
        setShowEditCards(true);
        setExpandedSection(openSection);
        setErrors({});
        setSaveStatus('Ready');
    }, [savedData]);

    const handleEditToggle = () => enterEditMode('personal');

    const handleGoToSection = useCallback(
        (editKey) => {
            enterEditMode(editKey || 'personal');
        },
        [enterEditMode]
    );

    const exitEditMode = useCallback(() => {
        setShowEditCards(false);
        setExpandedSection(null);
        setErrors({});
        setSaveStatus('Ready');
    }, []);

    const hasNoChanges = useCallback(() => {
        const s = savedData;
        const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        if (!eq(formData, s.formData) || !eq(currentAddress, s.currentAddress) || sameAsCurrent !== s.sameAsCurrent) return false;
        const perm = sameAsCurrent ? currentAddress : permanentAddress;
        if (!eq(perm, s.permanentAddress)) return false;
        if (!eq(previousEmployment, s.previousEmployment) || !eq(educationDetails, s.educationDetails)) return false;
        const fileKeys = Object.keys(files || {});
        const savedKeys = Object.keys(s.files || {});
        if (fileKeys.length !== savedKeys.length) return false;
        for (const k of fileKeys) {
            const f = files[k], sf = s.files[k];
            const fStr = typeof f === 'string' ? f : (f?.name ?? '');
            const sfStr = typeof sf === 'string' ? sf : (sf?.name ?? '');
            if (fStr !== sfStr) return false;
        }
        return true;
    }, [formData, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, educationDetails, files, savedData]);

    const handleDoneEditing = useCallback(async () => {
        try {
            if (hasNoChanges()) {
                exitEditMode();
                return;
            }
            const success = await saveCurrentChanges(true);
            if (success) {
                setTimeout(exitEditMode, 350);
            }
        } catch (err) {
            console.error('Done editing failed:', err);
            showToast('Something went wrong. Please try again.', 'error');
        }
    }, [saveCurrentChanges, showToast, hasNoChanges, exitEditMode]);

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
        const target = e?.target ?? e;
        const name = target?.name;
        if (!name) return;
        let value = target?.value ?? '';
        if (['previousCompanyName', 'previousDesignation', 'dateOfLeaving', 'experienceYears'].includes(name)) {
            return;
        }
        if (name === 'mobile' || name === 'emergency') {
            value = String(value).replace(/\D/g, '').slice(0, 10);
        }
        setFormData((prev) => ({ ...prev, [name]: value }));
        setErrors((prev) => ({ ...prev, [name]: '' }));
    };

    const handleFileChange = (name, fileData) => {
        setFiles(prev => ({ ...prev, [name]: fileData }));
        setErrors(prev => ({ ...prev, [name]: '' }));
    };

    const runPincodeLookup = useCallback(
        async (addressType, pin) => {
            const seq = ++pincodeLookupSeq.current[addressType];
            setPincodeLoading((prev) => ({ ...prev, [addressType]: true }));
            const result = await fetchPincodeDetails(pin);
            if (pincodeLookupSeq.current[addressType] !== seq) return;

            setPincodeLoading((prev) => ({ ...prev, [addressType]: false }));

            if (!result.ok) {
                if (result.message) {
                    showToast(result.message, 'error');
                }
                return;
            }

            const { city, district, state } = result.details;
            const isCurrent = addressType === 'current';
            const setter = isCurrent ? setCurrentAddress : setPermanentAddress;
            setter((prev) => ({
                ...prev,
                pincode: pin,
                city: city || prev.city,
                district: district || prev.district,
                state: state || prev.state,
            }));
            if (isCurrent && sameAsCurrent) {
                setPermanentAddress((prev) => ({
                    ...prev,
                    pincode: pin,
                    city: city || prev.city,
                    district: district || prev.district,
                    state: state || prev.state,
                }));
            }
            setErrors((prev) => ({
                ...prev,
                [`${addressType}Pincode`]: '',
                [`${addressType}City`]: '',
                [`${addressType}State`]: '',
                [`${addressType}District`]: '',
            }));
        },
        [sameAsCurrent, showToast]
    );

    const handlePincodeBlur = useCallback(
        (addressType) => {
            const addr = addressType === 'current' ? currentAddress : permanentAddress;
            const pin = String(addr?.pincode || '').replace(/\D/g, '');
            if (pin.length === 6 && (!addr.city?.trim() || !addr.state?.trim())) {
                runPincodeLookup(addressType, pin);
            }
        },
        [currentAddress, permanentAddress, runPincodeLookup]
    );

    const handleAddressChange = (addressType, e) => {
        const { name, value } = e.target;
        const isCurrent = addressType === 'current';
        const setter = isCurrent ? setCurrentAddress : setPermanentAddress;
        const errorKey = `${addressType}${name.charAt(0).toUpperCase() + name.slice(1)}`;
        let finalValue = value;
        if (name === 'pincode') {
            const parts = String(value).split('.');
            finalValue = (parts[0] || '').replace(/\D/g, '').slice(0, 6);
        } else if (name === 'street') {
            finalValue = String(value || '').slice(0, STREET_MAX_LEN);
        } else if (['city', 'district', 'state'].includes(name)) {
            finalValue = String(value || '').slice(0, STATE_DISTRICT_MAX_LEN);
        }
        setter((prev) => ({ ...prev, [name]: finalValue }));
        if (isCurrent && sameAsCurrent) {
            setPermanentAddress((prev) => ({ ...prev, [name]: finalValue }));
        }
        if (name === 'pincode') {
            if (finalValue.length < 6) {
                pincodeLookupSeq.current[addressType] += 1;
                setPincodeLoading((prev) => ({ ...prev, [addressType]: false }));
            } else if (finalValue.length === 6) {
                runPincodeLookup(addressType, finalValue);
            }
        }
        setErrors((prev) => ({ ...prev, [errorKey]: '' }));
    };

    const handleSameAsCurrentToggle = () => {
        setSameAsCurrent(prev => {
            const newState = !prev;
            if (newState) {
                setPermanentAddress(JSON.parse(JSON.stringify(currentAddress)));
            } else {
                setPermanentAddress({ street: '', city: '', state: '', district: '', pincode: '' });
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
        let finalValue = value;
        if (name === 'institution' || name === 'university') {
            finalValue = String(value || '').slice(0, EDU_INST_UNIV_MAX_LEN);
        }
        setEducationDetails(prev => {
            const newArray = [...prev];
            newArray[index] = { ...newArray[index], [name]: finalValue };
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
        'mobileCountryCode',
        'nationality',
        'dateOfBirth',
        'gender',
        'bloodGroup',
        'emergency',
        'emergencyCountryCode',
    ];

    const EMPLOYMENT_KEYS = [];

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
            'gender',
            'emergency'
        ];

        required.forEach(key => {
            if (!formData[key] || formData[key].toString().trim() === '') {
                sectionErrors[key] = `${key} is mandatory.`;
                hasErrors = true;
            }
        });

        const fullNameErr = validateFullName(formData?.fullName);
        if (fullNameErr) { sectionErrors.fullName = fullNameErr; hasErrors = true; }

        const fatherNameErr = validatePersonName(formData?.fatherName, 'Father Name');
        if (fatherNameErr) { sectionErrors.fatherName = fatherNameErr; hasErrors = true; }

        const motherNameVal = formData?.motherName;
        if (motherNameVal && motherNameVal.toString().trim() !== '') {
            const motherNameErr = validatePersonName(motherNameVal, 'Mother Name');
            if (motherNameErr) { sectionErrors.motherName = motherNameErr; hasErrors = true; }
        }

        const dobErr = validateDateOfBirth(formData?.dateOfBirth);
        if (dobErr) { sectionErrors.dateOfBirth = dobErr; hasErrors = true; }

        const emailVal = formData?.personalEmail;
        if (emailVal && emailVal.toString().trim() !== '') {
            if (!isValidEmail(emailVal)) {
                sectionErrors.personalEmail = 'Please enter a valid email address.';
                hasErrors = true;
            }
        }

        const mobileVal = formData.mobile;
        if (mobileVal) {
            if (String(mobileVal).includes('.') || !/^\d*$/.test(String(mobileVal))) {
                sectionErrors.mobile = 'Mobile Number must contain only digits (no decimals).';
                hasErrors = true;
            } else if (String(mobileVal).length !== 10) {
                sectionErrors.mobile = 'Mobile number must be exactly 10 digits.';
                hasErrors = true;
            }
        }

        const emergencyVal = formData.emergency;
        if (emergencyVal) {
            if (String(emergencyVal).includes('.') || !/^\d*$/.test(String(emergencyVal))) {
                sectionErrors.emergency = 'Contact Number must contain only digits (no decimals).';
                hasErrors = true;
            } else if (String(emergencyVal).length !== 10) {
                sectionErrors.emergency = 'Contact number must be exactly 10 digits.';
                hasErrors = true;
            }
        }

        setErrors(prev => ({ ...prev, ...sectionErrors }));
        return !hasErrors;
    };

    const validateAddressSection = () => {
        const sectionErrors = {};
        let hasErrors = false;
        const ADDRESS_MANDATORY_FIELDS = ['street', 'pincode', 'city', 'state', 'district'];

        const validateAddress = (addr, type) => {
            ADDRESS_MANDATORY_FIELDS.forEach(field => {
                const key = `${type}${field.charAt(0).toUpperCase() + field.slice(1)}`;
                const val = addr[field];
                if (!val || val.toString().trim() === '') {
                    sectionErrors[key] = `${field} is mandatory.`;
                    hasErrors = true;
                } else if (field === 'pincode') {
                    const pincodeStr = val ? String(val).trim() : '';
                    if (pincodeStr.length !== 6) {
                        sectionErrors[key] = 'Pincode must be 6 digits.';
                        hasErrors = true;
                    } else if (/\./.test(pincodeStr) || !/^\d+$/.test(pincodeStr)) {
                        sectionErrors[key] = 'Pincode must be 6 digits only (no decimals).';
                        hasErrors = true;
                    }
                } else if (field === 'street' && val.toString().length > STREET_MAX_LEN) {
                    sectionErrors[key] = `Street Address cannot exceed ${STREET_MAX_LEN} characters.`;
                    hasErrors = true;
                } else if (['state', 'district', 'city'].includes(field) && val.toString().length > STATE_DISTRICT_MAX_LEN) {
                    const label = field.charAt(0).toUpperCase() + field.slice(1);
                    sectionErrors[key] = `${label} cannot exceed ${STATE_DISTRICT_MAX_LEN} characters.`;
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
            const qual = (edu.qualification || '').toString().trim();
            const inst = (edu.institution || '').toString().trim();
            const univ = (edu.university || '').toString().trim();
            if (!qual) {
                sectionErrors[`${base}qualification`] = 'Qualification is required.';
                hasErrors = true;
            }
            if (!inst) {
                sectionErrors[`${base}institution`] = 'Institution Name is required.';
                hasErrors = true;
            } else if (inst.length > EDU_INST_UNIV_MAX_LEN) {
                sectionErrors[`${base}institution`] = `Institution Name cannot exceed ${EDU_INST_UNIV_MAX_LEN} characters.`;
                hasErrors = true;
            }
            if (!univ) {
                sectionErrors[`${base}university`] = 'University / Board is required.';
                hasErrors = true;
            } else if (univ.length > EDU_INST_UNIV_MAX_LEN) {
                sectionErrors[`${base}university`] = `University / Board cannot exceed ${EDU_INST_UNIV_MAX_LEN} characters.`;
                hasErrors = true;
            }
            const fromStr = (edu.fromDate || '').toString().trim();
            const toStr = (edu.toDate || '').toString().trim();
            if (!fromStr) {
                sectionErrors[`${base}fromDate`] = 'From date is required.';
                hasErrors = true;
            }
            if (!toStr) {
                sectionErrors[`${base}toDate`] = 'To date is required.';
                hasErrors = true;
            }
            if (fromStr && toStr) {
                const fromD = new Date(fromStr);
                const toD = new Date(toStr);
                if (!isNaN(fromD.getTime()) && !isNaN(toD.getTime()) && fromD > toD) {
                    sectionErrors[`${base}fromDate`] = 'From date cannot be greater than To date.';
                    hasErrors = true;
                }
            }
            const marksStr = (edu.marks || '').toString().trim();
            if (!marksStr) {
                sectionErrors[`${base}marks`] = 'Marks Percentage / CGPA is required.';
                hasErrors = true;
            } else {
                const marksNum = parseFloat(marksStr);
                if (!isNaN(marksNum) && marksNum > 100) {
                    sectionErrors[`${base}marks`] = 'Marks Percentage cannot exceed 100.';
                    hasErrors = true;
                }
            }
        });

        setErrors(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(k => { if (k.startsWith('education_')) delete next[k]; });
            return { ...next, ...sectionErrors };
        });
        if (hasErrors) {
            showToast('Please fix validation errors in education fields.', 'error');
        }
        return !hasErrors;
    };

    const applySectionSavedState = useCallback((sectionName) => {
        switch (sectionName) {
            case 'personal':
                setSavedData((prev) => ({
                    ...prev,
                    formData: {
                        ...prev.formData,
                        ...PERSONAL_KEYS.reduce((acc, key) => {
                            acc[key] = formData[key];
                            return acc;
                        }, {}),
                    },
                }));
                setErrors((prev) => ({ ...prev, designation: '' }));
                break;
            case 'address':
                setSavedData((prev) => ({
                    ...prev,
                    currentAddress,
                    permanentAddress,
                    sameAsCurrent,
                }));
                break;
            case 'employment':
                setSavedData((prev) => ({
                    ...prev,
                    formData: {
                        ...prev.formData,
                        designation: formData.designation,
                    },
                    previousEmployment,
                }));
                break;
            case 'documents':
                setSavedData((prev) => ({ ...prev, files }));
                break;
            case 'education':
                setSavedData((prev) => ({ ...prev, educationDetails }));
                break;
            default:
                break;
        }
    }, [formData, currentAddress, permanentAddress, sameAsCurrent, previousEmployment, files, educationDetails]);

    const handleSectionSave = async (sectionName) => {
        let isValid = true;

        switch (sectionName) {
            case 'personal':
                isValid = validatePersonalSection();
                break;
            case 'address':
                isValid = validateAddressSection();
                break;
            case 'employment':
                isValid = validateEmploymentSection();
                break;
            case 'documents':
                isValid = validateDocumentsSection();
                break;
            case 'education':
                isValid = validateEducationSection();
                if (!isValid) setExpandedSection('education');
                break;
            default:
                break;
        }

        if (!isValid) {
            const msg = SECTION_ERROR_MESSAGES[sectionName] || 'Please fix validation errors before saving.';
            showToast(msg, 'error');
            return false;
        }

        const loadingId = toast.loading('Saving…');
        const ok = await saveSectionToBackend(sectionName);
        toast.dismiss(loadingId);
        if (ok) {
            applySectionSavedState(sectionName);
            if (sectionName === 'employment') {
                await fetchProfile({ silent: true });
            }
        }
        return ok;
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

    if (profileLoading) {
        return (
            <div className="profile-page-container" style={{ ...MODERN_FONT_STYLE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f4f6f9' }}>
                <p>Loading profile...</p>
            </div>
        );
    }
    if (profileError) {
        return (
            <div className="profile-page-container" style={{ ...MODERN_FONT_STYLE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, backgroundColor: '#f4f6f9' }}>
                <p style={{ color: '#b91c1c' }}>{profileError}</p>
            </div>
        );
    }

    if (!showEditCards) {
        // --- VIEW MODE RENDER (ProfileViewLayout) ---
        return (
            <div className="profile-page-container" style={MODERN_FONT_STYLE}>
                <div className="profile-page-inner">
                <ProfileViewLayout
                    data={dataToDisplay}
                    profileProgress={profileProgress}
                    sectionCompletion={sectionCompletion}
                    avatarUrl={currentAvatarUrl}
                    onImageChange={handleAvatarChange}
                    onEditToggle={handleEditToggle}
                    onGoToSection={handleGoToSection}
                />
                </div>
            </div>
        );
    }

    // --- EDIT MODE RENDER (Accordion Layout) ---
    return (
        <div className="profile-page-container profile-page-container--edit" style={MODERN_FONT_STYLE}>
            <div className="profile-page-inner profile-page-inner--edit">
            <header className="profile-edit-toolbar">
                <h2 className="profile-edit-toolbar__title">
                    <span style={GRADIENT_HEADER_STYLE}>Edit profile</span>
                </h2>
                <div className="profile-edit-toolbar__actions">
                    <button
                        type="button"
                        className="profile-edit-btn profile-edit-btn--discard"
                        onClick={handleUndoChanges}
                    >
                        Discard
                    </button>
                    <button
                        type="button"
                        className="profile-edit-btn profile-edit-btn--done"
                        onClick={() => handleDoneEditing().catch(() => {})}
                    >
                        Done
                    </button>
                </div>
            </header>

            <div className="profile-edit-accordion-list">
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
                    pincodeLoading={pincodeLoading}
                    mode={mode}
                    isExpanded={expandedSection === 'address'}
                    onToggle={() => handleAccordionToggle('address')}
                    onAddressChange={handleAddressChange}
                    onPincodeBlur={handlePincodeBlur}
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
                    adminId={adminId}
                    uploadProfileFileUrl={`${API_BASE_URL}/upload-profile-file`}
                    errors={errors}
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
    );
}