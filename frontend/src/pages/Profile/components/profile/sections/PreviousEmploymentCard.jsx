import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import {Input} from '../../common/Input';
import { previousEmploymentDateBounds } from '../../../utils/profileUtils';

export const PreviousEmploymentCard = ({
    index,
    employmentData,
    onChange,
    onRemove,
    errors,
    dateOfBirth,
    dateOfJoining,
}) => {
    const dateBounds = previousEmploymentDateBounds({ dateOfBirth, dateOfJoining });
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        onChange(index, name, value);
    };

    return (
        <div className="previous-employment-card">
            <div className="previous-employment-card-header">
                <h4><span style={GRADIENT_HEADER_STYLE}>Company #{index + 1}</span></h4>
                <button
                    onClick={() => onRemove(index)}
                    className="remove-btn"
                >
                    Remove
                </button>
            </div>

            <div className="grid-2">
                <Input
                    label="Company Name"
                    name="companyName"
                    value={employmentData.companyName}
                    onChange={handleInputChange}
                    error={errors[`prevEmp_${index}_companyName`] || errors[`companyName_${index}`]}
                />
                <Input
                    label="Designation"
                    name="designation"
                    value={employmentData.designation}
                    onChange={handleInputChange}
                    error={errors[`prevEmp_${index}_designation`]}
                />
                <Input
                    label="Date of Leaving"
                    name="dateOfLeaving"
                    type="date"
                    value={employmentData.dateOfLeaving}
                    onChange={handleInputChange}
                    error={errors[`prevEmp_${index}_dateOfLeaving`]}
                    min={dateBounds.min}
                    max={dateBounds.max}
                />
                <Input
                    label="Experience (Years)"
                    name="experienceYears"
                    type="number"
                    min={0}
                    max={50}
                    step={0.1}
                    value={employmentData.experienceYears}
                    onChange={handleInputChange}
                    error={errors[`prevEmp_${index}_experienceYears`]}
                    helpText="0 to 50 years, one decimal (e.g. 2.5)"
                />
            </div>
        </div>
    );
}