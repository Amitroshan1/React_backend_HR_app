import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import PropTypes from 'prop-types';
import {AccordionCard} from '../AccordionCard';
import {Input} from '../../common/Input';
import {Button} from '../../common/Button'; // Assuming Button is available
import {Info} from '../../common/Info'; // Assuming Info is available

// Helper for displaying a single previous employment entry in view mode
const ViewEmploymentEntry = ({ entry, index }) => (
    <div key={index} className="view-grid" style={{ borderBottom: '1px solid #eee', paddingBottom: '10px', marginBottom: '10px' }}>
        <h4 style={{ gridColumn: 'span 3' }}><span style={GRADIENT_HEADER_STYLE}>Employment #{index + 1}</span></h4>
        <Info label="Company Name" value={entry.companyName} />
        <Info label="Designation" value={entry.designation} />
        <Info label="Date of Leaving" value={entry.dateOfLeaving} />
        <Info label="Experience (Years)" value={entry.experienceYears} />
    </div>
);

// Main Component
export const PreviousEmploymentSection = ({
    prevEmpData, // Array of previous employment objects
    mode,
    isExpanded,
    onToggle,
    onPrevEmpChange,
    onAddPrevEmp,
    onRemovePrevEmp,
    errors,
}) => {
    const isEditMode = mode === 'edit';
    const sectionName = 'previousEmployment';

    // Check for validation errors on any field within this section
    const hasErrors = prevEmpData.some((_, index) => 
        errors[`prevEmp_${index}_companyName`] ||
        errors[`prevEmp_${index}_designation`] ||
        errors[`prevEmp_${index}_dateOfLeaving`] ||
        errors[`prevEmp_${index}_experienceYears`]
    );

    const content = prevEmpData.length === 0 && !isEditMode ? (
        <Info label="Previous Employment" value="No previous employment records added." />
    ) : (
        prevEmpData.map((entry, index) => {
            const indexPrefix = `prevEmp_${index}_`;
            
            if (isEditMode) {
                return (
                    <div key={index} className="previous-employment-entry" style={{ 
                        border: '1px solid #ddd', 
                        padding: '15px', 
                        marginBottom: '15px', 
                        borderRadius: '4px' 
                    }}>
                        <h4 style={{ marginBottom: '15px', borderBottom: '1px solid #eee', paddingBottom: '10px' }}><span style={GRADIENT_HEADER_STYLE}>Employment Record {index + 1}</span></h4>
                        
                        <div className="grid-3" style={{ gridTemplateColumns: '1fr 1fr auto' }}>
                            <Input 
                                label="Company Name" 
                                name="companyName" 
                                value={entry.companyName} 
                                onChange={(e) => onPrevEmpChange(index, e.target.name, e.target.value)}
                                error={errors[`${indexPrefix}companyName`]}
                            />
                            <Input 
                                label="Designation" 
                                name="designation" 
                                value={entry.designation} 
                                onChange={(e) => onPrevEmpChange(index, e.target.name, e.target.value)}
                                error={errors[`${indexPrefix}designation`]}
                            />
                            <div style={{ alignSelf: 'flex-end', paddingTop: '5px' }}>
                                <Button 
                                    variant="danger" 
                                    onClick={() => onRemovePrevEmp(index)} 
                                    style={{ padding: '8px 15px' }}
                                >
                                    Remove
                                </Button>
                            </div>
                            
                            <Input 
                                label="Date of Leaving" 
                                name="dateOfLeaving" 
                                type="date"
                                value={entry.dateOfLeaving} 
                                onChange={(e) => onPrevEmpChange(index, e.target.name, e.target.value)}
                                error={errors[`${indexPrefix}dateOfLeaving`]}
                            />
                            <Input 
                                label="Experience (Years)" 
                                name="experienceYears" 
                                type="number"
                                value={entry.experienceYears} 
                                onChange={(e) => onPrevEmpChange(index, e.target.name, e.target.value)}
                                error={errors[`${indexPrefix}experienceYears`]}
                            />
                            <div/> {/* Spacer */}
                        </div>
                    </div>
                );
            } else {
                return <ViewEmploymentEntry key={index} entry={entry} index={index} />;
            }
        })
    );

    return (
        <AccordionCard
            title="Previous Employment History"
            subText="List your previous work experience and designations."
            sectionName={sectionName}
            isExpanded={isExpanded}
            onToggle={onToggle}
            showMandatoryError={hasErrors}
        >
            {content}

            {isEditMode && (
                <div style={{ marginTop: prevEmpData.length > 0 ? '10px' : '0' }}>
                    <Button variant="secondary" onClick={onAddPrevEmp}>
                        + Add Previous Employment
                    </Button>
                </div>
            )}
        </AccordionCard>
    );
}

PreviousEmploymentSection.propTypes = {
    prevEmpData: PropTypes.arrayOf(PropTypes.shape({
        companyName: PropTypes.string.isRequired,
        designation: PropTypes.string.isRequired,
        dateOfLeaving: PropTypes.string.isRequired,
        experienceYears: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
    })).isRequired,
    mode: PropTypes.oneOf(['view', 'edit']).isRequired,
    isExpanded: PropTypes.bool.isRequired,
    onToggle: PropTypes.func.isRequired,
    onPrevEmpChange: PropTypes.func.isRequired,
    onAddPrevEmp: PropTypes.func.isRequired,
    onRemovePrevEmp: PropTypes.func.isRequired,
    errors: PropTypes.object.isRequired,
};