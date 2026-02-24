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
    onUndo,
    errors,
    adminId,
    uploadProfileFileUrl
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
                    adminId={adminId}
                    uploadProfileFileUrl={uploadProfileFileUrl}
                />
            );
        } else {
            const file = files[name];
            const displayValue = file
                ? (typeof file === 'string' ? file.split('/').pop() || 'Document Uploaded' : (file.name || 'Document Uploaded'))
                : 'Not Uploaded';
            return (
                <Info key={name} label={label} value={displayValue} />
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
            <div className="documents-body">
                <div className="grid-2">
                    {fileKeys.map(key => renderFileItem(key, documentMap[key]))}
                </div>

                {/* SAVE + UNDO */}
                {isEditMode ? (
                    <div className="section-actions">
                        <button
                            type="button"
                            onClick={onUndo}
                            className="entry-undo-btn"
                        >
                            Undo
                        </button>
                        <button
                            type="button"
                            onClick={onSave}
                            className="entry-save-btn"
                        >
                            Save Documents
                        </button>
                    </div>
                ) : (
                    <div className="section-view-note">
                        <p>
                            *In view mode, files cannot be previewed directly for security reasons, only their names are listed if uploaded.
                        </p>
                    </div>
                )}
            </div>
        </AccordionCard>
    );
}
