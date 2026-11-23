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

export const PREV_EMP_MAX_YEARS = 50;
export const PREV_EMP_MIN_CALENDAR_YEAR = 1980;
export const PREV_EMP_MIN_WORKING_AGE = 16;

function isoTodayIST() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

function addYearsIso(iso, years) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const next = new Date(Date.UTC(y + years, m - 1, d));
    if (next.getUTCMonth() !== ((m - 1 + 12) % 12) && next.getUTCDate() !== d) {
        next.setUTCDate(0);
    }
    return next.toISOString().slice(0, 10);
}

export function previousEmploymentDateBounds({ dateOfBirth, dateOfJoining } = {}) {
    const today = isoTodayIST();
    let min = `${PREV_EMP_MIN_CALENDAR_YEAR}-01-01`;
    if (dateOfBirth && /^\d{4}-\d{2}-\d{2}/.test(dateOfBirth)) {
        const workAge = addYearsIso(dateOfBirth.slice(0, 10), PREV_EMP_MIN_WORKING_AGE);
        if (workAge > min) min = workAge;
    }
    let max = today;
    if (dateOfJoining && /^\d{4}-\d{2}-\d{2}/.test(dateOfJoining) && dateOfJoining.slice(0, 10) < max) {
        max = dateOfJoining.slice(0, 10);
    }
    return { min, max };
}

export function parseExperienceYearsInput(raw) {
    const s = String(raw ?? '').trim().replace(',', '.');
    if (!s) return { years: 0, error: null };
    if (/e/i.test(s) || s.includes('+') || !/^\d{1,2}(\.\d)?$/.test(s)) {
        return {
            years: null,
            error: `Experience years must be between 0 and ${PREV_EMP_MAX_YEARS} (one decimal allowed, e.g. 2.5).`,
        };
    }
    const years = Number(s);
    if (!Number.isFinite(years) || years < 0 || years > PREV_EMP_MAX_YEARS) {
        return {
            years: null,
            error: `Experience years must be between 0 and ${PREV_EMP_MAX_YEARS}.`,
        };
    }
    return { years: Math.round(years * 10) / 10, error: null };
}

/** Field errors for one previous-employment row. Empty object if the row is blank. */
export function previousEmploymentRowErrors(row, bounds) {
    const { min, max } = bounds || previousEmploymentDateBounds();
    const hasAny =
        isFilled(row?.companyName) ||
        isFilled(row?.designation) ||
        isFilled(row?.dateOfLeaving) ||
        isFilled(row?.experienceYears);
    if (!hasAny) return {};

    const errors = {};
    if (!isFilled(row?.companyName)) errors.companyName = 'Company name is required.';
    if (!isFilled(row?.designation)) errors.designation = 'Designation is required.';
    const dol = String(row?.dateOfLeaving || '').slice(0, 10);
    if (!dol) {
        errors.dateOfLeaving = 'Date of leaving is required.';
    } else if (dol > max) {
        errors.dateOfLeaving =
            max < isoTodayIST()
                ? 'Date of leaving cannot be after your date of joining this company.'
                : 'Date of leaving cannot be in the future.';
    } else if (dol < min) {
        errors.dateOfLeaving = `Date of leaving cannot be before ${min}.`;
    }
    const { years, error: yearsErr } = parseExperienceYearsInput(row?.experienceYears);
    if (yearsErr) errors.experienceYears = yearsErr;
    else if (dol && !errors.dateOfLeaving && years > 0) {
        const start = addYearsIso(dol, -Math.floor(years));
        if (start < min) {
            errors.experienceYears =
                'Experience years go back before a valid working age. Use at most 50 years.';
        }
    }
    return errors;
}

export function collectPreviousEmploymentErrors(rows, bounds) {
    const out = {};
    (rows || []).forEach((row, index) => {
        const fieldErrors = previousEmploymentRowErrors(row, bounds);
        Object.entries(fieldErrors).forEach(([field, message]) => {
            out[`prevEmp_${index}_${field}`] = message;
            if (field === 'companyName') out[`companyName_${index}`] = message;
        });
    });
    return out;
}

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
        const peErr = previousEmploymentRowErrors(
            row,
            previousEmploymentDateBounds({
                dateOfBirth: formData?.dateOfBirth,
                dateOfJoining: formData?.dateOfJoining,
            }),
        );
        if (peErr.dateOfLeaving) {
            employmentMissing.push(`Previous job #${i + 1}: ${peErr.dateOfLeaving}`);
        }
        if (peErr.experienceYears) {
            employmentMissing.push(`Previous job #${i + 1}: ${peErr.experienceYears}`);
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

export { formatDateForDisplay } from '../../../utils/dateFormat';

/** @deprecated Use fetchPincodeDetails from profileApi.js */
export function simulatePincodeLookup(pincode) {
    return { city: '', state: '', district: '' };
}