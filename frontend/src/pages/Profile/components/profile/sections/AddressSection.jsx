import React from 'react';
import {AccordionCard} from '../AccordionCard';
import {TextArea} from '../../common/TextArea';
import {Input} from '../../common/Input';
import {Info} from '../../common/Info';

/* =========================================================
   ADDRESS BLOCK
========================================================= */
export const AddressBlock = ({
    title,
    data,
    addressType,
    mode,
    onChange,
    errors,
    sameAsCurrent,
    onSameAsCurrentToggle
}) => {
    const isEditMode = mode === 'edit';
    const isCurrent = addressType === 'current';
    const errorPrefix = addressType;

    return (
        <div className={`address-block ${isCurrent ? '' : 'mt-lg'}`}>
            <div className="address-header">
                <h4>{title}</h4>
            </div>

            {isEditMode ? (
                <div className="fade-in">
                    {/* SAME AS CURRENT */}
                    {isCurrent && (
                        <div className="checkbox-row">
                            <input
                                type="checkbox"
                                id="sameAsCurrent"
                                checked={sameAsCurrent}
                                onChange={onSameAsCurrentToggle}
                            />
                            <label htmlFor="sameAsCurrent">
                                Permanent Address is the same as Current Address
                            </label>
                        </div>
                    )}

                    <TextArea
                        label="Street Address"
                        name="street"
                        value={data.street}
                        onChange={(e) => onChange(addressType, e)}
                        readOnly={!isCurrent && sameAsCurrent}
                        error={errors[`${errorPrefix}Street`]}
                        isMandatory
                    />

                    <div className="grid-3 mt-md">
                        <Input
                            label="Pincode"
                            name="pincode"
                            type="number"
                            value={data.pincode}
                            onChange={(e) => onChange(addressType, e)}
                            readOnly={!isCurrent && sameAsCurrent}
                            error={errors[`${errorPrefix}Pincode`]}
                            isMandatory
                        />
                        <Input label="City" name="city" value={data.city} readOnly />
                        <Input label="State" name="state" value={data.state} readOnly />
                        <Input label="District" name="district" value={data.district} readOnly />
                        <Input label="Taluka" name="taluka" value={data.taluka} readOnly />
                    </div>
                </div>
            ) : (
                <div className="fade-in">
                    <Info label="Street Address" value={data.street} />
                    <div className="grid-3 mt-md">
                        <Info label="Pincode" value={data.pincode} />
                        <Info label="City" value={data.city} />
                        <Info label="State" value={data.state} />
                        <Info label="District" value={data.district} />
                        <Info label="Taluka" value={data.taluka} />
                    </div>
                </div>
            )}
        </div>
    );
}

/* =========================================================
   ADDRESS SECTION
========================================================= */
export const AddressSection = ({
    currentAddress,
    permanentAddress,
    sameAsCurrent,
    mode,
    isExpanded,
    onToggle,
    onAddressChange,
    onSameAsCurrentToggle,
    onSave,
    onUndo, // ✅ NEW
    errors
}) => {
    const isEditMode = mode === 'edit';

    const currentMandatoryErrors =
        errors.currentStreet || errors.currentPincode;

    const permanentMandatoryErrors =
        !sameAsCurrent &&
        (errors.permanentStreet || errors.permanentPincode);

    const hasMandatoryErrors =
        isEditMode && (currentMandatoryErrors || permanentMandatoryErrors);

    return (
        <AccordionCard
            title="Address Details"
            subText="Your current and permanent residential details."
            sectionName="address"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasMandatoryErrors}
        >
            <div className={`address-body ${isEditMode ? 'edit-mode' : 'view-mode'}`}>
                <AddressBlock
                    title="Current Address"
                    data={currentAddress}
                    addressType="current"
                    mode={mode}
                    onChange={onAddressChange}
                    errors={errors}
                    sameAsCurrent={sameAsCurrent}
                    onSameAsCurrentToggle={onSameAsCurrentToggle}
                />

                <AddressBlock
                    title="Permanent Address"
                    data={permanentAddress}
                    addressType="permanent"
                    mode={mode}
                    onChange={onAddressChange}
                    errors={errors}
                    sameAsCurrent={sameAsCurrent}
                />

                {/* SAVE + UNDO */}
                {isEditMode && (
                    <div
                        style={{
                            marginTop: '24px',
                            borderTop: '1px solid #eee',
                            paddingTop: '20px',
                            display: 'flex',
                            gap: '12px'
                        }}
                    >
                        <button
                            type="button"
                            onClick={onUndo}
                            className="entry-undo-btn"
                            style={{
                                padding: '10px 22px',
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
                                padding: '12px 24px',
                                background: 'linear-gradient(90deg, #3b82f6 0%, #1d4ed8 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontWeight: '700',
                                fontSize: '16px',
                                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                                flex: 2
                            }}
                        >
                            Save Address Details
                        </button>
                    </div>
                )}
            </div>
        </AccordionCard>
    );
}
