import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';
import {Info} from '../common/Info';
import {ProgressCircle} from '../common/ProgressCircle';
import { formatDateForDisplay } from '../../utils/profileUtils';

// Helper function to render data in the grid format (Dashboard-aligned)
const RenderInfoGrid = ({ title, data, sectionMap, cardModifier = '' }) => (
    <div className={`profile-view-card ${cardModifier}`}>
        <h4><span style={GRADIENT_HEADER_STYLE}>{title}</span></h4>
        <div className="grid-3">
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
        <div className="profile-view-wrapper">

            {/* --- Left Column (Summary) --- */}
            <div className="profile-view-left">
                
                {/* 🛑 Renders the Profile Summary Card (now containing the button via prop injection) */}
                {avatarCardComponent}
                
                {/* Profile Completion */}
                <ProgressCircle progressValue={profileProgress} />
            </div>
            
            
            {/* --- Right Column (Details) --- */}
            <div className="profile-view-right">
                
                {/* Personal Details Card */}
                <RenderInfoGrid
                    title="Personal Details - Basic and Contact Information"
                    data={data.formData}
                    sectionMap={personalSectionMap.filter(item => item.key !== 'personalEmail' && item.key !== 'mobile')}
                    cardModifier="profile-view-card--personal"
                />

                {/* Address Details Card (Custom rendering for the long address strings) */}
                <div className="profile-view-card profile-view-card--address">
                    <h4><span style={GRADIENT_HEADER_STYLE}>Address Details</span></h4>
                    <div className="grid-2">
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
                    cardModifier="profile-view-card--employment"
                />
            </div>

        </div>
    );
}