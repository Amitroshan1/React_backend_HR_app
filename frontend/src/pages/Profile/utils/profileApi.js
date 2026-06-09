/**
 * Profile API layer — maps UI state ↔ /api/auth backend contracts.
 */
import { initialDataState, normalizeAdminDate } from './profileUtils';
import {
    documentMetaFromApi,
    digitsOnly,
    normalizePan,
    normalizeIfsc,
    normalizeBankBranchCode,
} from './documentIdentity';

export const API_BASE_URL = '/api/auth';

import { DOCUMENT_FIELD_LABELS } from './profileUtils';

export const DOCUMENT_LABELS = DOCUMENT_FIELD_LABELS;

export function normalizePhotoUrl(url) {
    if (!url) return url;
    let path = url;
    if (path.startsWith('/public/')) path = path.replace('/public/', '/');
    if (path.startsWith('http://') || path.startsWith('https://')) {
        try {
            const u = new URL(path);
            path = u.pathname || path;
        } catch {
            /* keep */
        }
    }
    return path;
}

export function mapGenderForBackend(gender) {
    if (!gender) return gender;
    if (gender === 'Prefer Not To Say') return 'prefer_not_to_say';
    return gender;
}

export function mapGenderFromBackend(gender) {
    if (!gender) return gender;
    if (String(gender).toLowerCase() === 'prefer_not_to_say') return 'Prefer Not To Say';
    return gender;
}

function parsePhone(val) {
    if (!val) return { code: '+91', number: '' };
    const str = String(val).trim();
    const match = str.match(/^(\+\d{1,4})\s*(.*)$/);
    if (match) {
        return { code: match[1], number: match[2].replace(/\D/g, '').slice(0, 10) };
    }
    return { code: '+91', number: str.replace(/\D/g, '').slice(0, 10) };
}

/** Map GET /employee/profile → app state shape */
export function mapProfileFromApi(p) {
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
        pincode: emp.present_pincode || '',
    };
    const permAddr = {
        street: emp.permanent_address_line1 || '',
        city: emp.permanent_district || '',
        state: emp.permanent_state || '',
        district: emp.permanent_district || '',
        pincode: emp.permanent_pincode || '',
    };
    const sameAsCurrent = !!(
        emp.present_address_line1 &&
        emp.permanent_address_line1 &&
        emp.present_address_line1 === emp.permanent_address_line1 &&
        emp.present_pincode === emp.permanent_pincode
    );

    const mobileParsed = parsePhone(emp.mobile || admin.mobile || '');
    const emergencyParsed = parsePhone(emp.emergency_mobile || '');

    const form = {
        ...initialDataState.formData,
        fullName: emp.name || admin.first_name || admin.user_name || '',
        fatherName: emp.father_name || '',
        motherName: emp.mother_name || '',
        maritalStatus: emp.marital_status || '',
        personalEmail: emp.email || admin.email || '',
        mobile: String(mobileParsed.number || ''),
        mobileCountryCode: mobileParsed.code || '+91',
        emergency: String(emergencyParsed.number || ''),
        emergencyCountryCode: emergencyParsed.code || '+91',
        nationality: emp.nationality || '',
        dateOfBirth: emp.dob ? String(emp.dob).split('T')[0] : '',
        gender: mapGenderFromBackend(emp.gender) || '',
        bloodGroup: emp.blood_group || '',
        designation: emp.designation || '',
        employeeId: emp.emp_id || admin.emp_id || '',
        department: admin.circle || '',
        dateOfJoining: normalizeAdminDate(admin.doj),
        employmentType: (admin.emp_type || '').trim(),
        reportingManager: (admin.reporting_manager || '').trim(),
    };

    const prevEmp =
        prevList.length > 0
            ? prevList.map((pe) => ({
                  companyName: pe.companyName || pe.com_name || '',
                  designation: pe.designation || '',
                  dateOfLeaving: (pe.dateOfLeaving || pe.dol)
                      ? String(pe.dateOfLeaving || pe.dol).split('T')[0]
                      : '',
                  experienceYears: pe.experienceYears || '',
              }))
            : [];

    const eduDetails =
        eduList.length > 0
            ? eduList.map((e) => ({
                  id: e.id || Date.now() + Math.random(),
                  qualification: e.qualification || '',
                  institution: e.institution || '',
                  university: e.university || e.board || '',
                  fromDate: e.start ? String(e.start).split('T')[0] : '',
                  toDate: e.end ? String(e.end).split('T')[0] : '',
                  marks: e.marks || '',
                  certificate: e.doc_file || null,
              }))
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
              ];

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
        documentMeta: documentMetaFromApi(docs),
        previousEmployment: prevEmp,
        educationDetails: eduDetails,
    };

    const avatarUrl = emp.photo_url ? normalizePhotoUrl(emp.photo_url) : null;

    return {
        adminId: admin.id != null ? String(admin.id) : null,
        saved,
        avatarUrl,
        hasEmployeeRecord: !!p.employee,
    };
}

