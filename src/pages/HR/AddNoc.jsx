import React, { useState } from 'react';
import { ArrowLeft, Search, Upload, CheckCircle } from 'lucide-react';
import './AddNoc.css';

export const AddNoc = ({ onBack }) => {
  // Dynamic data matching your reference image rows
  const [nocData, setNocData] = useState([
    { id: 1, name: 'Name', date: 'date', value: 20, status: 'pending' },
    { id: 1, name: 'Prajakta C.P.', date: 'date', value: 50, status: 'pending' },
    { id: 2, name: 'Amit Kumar', date: 'value', value: 15, status: 'pending' },
    { id: 3, name: 'Amit Kumar', date: 'Phacter', value: 15, status: 'pending' },
    { id: 4, name: 'Neha Phatak', date: 'file', value: 15, status: 'pending' },
    { id: 8, name: 'Neha Phatak', date: 'file', value: 50, status: 'pending' },
    { id: 11, name: 'Oonyroutim', date: '', value: 15, status: 'uploaded' },
    { id: 10, name: 'Ensplione', date: '', value: 14, status: 'pending' },
    { id: 10, name: 'Encrtable', date: '', value: 14, status: 'uploaded' },
  ]);

  return (
    <div className="noc-info-wrapper">
      <div className="noc-info-container">
        {/* Top Navigation Tab */}
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="noc-info-card">
          <div className="noc-info-header">
            <h2>NOC INFORMATION</h2>
            <div className="header-actions">
              <Search size={20} className="header-icon" />
              <div className="upload-circle">
                <Upload size={18} />
              </div>
            </div>
          </div>

          <div className="table-responsive-container">
            <table className="noc-dynamic-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>NOC Date</th>
                  <th>Upload NOC</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {nocData.map((item, index) => (
                  <tr key={index}>
                    <td className="name-col">
                      <span className="row-number">{item.id}</span> {item.name}
                    </td>
                    <td>
                      {item.date === 'file' ? (
                        <button className="btn-choose-file">Choose File</button>
                      ) : (
                        <input 
                          type="text" 
                          className="table-input" 
                          placeholder={item.date || ""} 
                          disabled={!item.date}
                        />
                      )}
                    </td>
                    <td className="value-col">{item.value}</td>
                    <td>
                      {item.status === 'uploaded' ? (
                        <button className="btn-status-uploaded">Uploaded</button>
                      ) : (
                        <button className="btn-action-upload">
                          <Upload size={16} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

