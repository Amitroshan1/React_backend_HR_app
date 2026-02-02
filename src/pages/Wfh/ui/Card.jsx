import React from 'react';
import './Card.css';

export const Card = ({ title, children, className }) => (
  <div className={`card ${className || ''}`}>
    {title && (
      <div className="card__header">
        <h3 className="card__title">{title}</h3>
      </div>
    )}
    <div className="card__body">
      {children}
    </div>
  </div>
);
