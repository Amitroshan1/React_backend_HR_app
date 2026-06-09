import React from 'react';
import { AccordionCard } from '../AccordionCard';
import { FileUpload } from '../FileUpload';
import { Info } from '../../common/Info';
import {
    isValidAadhaar,
    isValidPan,
    isBankIdentityComplete,
    digitsOnly,
    normalizePan,
    normalizeIfsc,
    normalizeBankBranchCode,
    maskAadhaar,
    maskPan,
    maskBankAccount,
} from '../../../utils/documentIdentity';

const ID_ACCEPT = '.pdf,.jpg,.jpeg,.png';

function IdentityField({ label, name, value, onChange, error, placeholder, maxLength, inputMode, transform }) {
    const handleChange = (e) => {
        let v = e.target.value;
        if (transform) v = transform(v);
        onChange(name, v);
    };
    return (
        <div className="input-box doc-identity-field">
            <label htmlFor={name}>{label}</label>
            <input
                id={name}
                name={name}
                type="text"
                className="form-control"
                value={value || ''}
                onChange={handleChange}
                placeholder={placeholder}
                maxLength={maxLength}
                inputMode={inputMode}
                autoComplete="off"
            />
            {error && <p className="error-text">{error}</p>}
        </div>
    );
}

export const DocumentUploadSection = ({
    files,
    documentMeta,
    mode,
    isExpanded,
    onToggle,
    onFileChange,
    onMetaChange,
    onSave,
    onUndo,
    errors,
    adminId,
    uploadProfileFileUrl,
}) => {
    const isEditMode = mode === 'edit';
    const meta = documentMeta || {};

    const aadhaarReady = isValidAadhaar(meta.aadhaarNumber);
    const panReady = isValidPan(meta.panNumber);
    const bankReady = isBankIdentityComplete(meta);

    const hasSectionErrors = isEditMode && Object.keys(errors || {}).some((k) =>
        [
            'aadhaarNumber', 'aadharFront', 'aadharBack',
            'panNumber', 'panFront', 'panBack',
            'bankAccountNumber', 'bankName', 'bankBranchCode', 'ifscCode', 'passbookFront',
            'appointmentLetter',
        ].includes(k)
    );

    const renderViewFile = (key, label) => {
        const file = files?.[key];
        const displayValue = file
            ? (typeof file === 'string' ? file.split('/').pop() || 'Uploaded' : (file.name || 'Uploaded'))
            : 'Not uploaded';
        return <Info key={key} label={label} value={displayValue} />;
    };

    return (
        <AccordionCard
            title="Accounts Document Upload"
            subText="Enter identity numbers first, then upload matching documents. Appointment letter upload only."
            sectionName="documents"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasSectionErrors}
        >
            <div className="documents-body">
                {/* ── Aadhaar ── */}
                <section className="doc-identity-group">
                    <h4 className="doc-identity-group__title">Aadhaar Card</h4>
                    {isEditMode ? (
                        <IdentityField
                            label="Aadhaar Number"
                            name="aadhaarNumber"
                            value={meta.aadhaarNumber}
                            onChange={onMetaChange}
                            error={errors.aadhaarNumber}
                            placeholder="12-digit Aadhaar number"
                            maxLength={12}
                            inputMode="numeric"
                            transform={(v) => digitsOnly(v, 12)}
                        />
                    ) : (
                        <Info
                            label="Aadhaar Number"
                            value={meta.aadhaarNumber ? maskAadhaar(meta.aadhaarNumber) : '—'}
                        />
                    )}
                    {(aadhaarReady || !isEditMode) && (
                        <div className="grid-2 doc-identity-uploads">
                            {isEditMode ? (
                                <>
                                    <FileUpload
                                        label="Aadhaar Card (Front)"
                                        name="aadharFront"
                                        fileData={files.aadharFront}
                                        onFileChange={onFileChange}
                                        error={errors.aadharFront}
                                        adminId={adminId}
                                        uploadProfileFileUrl={uploadProfileFileUrl}
                                        accept={ID_ACCEPT}
                                    />
                                    <FileUpload
                                        label="Aadhaar Card (Back)"
                                        name="aadharBack"
                                        fileData={files.aadharBack}
                                        onFileChange={onFileChange}
                                        error={errors.aadharBack}
                                        adminId={adminId}
                                        uploadProfileFileUrl={uploadProfileFileUrl}
                                        accept={ID_ACCEPT}
                                    />
                                </>
                            ) : (
                                <>
                                    {renderViewFile('aadharFront', 'Aadhaar (Front)')}
                                    {renderViewFile('aadharBack', 'Aadhaar (Back)')}
                                </>
                            )}
                        </div>
                    )}
                    {isEditMode && !aadhaarReady && (
                        <p className="doc-identity-hint">Enter a valid 12-digit Aadhaar number to unlock uploads.</p>
                    )}
                </section>

                {/* ── PAN ── */}
                <section className="doc-identity-group">
                    <h4 className="doc-identity-group__title">PAN Card</h4>
                    {isEditMode ? (
                        <IdentityField
                            label="PAN Number"
                            name="panNumber"
                            value={meta.panNumber}
                            onChange={onMetaChange}
                            error={errors.panNumber}
                            placeholder="ABCDE1234F"
                            maxLength={10}
                            transform={(v) => normalizePan(v)}
                        />
                    ) : (
                        <Info label="PAN Number" value={meta.panNumber ? maskPan(meta.panNumber) : '—'} />
                    )}
                    {(panReady || !isEditMode) && (
                        <div className="grid-2 doc-identity-uploads">
                            {isEditMode ? (
                                <>
                                    <FileUpload
                                        label="PAN Card (Front)"
                                        name="panFront"
                                        fileData={files.panFront}
                                        onFileChange={onFileChange}
                                        error={errors.panFront}
                                        adminId={adminId}
                                        uploadProfileFileUrl={uploadProfileFileUrl}
                                        accept={ID_ACCEPT}
                                    />
                                    <FileUpload
                                        label="PAN Card (Back)"
                                        name="panBack"
                                        fileData={files.panBack}
                                        onFileChange={onFileChange}
                                        error={errors.panBack}
                                        adminId={adminId}
                                        uploadProfileFileUrl={uploadProfileFileUrl}
                                        accept={ID_ACCEPT}
                                    />
                                </>
                            ) : (
                                <>
                                    {renderViewFile('panFront', 'PAN (Front)')}
                                    {renderViewFile('panBack', 'PAN (Back)')}
                                </>
                            )}
                        </div>
                    )}
                    {isEditMode && !panReady && (
                        <p className="doc-identity-hint">Enter a valid PAN to unlock uploads.</p>
                    )}
                </section>

                {/* ── Bank ── */}
                <section className="doc-identity-group">
                    <h4 className="doc-identity-group__title">Bank Account</h4>
                    {isEditMode ? (
                        <div className="doc-identity-bank-fields">
                            <IdentityField
                                label="Account Number"
                                name="bankAccountNumber"
                                value={meta.bankAccountNumber}
                                onChange={onMetaChange}
                                error={errors.bankAccountNumber}
                                placeholder="9–18 digit account number"
                                maxLength={18}
                                inputMode="numeric"
                                transform={(v) => digitsOnly(v, 18)}
                            />
                            <IdentityField
                                label="Bank Name"
                                name="bankName"
                                value={meta.bankName}
                                onChange={onMetaChange}
                                error={errors.bankName}
                                placeholder="e.g. State Bank of India"
                                maxLength={120}
                            />
                            <IdentityField
                                label="Bank Branch Code"
                                name="bankBranchCode"
                                value={meta.bankBranchCode}
                                onChange={onMetaChange}
                                error={errors.bankBranchCode}
                                placeholder="e.g. 01234"
                                maxLength={20}
                                transform={(v) => normalizeBankBranchCode(v)}
                            />
                            <IdentityField
                                label="IFSC Code"
                                name="ifscCode"
                                value={meta.ifscCode}
                                onChange={onMetaChange}
                                error={errors.ifscCode}
                                placeholder="SBIN0001234"
                                maxLength={11}
                                transform={(v) => normalizeIfsc(v)}
                            />
                        </div>
                    ) : (
                        <>
                            <Info
                                label="Account Number"
                                value={meta.bankAccountNumber ? maskBankAccount(meta.bankAccountNumber) : '—'}
                            />
                            <Info label="Bank Name" value={meta.bankName || '—'} />
                            <Info label="Branch Code" value={meta.bankBranchCode || '—'} />
                            <Info label="IFSC Code" value={meta.ifscCode || '—'} />
                        </>
                    )}
                    {(bankReady || !isEditMode) && (
                        <div className="doc-identity-uploads">
                            {isEditMode ? (
                                <FileUpload
                                    label="Bank Passbook / Cheque (Front)"
                                    name="passbookFront"
                                    fileData={files.passbookFront}
                                    onFileChange={onFileChange}
                                    error={errors.passbookFront}
                                    adminId={adminId}
                                    uploadProfileFileUrl={uploadProfileFileUrl}
                                    accept={ID_ACCEPT}
                                />
                            ) : (
                                renderViewFile('passbookFront', 'Passbook / Cheque (Front)')
                            )}
                        </div>
                    )}
                    {isEditMode && !bankReady && (
                        <p className="doc-identity-hint">Enter account number, bank name, branch code, and IFSC to unlock upload.</p>
                    )}
                </section>

                {/* ── Appointment letter ── */}
                <section className="doc-identity-group">
                    <h4 className="doc-identity-group__title">Appointment Letter</h4>
                    <div className="doc-identity-uploads">
                        {isEditMode ? (
                            <FileUpload
                                label="Appointment Letter"
                                name="appointmentLetter"
                                fileData={files.appointmentLetter}
                                onFileChange={onFileChange}
                                error={errors.appointmentLetter}
                                adminId={adminId}
                                uploadProfileFileUrl={uploadProfileFileUrl}
                                accept={ID_ACCEPT}
                            />
                        ) : (
                            renderViewFile('appointmentLetter', 'Appointment Letter')
                        )}
                    </div>
                </section>

                {isEditMode ? (
                    <div className="section-actions">
                        <button type="button" onClick={onUndo} className="entry-undo-btn">
                            Undo
                        </button>
                        <button type="button" onClick={onSave} className="entry-save-btn">
                            Save Documents
                        </button>
                    </div>
                ) : (
                    <div className="section-view-note">
                        <p>
                            Identity numbers are masked in view mode. Use HR or Accounts panel for full verification if authorized.
                        </p>
                    </div>
                )}
            </div>
        </AccordionCard>
    );
};
