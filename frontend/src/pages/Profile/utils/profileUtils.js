// =========================================================================
// OPTION LISTS, INITIAL DATA, & UTILITY FUNCTIONS
// =========================================================================

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
    'reportingManager', 'employmentType',
];

export const MANDATORY_FILES_LIST = [
    'aadharFront', 'aadharBack', 'panFront',
    'panBack', 'passbookFront', 'appointmentLetter'
];


// Initial data structure for *Saved* state
export const initialDataState = {
    formData: {
        fullName: 'John Employee', fatherName: 'Mr. David Employee', motherName: 'Mrs. Jane Employee',
        maritalStatus: 'Married', gender: 'Male', bloodGroup: 'O+', personalEmail: 'john.employee@example.com',
        mobile: '+91 9876543210', emergency: '+91 9988776655 (Spouse)', nationality: 'Indian',
        designation: 'Software Engineer', dateOfBirth: '1990-01-01',
        employeeId: 'EMP001', department: 'Engineering', dateOfJoining: '2023-01-15',
        reportingManager: 'Sarah Manager', employmentType: 'Full-Time',
        previousCompanyName: 'Tech Innovators Co.', previousDesignation: 'Junior Developer',
        dateOfLeaving: '2022-12-31',
        experienceYears: '2.5',
        
        // 👇 ADDED PROFILE IMAGE FIELD 👇
        profileImage: null, 
    },
    previousEmployment: [
        {
            companyName: 'Tech Innovators Co.',
            designation: 'Junior Developer',
            dateOfLeaving: '2022-12-31',
            experienceYears: '2.5',
        }
    ],
    currentAddress: {
        street: '123, Main Street,\nNear City Center,\nBuilding 5, Flat 101', city: 'Mumbai', state: 'Maharashtra', district: 'Mumbai Suburban', taluka: 'Andheri', pincode: '400001'
    },
    permanentAddress: {
        street: '123, Main Street,\nNear City Center,\nBuilding 5, Flat 101', city: 'Mumbai', state: 'Maharashtra', district: 'Mumbai Suburban', taluka: 'Andheri', pincode: '400001'
    },
    sameAsCurrent: true,
    files: {
        aadharFront: null, aadharBack: null, panFront: null,
        panBack: null, passbookFront: null, appointmentLetter: null
    }
}

/**
 * Calculates a detailed profile completion percentage.
 */
export function calculateProfileCompletion(formData, currentAddress, permanentAddress, sameAsCurrent, files, previousEmployment, educationDetails) {
    let totalScore = 0;
    const sectionWeight = 20; // Each section = 20%

    // 1. Personal Info (formData)
    const personalFields = ['fullName', 'fatherName', 'maritalStatus', 'personalEmail', 'mobile', 'dateOfBirth', 'gender'];
    let personalFilled = personalFields.every(field => formData[field] && formData[field].toString().trim() !== '');
    if(personalFilled) totalScore += sectionWeight;

    // 2. Address
    const addressFields = ['street', 'pincode', 'city', 'state', 'district', 'taluka'];
    let currentAddressFilled = addressFields.every(f => currentAddress[f] && currentAddress[f].toString().trim() !== '');
    let permanentAddressFilled = sameAsCurrent ? true : addressFields.every(f => permanentAddress[f] && permanentAddress[f].toString().trim() !== '');
    if(currentAddressFilled && permanentAddressFilled) totalScore += sectionWeight;

    // 3. Employment
    let employmentFilled = previousEmployment.length > 0 && previousEmployment.every(emp => emp.companyName && emp.designation);
    if(employmentFilled) totalScore += sectionWeight;

    // 4. Education
    let educationFilled = educationDetails.length > 0 && educationDetails.every(edu => edu.qualification && edu.institution && edu.university && edu.fromDate && edu.toDate && edu.marks);
    if(educationFilled) totalScore += sectionWeight;

    // 5. Documents
    let docsFilled = Object.values(files).every(f => f !== null && f !== '');
    if(docsFilled) totalScore += sectionWeight;

    return totalScore; // Returns 0 - 100
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

/**
 * Simulates an API call to look up address details based on a pincode.
 */
export function simulatePincodeLookup(pincode) {
    const addressMap = {
        '400001': { city: 'Mumbai', state: 'Maharashtra', district: 'Mumbai Suburban', taluka: 'Andheri' },
        '400706': { city: 'Navi Mumbai', state: 'Maharashtra', district: 'Thane', taluka: 'Vashi' },
        '110001': { city: 'New Delhi', state: 'Delhi', district: 'Central Delhi', taluka: 'Kotwali' },
        '560001': { city: 'Bengaluru', state: 'Karnataka', district: 'Bengaluru Urban', taluka: 'Bengaluru North' },
        '700001': { city: 'Kolkata', state: 'West Bengal', district: 'Kolkata', taluka: 'Kolkata Central' },
        '411001': { city: 'Pune', state: 'Maharashtra', district: 'Pune', taluka: 'Shivajinagar' },
        '600001': { city: 'Chennai', state: 'Tamil Nadu', district: 'Chennai', taluka: 'George Town' },
        '500001': { city: 'Hyderabad', state: 'Telangana', district: 'Hyderabad', taluka: 'Secunderabad' },
    };

    return addressMap[pincode] || { city: '', state: '', district: '', taluka: '' };

    
}