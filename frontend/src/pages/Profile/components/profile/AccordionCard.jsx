import React from 'react';

export const AccordionCard = ({ title, subText, children, sectionName, isExpanded, onToggle, showMandatoryError }) => {
    const headerStyle = { 
        margin: 0, 
        color: isExpanded ? '#10b981' : (showMandatoryError ? '#f87d7dff' : '#1f2937') 
    };
    return (
        <div
            className={`accordion-card ${isExpanded ? 'expanded' : 'collapsed'}`}
            data-section-name={sectionName}
            style={{ 
                border: showMandatoryError ? '1px solid #ef4444' : '1px solid #e5e7eb',
            }}
        >
            <div className="accordion-header" onClick={onToggle}>
                <div>
                    <h3 style={headerStyle}>{title}</h3>
                    <p className="sub" style={{ margin: '3px 0 0', color: showMandatoryError ? '#ef4444' : '#6b7280' }}>
                        {subText}
                        {showMandatoryError && (
                            <span style={{ fontWeight: 'bold', marginLeft: '10px' }}>
                                (Mandatory Fields Missing!)
                            </span>
                        )}
                    </p>
                </div>
                <span style={{ fontSize: '20px', transition: 'transform 0.3s' }}>
                    {isExpanded ? '▲' : '▼'}
                </span>
            </div>
            {isExpanded && (
                <div className="accordion-content" style={{ padding: '15px 20px 20px' }}>
                    {children}
                </div>
            )}
        </div>
    );
}