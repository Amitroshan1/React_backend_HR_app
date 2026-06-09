// =========================================================================
// OPTION LISTS, INITIAL DATA, & UTILITY FUNCTIONS
// =========================================================================

import { validateDocumentSection } from './documentIdentity';

export const maritalStatusOptions = ['Single', 'Married', 'Divorced', 'Widowed'];
export const genderOptions = ['Male', 'Female', 'Non-Binary', 'Prefer Not To Say'];
export const bloodGroupOptions = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const nationalityOptions = ['Indian', 'Canadian', 'British', 'US American', 'Australian'];
export const designationOptions = [
     'Test Engineer', 'Senior Test Engineer', 'QA Engineer', 'DT Engineer',
    'Technical Service Engineer', 'Associate Software Engineer', 'Software Engineer', 'Senior Software Engineer',
    'Project Lead', 'Project Manager', 'Vice President-Sales and Operation', 'GM-Electronics Security',
    'Deputy Manager - Operations and Admin', 'Technical Accounts Manager', 'Accounts Manager',
    'Accounts Executive', 'Senior Executive - HR', 'HR Executive', 'Inventory Executive',
    'Office Boy', 'Business Development Management', 'Sales Executive', 'Circle Head',
    'Delivery Head', 'Senior Manager - Auditor', 'Travel Executive', 'Visa Executive', 'Tender Executive',
];
export const qualificationOptions = [
    'High School',
    'Diploma',
    'Bachelor\'s Degree',
    'Master\'s Degree',
    'PhD',
    'Other'
];
// Utility function for deep comparison of two objects/arrays
// Used to check if current edits are different from last saved data.
export function areObjectsEqual(obj1, obj2) {
    if (obj1 === obj2) return true;
    if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
        return obj1 === obj2;
    }

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!keys2.includes(key) || !areObjectsEqual(obj1[key], obj2[key])) {
            return false;
        }
    }

    return true;
}
// --- MANDATORY FIELD LISTS (Used by Validation/Autosave) ---
export const MANDATORY_FORM_FIELDS = [
    'fullName', 'fatherName', 'maritalStatus', 'personalEmail',
    'mobile', 'nationality', 'dateOfBirth', 'gender',
    'designation', 'employeeId', 'department', 'dateOfJoining',
];

export const MANDATORY_FILES_LIST = [
    'aadharFront', 'aadharBack', 'panFront',
    'panBack', 'passbookFront', 'appointmentLetter'
];


const emptyAddress = () => ({
    street: '',
    city: '',
    state: '',
    district: '',
    pincode: '',
});

// Initial data — empty until GET /employee/profile loads
export const initialDataState = {
    formData: {
        fullName: '',
        fatherName: '',
        motherName: '',
        maritalStatus: '',
        gender: '',
        bloodGroup: '',
        personalEmail: '',
        mobile: '',
        mobileCountryCode: '+91',
        emergency: '',
        emergencyCountryCode: '+91',
        nationality: '',
        designation: '',
        dateOfBirth: '',
        employeeId: '',
        department: '',
        dateOfJoining: '',
        employmentType: '',
        reportingManager: '',
        profileImage: null,
    },
    previousEmployment: [],
    educationDetails: [],
    currentAddress: emptyAddress(),
    permanentAddress: emptyAddress(),
    sameAsCurrent: true,
    files: {
        aadharFront: null,
        aadharBack: null,
        panFront: null,
        panBack: null,
        passbookFront: null,
        appointmentLetter: null,
    },
    documentMeta: {
        aadhaarNumber: '',
        panNumber: '',
        bankAccountNumber: '',
        bankName: '',
        bankBranchCode: '',
        ifscCode: '',
    },
};

export const DOCUMENT_FIELD_LABELS = {
    aadharFront: 'Aadhaar (Front)',
    aadharBack: 'Aadhaar (Back)',
    panFront: 'PAN (Front)',
    panBack: 'PAN (Back)',
    passbookFront: 'Bank Passbook (Front)',
    appointmentLetter: 'Appointment Letter',
};

const isFilled = (val) => val != null && String(val).trim() !== '';

const addressMissing = (addr, prefix) => {
    const checks = [
        ['street', `${prefix} street address`],
        ['pincode', `${prefix} pincode`],
        ['city', `${prefix} city`],
        ['state', `${prefix} state`],
        ['district', `${prefix} district`],
    ];
    return checks.filter(([key]) => !isFilled(addr?.[key])).map(([, label]) => label);
};

/**
 * Per-section completion status with human-readable missing hints.
 */
