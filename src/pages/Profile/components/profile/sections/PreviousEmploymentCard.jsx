import {Input} from '../../common/Input';

export const PreviousEmploymentCard = ({ index, employmentData, onChange, onRemove, errors }) => {
    const handleInputChange = (e) => {
        const { name, value } = e.target;
        onChange(index, name, value);
    };

    return (
        <div className="previous-employment-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{ margin: '0 0 15px 0', color: '#1f2937' }}>Company #{index + 1}</h4>
                <button
                    onClick={() => onRemove(index)}
                    className="remove-btn"
                    style={{ background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
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