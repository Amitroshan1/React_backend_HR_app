import React from 'react';
import {AccordionCard} from '../AccordionCard';
import {FileUpload} from '../FileUpload';
import {Info} from '../../common/Info';
import { MANDATORY_FILES_LIST } from '../../../utils/profileUtils';

// Document Mapping for Labels
const documentMap = {
    aadharFront: 'Aadhar Card (Front)',
    aadharBack: 'Aadhar Card (Back)',
    panFront: 'PAN Card (Front)',
    panBack: 'PAN Card (Back)',
    passbookFront: 'Bank Passbook/Cheque (Front)',
    appointmentLetter: 'Appointment Letter',
};

export const DocumentUploadSection = ({ 
    files, 
    mode, 
    isExpanded, 
    onToggle, 
    onFileChange, 
    onSave,
    onUndo,      // ✅ NEW
    errors 
}) => {
    const isEditMode = mode === 'edit';

    const renderFileItem = (name, label) => {
        if (isEditMode) {
            return (
                <FileUpload
                    key={name}
                    label={label}
                    name={name}
                    fileData={files[name]}
                    onFileChange={onFileChange}
                    error={errors[name]}
                />
            );
        } else {
            const file = files[name];
            return (
                <Info 
                    key={name}
                    label={label} 
                    value={file ? (file.name || 'Document Uploaded') : 'Not Uploaded'}
                />
            );
        }
    };

    const fileKeys = Object.keys(documentMap);
    const hasMandatoryErrors =
        isEditMode && MANDATORY_FILES_LIST.some(key => errors[key]);

    return (
        <AccordionCard
            title="Accounts Document Upload"
            subText="Please upload clear copies of all required identification and employment documents."
            sectionName="documents"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasMandatoryErrors}
        >
            <div className="grid-2">
                {fileKeys.map(key => renderFileItem(key, documentMap[key]))}
            </div>

            {/* SAVE + UNDO */}
            {isEditMode ? (
                <div
                    style={{
                        marginTop: '28px',
                        borderTop: '1px solid #eee',
                        paddingTop: '20px',
                        display: 'flex',
                        gap: '12px'
                    }}
                >
                    <button
                        type="button"
                        onClick={onUndo}
                        style={{
                            padding: '12px 20px',
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
                            padding: '14px 30px',
                            background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '10px',
                            cursor: 'pointer',
                            fontWeight: '700',
                            fontSize: '16px',
                            boxShadow: '0 6px 15px rgba(59, 130, 246, 0.4)',
                            flex: 2
                        }}
                    >
                        Save Documents
                    </button>
                </div>
            ) : (
                <div style={{ marginTop: '20px', padding: '10px', borderTop: '1px solid #eee' }}>
                    <p style={{ fontSize: '14px', color: '#6b7280' }}>
                        *In view mode, files cannot be previewed directly for security reasons, only their names are listed if uploaded.
                    </p>
                </div>
            )}
        </AccordionCard>
    );
}
