import React from 'react';
import { GRADIENT_HEADER_STYLE } from '../../utils/gradientStyles';

export const AccordionCard = ({ title, subText, children, sectionName, isExpanded, onToggle, showMandatoryError }) => {
    return (
        <div
            className={`accordion-card ${isExpanded ? 'expanded' : 'collapsed'}${showMandatoryError ? ' accordion-card--error' : ''}`}
            data-section-name={sectionName}
        >
            <div className="accordion-header" onClick={onToggle}>
                <div className="accordion-header__text">
                    <h3><span style={GRADIENT_HEADER_STYLE}>{title}</span></h3>
                    <p className="accordion-header__sub">
                        {subText}
                        {showMandatoryError && (
                            <span className="accordion-header__warn"> — required fields missing</span>
                        )}
                    </p>
                </div>
                <span className={`accordion-chevron${isExpanded ? ' accordion-chevron--open' : ''}`} aria-hidden>
                    ▼
                </span>
            </div>
            <div
                className={`accordion-content${isExpanded ? ' accordion-content--open' : ''}`}
                aria-hidden={!isExpanded}
            >
                {isExpanded ? children : null}
            </div>
        </div>
    );
}