export function buildEmployeePayload({
    adminId,
    formData,
    currentAddress,
    permanentAddress,
    sameAsCurrent,
}) {
    const permAddr = sameAsCurrent ? currentAddress : permanentAddress;
    const combinePhone = (code, num) =>
        code && num ? `${code} ${num}` : num || '';

    return {
        admin_id: parseInt(adminId, 10),
        name: formData.fullName || '',
        email: formData.personalEmail || '',
        father_name: formData.fatherName || '',
        mother_name: (formData.motherName || '').trim(),
        marital_status: formData.maritalStatus || 'Single',
        dob: formData.dateOfBirth || null,
        emp_id: formData.employeeId || '',
        mobile: combinePhone(formData.mobileCountryCode, formData.mobile),
        gender: mapGenderForBackend(formData.gender) || '',
        emergency_mobile: combinePhone(
            formData.emergencyCountryCode,
            formData.emergency
        ).trim(),
        nationality: formData.nationality || '',
        blood_group: formData.bloodGroup || '',
        designation: formData.designation || '',
        emp_type: (formData.employmentType || '').trim() || null,
        permanent_address_line1: permAddr.street || '',
        permanent_pincode: permAddr.pincode || '',
        permanent_district: permAddr.district || permAddr.city || '',
        permanent_state: permAddr.state || '',
        present_address_line1: currentAddress.street || '',
        present_pincode: currentAddress.pincode || '',
        present_district: currentAddress.district || currentAddress.city || '',
        present_state: currentAddress.state || '',
    };
}

export function buildEducationItems(educationDetails) {
    return (educationDetails || [])
        .filter(
            (edu) =>
                edu &&
                edu.fromDate &&
                edu.toDate &&
                (edu.qualification || edu.institution || edu.university || edu.marks)
        )
        .map((edu) => ({
            qualification: edu.qualification || '',
            institution: edu.institution || '',
            university: edu.university || '',
            fromDate: edu.fromDate,
            toDate: edu.toDate,
            marks: edu.marks || '',
            certificate: typeof edu.certificate === 'string' ? edu.certificate : null,
        }));
}

export function buildDocPayload(adminId, files, documentMeta = {}) {
    const meta = documentMeta || {};
    return {
        admin_id: parseInt(adminId, 10),
        aadhaar_number: digitsOnly(meta.aadhaarNumber, 12) || null,
        pan_number: normalizePan(meta.panNumber) || null,
        bank_account_number: digitsOnly(meta.bankAccountNumber, 18) || null,
        bank_name: String(meta.bankName || '').trim() || null,
        bank_branch_code: normalizeBankBranchCode(meta.bankBranchCode) || null,
        ifsc_code: normalizeIfsc(meta.ifscCode) || null,
        aadhaar_front: typeof files.aadharFront === 'string' ? files.aadharFront : null,
        aadhaar_back: typeof files.aadharBack === 'string' ? files.aadharBack : null,
        pan_front: typeof files.panFront === 'string' ? files.panFront : null,
        pan_back: typeof files.panBack === 'string' ? files.panBack : null,
        appointment_letter:
            typeof files.appointmentLetter === 'string' ? files.appointmentLetter : null,
        passbook_front:
            typeof files.passbookFront === 'string' ? files.passbookFront : null,
    };
}

