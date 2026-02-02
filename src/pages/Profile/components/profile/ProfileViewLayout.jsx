import React from 'react';
import {Info} from '../common/Info';
import {ProgressCircle} from '../common/ProgressCircle';
import { formatDateForDisplay } from '../../utils/profileUtils';

// Helper function to render data in the grid format of the screenshot
const RenderInfoGrid = ({ title, data, sectionMap }) => (
    <div style={{ marginBottom: '30px', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '20px', backgroundColor: '#fff' }}>
        <h4 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #f0f0f0', paddingBottom: '10px', color: '#1f2937' }}>{title}</h4>
        <div className="grid-3" style={{ gap: '25px 15px' }}>
            {sectionMap.map(({ label, key, formatFn = val => val }) => (
                <Info 
                    key={key} 
                    label={label} 
                    value={formatFn(data[key])} 
                />
            ))}
        </div>
    </div>
);

export const ProfileViewLayout = ({ data, profileProgress, avatarCardComponent }) => {
    
    // --- Data Mapping (Unchanged) ---
    const personalSectionMap = [
        { label: "Full Name", key: "fullName" },
        { label: "Father's Name", key: "fatherName" },
        { label: "Mother's Name", key: "motherName" },
        { label: "Blood Group", key: "bloodGroup" },
        { label: "Nationality", key: "nationality" },
        { label: "Date of Birth", key: "dateOfBirth", formatFn: formatDateForDisplay },
        { label: "Gender", key: "gender" },
        { label: "Marital Status", key: "maritalStatus" },
        { label: "Contact Number", key: "emergency" },
        { label: "Personal Email", key: "personalEmail" },
        { label: "Phone Number", key: "mobile" },
    ];
    
    const employmentSectionMap = [
        { label: "Employee ID", key: "employeeId" },
        { label: "Department", key: "department" },
        { label: "Designation", key: "designation" },
        { label: "Date of Joining", key: "dateOfJoining", formatFn: formatDateForDisplay },
        { label: "Reporting Manager", key: "reportingManager" },
        { label: "Employment Post", key: "employmentType" },
    ];

    return (
        <div
            className="profile-view-wrapper"
            style={{
                display: 'flex',
                gap: '20px',
                padding: '20px',
                width: '100%',
                margin: '0',
                boxSizing: 'border-box',
                flexGrow: 1,
                minHeight: '100%'
            }}
        >

            {/* --- Left Column (Summary) --- */}
            <div style={{ flex: '0 0 350px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                
                {/* 🛑 Renders the Profile Summary Card (now containing the button via prop injection) */}
                {avatarCardComponent}
                
                {/* Profile Completion */}
                <ProgressCircle progressValue={profileProgress} />
            </div>
            
            
            {/* --- Right Column (Details) --- */}
            <div style={{ flex: '1', Width: '700px' }}>
                
                {/* Personal Details Card */}
                <RenderInfoGrid
                    title="Personal Details - Basic and Contact Information"
                    data={data.formData}
                    sectionMap={personalSectionMap.filter(item => item.key !== 'personalEmail' && item.key !== 'mobile')} 
                />

                {/* Address Details Card (Custom rendering for the long address strings) */}
                <div style={{ marginBottom: '30px', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '20px', backgroundColor: '#fff' }}>
                    <h4 style={{ margin: '0 0 15px 0', borderBottom: '1px solid #f0f0f0', paddingBottom: '10px', color: '#1f2937' }}>Address Details</h4>
                    <div className="grid-2" style={{ gap: '25px 15px' }}>
                        <Info 
                            label="Current Address" 
                            value={`${data.currentAddress.street}, ${data.currentAddress.city} - ${data.currentAddress.pincode}`}
                        />
                        <Info 
                            label="Permanent Address" 
                            value={`${data.permanentAddress.street}, ${data.permanentAddress.city} - ${data.permanentAddress.pincode}`}
                        />
                    </div>
                </div>

                {/* Current Employment Details Card */}
                <RenderInfoGrid
                    title="Current Employment Details - Office and Designation Information"
                    data={data.formData}
                    sectionMap={employmentSectionMap}
                />
            </div>

        </div>
    );
}