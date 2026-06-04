import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import { AccordionCard } from '../AccordionCard';
import { TextArea } from '../../common/TextArea';
import { Input } from '../../common/Input';
import { Info } from '../../common/Info';

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
    onSameAsCurrentToggle,
    onPincodeBlur,
    pincodeLoading = false,
}) => {
    const isEditMode = mode === 'edit';
    const isCurrent = addressType === 'current';
    const errorPrefix = addressType;
    const readOnly = !isCurrent && sameAsCurrent;

    return (
        <div className={`address-block ${isCurrent ? 'address-block--current' : 'address-block--permanent'}`}>
            <h4 className="address-block__title">
                <span style={GRADIENT_HEADER_STYLE}>{title}</span>
            </h4>

            {isEditMode ? (
                <div className="address-block__form">
                    {isCurrent && (
                        <label className="address-same-checkbox">
                            <input
                                type="checkbox"
                                id="sameAsCurrent"
                                checked={sameAsCurrent}
                                onChange={onSameAsCurrentToggle}
                            />
                            <span>Permanent address is the same as current address</span>
                        </label>
                    )}

                    <TextArea
                        label="Street address"
                        name="street"
                        value={data.street}
                        onChange={(e) => onChange(addressType, e)}
                        readOnly={readOnly}
                        error={errors[`${errorPrefix}Street`]}
                        isMandatory
                        maxLength={400}
                    />

                    <div className="address-fields-row">
                        <div className="address-fields-row__pincode">
                            <Input
                                label="Pincode"
                                name="pincode"
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={6}
                                value={data.pincode}
                                onChange={(e) => onChange(addressType, e)}
                                onBlur={() => onPincodeBlur?.(addressType)}
                                readOnly={readOnly}
                                error={errors[`${errorPrefix}Pincode`]}
                                isMandatory
                            />
                            {pincodeLoading && (
                                <span className="pincode-lookup-hint" role="status">
                                    Looking up…
                                </span>
                            )}
                        </div>
                        <Input
                            label="City"
                            name="city"
                            value={data.city}
                            onChange={(e) => onChange(addressType, e)}
                            readOnly={readOnly}
                            error={errors[`${errorPrefix}City`]}
                            maxLength={100}
                        />
                        <Input
                            label="District"
                            name="district"
                            value={data.district}
                            onChange={(e) => onChange(addressType, e)}
                            readOnly={readOnly}
                            error={errors[`${errorPrefix}District`]}
                            maxLength={100}
                        />
                        <Input
                            label="State"
                            name="state"
                            value={data.state}
                            onChange={(e) => onChange(addressType, e)}
                            readOnly={readOnly}
                            error={errors[`${errorPrefix}State`]}
                            maxLength={100}
                        />
                    </div>
                </div>
            ) : (
                <div className="address-block__view">
                    <Info label="Street address" value={data.street} />
                    <div className="address-view-grid">
                        <Info label="Pincode" value={data.pincode} />
                        <Info label="City" value={data.city} />
                        <Info label="District" value={data.district} />
                        <Info label="State" value={data.state} />
                    </div>
                </div>
            )}
        </div>
    );
};

/* =========================================================
   ADDRESS SECTION
========================================================= */
export const AddressSection = ({
    currentAddress,
    permanentAddress,
    sameAsCurrent,
    pincodeLoading = { current: false, permanent: false },
    mode,
    isExpanded,
    onToggle,
    onAddressChange,
    onSameAsCurrentToggle,
    onPincodeBlur,
    onSave,
    onUndo,
    errors,
}) => {
    const isEditMode = mode === 'edit';

    const currentMandatoryErrors =
        errors.currentStreet || errors.currentPincode;

    const permanentMandatoryErrors =
        !sameAsCurrent && (errors.permanentStreet || errors.permanentPincode);

    const hasMandatoryErrors =
        isEditMode && (currentMandatoryErrors || permanentMandatoryErrors);

    return (
        <AccordionCard
            title="Address details"
            subText="Current and permanent residential address"
            sectionName="address"
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasMandatoryErrors}
        >
            <div className={`address-body ${isEditMode ? 'address-body--edit' : ''}`}>
                <AddressBlock
                    title="Current address"
                    data={currentAddress}
                    addressType="current"
                    mode={mode}
                    onChange={onAddressChange}
                    errors={errors}
                    sameAsCurrent={sameAsCurrent}
                    onSameAsCurrentToggle={onSameAsCurrentToggle}
                    onPincodeBlur={onPincodeBlur}
                    pincodeLoading={pincodeLoading.current}
                />

                <AddressBlock
                    title="Permanent address"
                    data={permanentAddress}
                    addressType="permanent"
                    mode={mode}
                    onChange={onAddressChange}
                    errors={errors}
                    sameAsCurrent={sameAsCurrent}
                    onPincodeBlur={onPincodeBlur}
                    pincodeLoading={pincodeLoading.permanent}
                />

                {isEditMode && (
                    <div className="section-actions address-section-actions">
                        <button type="button" onClick={onUndo} className="entry-undo-btn">
                            Undo
                        </button>
                        <button type="button" onClick={onSave} className="entry-save-btn">
                            Save address
                        </button>
                    </div>
                )}
            </div>
        </AccordionCard>
    );
};