function authHeaders(json = true) {
    const token = localStorage.getItem('token');
    const h = { Authorization: `Bearer ${token}` };
    if (json) h['Content-Type'] = 'application/json';
    return h;
}

const POSTAL_PINCODE_API = 'https://api.postalpincode.in/pincode';

/** Parse India Post JSON from postalpincode.in */
export function parsePostalPincodePayload(payload) {
    const block = Array.isArray(payload) ? payload[0] : payload;
    if (!block || block.Status !== 'Success') return null;
    const offices = block.PostOffice;
    if (!Array.isArray(offices) || offices.length === 0) return null;

    const office = offices[0];
    const district = String(office.District || '').trim();
    const state = String(office.State || '').trim();
    const city = (
        String(office.Block || '').trim() ||
        String(office.Name || '').trim() ||
        district
    );

    return {
        city: city.slice(0, 100),
        district: district.slice(0, 100),
        state: state.slice(0, 100),
    };
}

/** Fetch city, district, state for a 6-digit Indian pincode. */
export async function fetchPincodeDetails(pincode) {
    const pin = String(pincode || '').replace(/\D/g, '').slice(0, 6);
    if (pin.length !== 6) {
        return { ok: false, message: 'Enter a valid 6-digit pincode' };
    }

    // 1) Direct call from browser (works when Flask server cannot reach the API)
    try {
        const directRes = await fetch(`${POSTAL_PINCODE_API}/${pin}`);
        if (directRes.ok) {
            const payload = await directRes.json();
            const details = parsePostalPincodePayload(payload);
            if (details) {
                return { ok: true, details };
            }
        }
    } catch {
        /* try backend proxy */
    }

    // 2) Backend proxy fallback
    try {
        const res = await fetch(`${API_BASE_URL}/pincode/${pin}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success) {
            return {
                ok: true,
                details: {
                    city: data.city || '',
                    district: data.district || '',
                    state: data.state || '',
                },
            };
        }
        return {
            ok: false,
            message: data.message || 'Pincode not found',
        };
    } catch {
        return { ok: false, message: 'Could not fetch pincode details. Check your connection.' };
    }
}

export async function fetchEmployeeProfile() {
    const res = await fetch(`${API_BASE_URL}/employee/profile`, {
        method: 'GET',
        headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
}

export async function postEmployee(payload) {
    const res = await fetch(`${API_BASE_URL}/employee`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
        return { ok: false, data: { message: 'Session expired. Please log in again.' }, status: 401 };
    }
    if (res.status === 403) {
        return {
            ok: false,
            data: { message: data.message || 'Not authorized to update this profile.' },
            status: 403,
        };
    }
    return { ok: res.ok, data, status: res.status };
}

export async function postEducationReplace(items) {
    const res = await fetch(`${API_BASE_URL}/education-replace`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

export async function postPreviousCompanies(items) {
    const res = await fetch(`${API_BASE_URL}/previous-companies`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ items }),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

export async function postUploadDocs(payload) {
    const res = await fetch(`${API_BASE_URL}/upload-docs`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

export async function postUploadPhoto(blob) {
    const token = localStorage.getItem('token');
    const formData = new FormData();
    formData.append('photo', blob, 'profile.png');
    const res = await fetch(`${API_BASE_URL}/employee/upload-photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
}

/** Document preview URL (paths from upload-profile-file) */
export function documentPreviewUrl(path) {
    if (!path || typeof path !== 'string') return null;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return normalizePhotoUrl(path);
    }
    const clean = path.startsWith('/') ? path.slice(1) : path;
    if (clean.startsWith('static/')) return `/${clean}`;
    return `/static/uploads/${clean}`;
}