export function getProfileSectionCompletion(
    formData,
    currentAddress,
    permanentAddress,
    sameAsCurrent,
    files,
    previousEmployment,
    educationDetails,
    documentMeta
) {
    const personalRequired = [
        ['fullName', 'Full name'],
        ['fatherName', "Father's name"],
        ['motherName', "Mother's name"],
        ['maritalStatus', 'Marital status'],
        ['personalEmail', 'Personal email'],
        ['mobile', 'Mobile number'],
        ['emergency', 'Emergency contact'],
        ['nationality', 'Nationality'],
        ['dateOfBirth', 'Date of birth'],
        ['gender', 'Gender'],
        ['bloodGroup', 'Blood group'],
    ];
    const personalMissing = personalRequired
        .filter(([key]) => !isFilled(formData?.[key]))
        .map(([, label]) => label);

    const currentMissing = addressMissing(currentAddress, 'Current');
    const permanentMissing = sameAsCurrent
        ? []
        : addressMissing(permanentAddress, 'Permanent');
    const addressMissingAll = [...currentMissing, ...permanentMissing];

    const employmentMissing = [];
    const desig = (formData?.designation || '').trim();
    if (!isFilled(desig) || desig === 'Not Specified') {
        employmentMissing.push('Designation (assigned by HR at signup)');
    }
    if (!isFilled(formData?.employeeId)) {
        employmentMissing.push('Employee ID (assigned by HR)');
    }
    if (!isFilled(formData?.department)) {
        employmentMissing.push('Circle / department (assigned by HR)');
    }
    if (!isFilled(formData?.employmentType)) {
        employmentMissing.push('Employment type (assigned by HR)');
    }
    if (!isFilled(formData?.dateOfJoining)) {
        employmentMissing.push('Date of joining (assigned by HR)');
    }

    (previousEmployment || []).forEach((row, i) => {
        const hasAny =
            isFilled(row?.companyName) ||
            isFilled(row?.designation) ||
            isFilled(row?.dateOfLeaving) ||
            isFilled(row?.experienceYears);
        if (!hasAny) return;
        if (!isFilled(row?.companyName)) {
            employmentMissing.push(`Previous job #${i + 1}: company name`);
        }
        if (!isFilled(row?.designation)) {
            employmentMissing.push(`Previous job #${i + 1}: designation`);
        }
    });

    const eduRows = educationDetails || [];
    const educationMissing = [];
    const activeEdu = eduRows.filter(
        (e) =>
            isFilled(e?.qualification) ||
            isFilled(e?.institution) ||
            isFilled(e?.university) ||
            isFilled(e?.fromDate) ||
            isFilled(e?.toDate) ||
            isFilled(e?.marks)
    );
    if (activeEdu.length === 0) {
        educationMissing.push('Add at least one education record');
    } else {
        activeEdu.forEach((edu, i) => {
            const rowMissing = [];
            if (!isFilled(edu.qualification)) rowMissing.push('qualification');
            if (!isFilled(edu.institution)) rowMissing.push('institution');
            if (!isFilled(edu.university)) rowMissing.push('board/university');
            if (!isFilled(edu.fromDate)) rowMissing.push('start date');
            if (!isFilled(edu.toDate)) rowMissing.push('end date');
            if (!isFilled(edu.marks)) rowMissing.push('marks');
            if (rowMissing.length) {
                educationMissing.push(
                    `Education #${i + 1}: ${rowMissing.join(', ')}`
                );
            }
        });
    }

    const docErrors = validateDocumentSection(files || {}, documentMeta || {});
    const documentsMissing = Object.values(docErrors);

    const sections = [
        {
            id: 'personal',
            navId: 'profile-personal',
            editKey: 'personal',
            label: 'Personal information',
            complete: personalMissing.length === 0,
            missing: personalMissing,
        },
        {
            id: 'address',
            navId: 'profile-address',
            editKey: 'address',
            label: 'Address',
            complete: addressMissingAll.length === 0,
            missing: addressMissingAll,
        },
        {
            id: 'employment',
            navId: 'profile-employment',
            editKey: 'employment',
            label: 'Employment',
            complete: employmentMissing.length === 0,
            missing: employmentMissing,
        },
        {
            id: 'education',
            navId: 'profile-education',
            editKey: 'education',
            label: 'Education',
            complete: educationMissing.length === 0,
            missing: educationMissing,
        },
        {
            id: 'documents',
            navId: 'profile-documents',
            editKey: 'documents',
            label: 'Documents',
            complete: documentsMissing.length === 0,
            missing: documentsMissing,
        },
    ];

    const completeCount = sections.filter((s) => s.complete).length;
    const totalPercent = Math.round((completeCount / sections.length) * 100);

    return { totalPercent, sections };
}

/** @deprecated use getProfileSectionCompletion().totalPercent */
export function calculateProfileCompletion(
    formData,
    currentAddress,
    permanentAddress,
    sameAsCurrent,
    files,
    previousEmployment,
    educationDetails,
    documentMeta
) {
    return getProfileSectionCompletion(
        formData,
        currentAddress,
        permanentAddress,
        sameAsCurrent,
        files,
        previousEmployment,
        educationDetails,
        documentMeta
    ).totalPercent;
}


/** True when admin has assigned both emp_type and circle (department). */
export function hasAdminEmploymentContext(formData) {
    const type = (formData?.employmentType || '').trim();
    const circle = (formData?.department || '').trim();
    return Boolean(type && circle);
}

/** Show reporting manager only after org assignment + manager mapping exists. */
export function shouldShowReportingManager(formData) {
    return (
        hasAdminEmploymentContext(formData)
        && Boolean((formData?.reportingManager || '').trim())
    );
}

/** Normalize admin.doj to YYYY-MM-DD for display inputs. */
export function normalizeAdminDate(value) {
    if (value == null || value === '') return '';
    const s = String(value).trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.split('T')[0];
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (dmy) {
        const [, d, m, y] = dmy;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    try {
        const parsed = new Date(s);
        if (!Number.isNaN(parsed.getTime())) {
            return parsed.toISOString().split('T')[0];
        }
    } catch {
        /* keep */
    }
    return s;
}

/**
 * Formats YYYY-MM-DD date string to MM/DD/YYYY for display.
 */
export function formatDateForDisplay(dateString) {
    try {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US');
    // eslint-disable-next-line no-unused-vars
    } catch (e) {
        return dateString;
    }
}

/** @deprecated Use fetchPincodeDetails from profileApi.js */
export function simulatePincodeLookup(pincode) {
    return { city: '', state: '', district: '' };
}