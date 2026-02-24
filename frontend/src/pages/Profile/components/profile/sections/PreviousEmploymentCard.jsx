import { GRADIENT_HEADER_STYLE } from '../../../utils/gradientStyles';
import {Input} from '../../common/Input';

export const PreviousEmploymentCard = ({ index, employmentData, onChange, onRemove, errors }) => {
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
                    error={errors[`companyName_${index}`]} // Specific error key
                />
                <Input
                    label="Designation"
                    name="designation"
                    value={employmentData.designation}
                    onChange={handleInputChange}
                />
                <Input
                    label="Date of Leaving"
                    name="dateOfLeaving"
                    type="date"
                    value={employmentData.dateOfLeaving}
                    onChange={handleInputChange}
                />
                <Input
                    label="Experience (Years)"
                    name="experienceYears"
                    value={employmentData.experienceYears}
                    onChange={handleInputChange}
                />
            </div>
        </div>
    );
}