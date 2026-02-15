import React, { useState, useEffect } from 'react';
import { Plus, Trash2, X, ArrowLeft } from 'lucide-react';
import './AddDeptCircle.css';

const AddDeptCircle = ({ onBack }) => {
  const [departments, setDepartments] = useState([]);
  const [circles, setCircles] = useState([]);
  
  const [showDeptForm, setShowDeptForm] = useState(false);
  const [showCircleForm, setShowCircleForm] = useState(false);
  
  const [deptName, setDeptName] = useState('');
  const [circleName, setCircleName] = useState('');

  // Load data from localStorage on component mount
  useEffect(() => {
    const savedDepartments = localStorage.getItem('departments');
    const savedCircles = localStorage.getItem('circles');
    
    if (savedDepartments) {
      try {
        setDepartments(JSON.parse(savedDepartments));
      } catch (error) {
        console.error('Error loading departments:', error);
      }
    }
    
    if (savedCircles) {
      try {
        setCircles(JSON.parse(savedCircles));
      } catch (error) {
        console.error('Error loading circles:', error);
      }
    }
    
    // TODO: API call to fetch departments from backend
    // axios.get('/api/departments')
    //   .then(response => setDepartments(response.data))
    //   .catch(error => console.error('Error fetching departments:', error));
    
    // TODO: API call to fetch circles from backend
    // axios.get('/api/circles')
    //   .then(response => setCircles(response.data))
    //   .catch(error => console.error('Error fetching circles:', error));
  }, []);

  // Handle Add Department button click
  const handleAddDeptClick = () => {
    setShowDeptForm(true);
    setShowCircleForm(false);
    setDeptName('');
  };

  // Handle Add Circle button click
  const handleAddCircleClick = () => {
    setShowCircleForm(true);
    setShowDeptForm(false);
    setCircleName('');
  };

  // Handle Department form submission
  const handleDeptSubmit = (e) => {
    e.preventDefault();
    
    if (deptName.trim() === '') {
      alert('Please enter a department name');
      return;
    }

    // Check for duplicate
    if (departments.some(dept => dept.name.toLowerCase() === deptName.trim().toLowerCase())) {
      alert('This department already exists');
      return;
    }

    const newDepartment = {
      id: Date.now(),
      name: deptName.trim()
    };

    const updatedDepartments = [...departments, newDepartment];
    setDepartments(updatedDepartments);
    
    // Save to localStorage
    localStorage.setItem('departments', JSON.stringify(updatedDepartments));
    
    // TODO: API call to save department to backend
    // axios.post('/api/departments', newDepartment)
    //   .then(response => {
    //     console.log('Department saved:', response.data);
    //   })
    //   .catch(error => {
    //     console.error('Error saving department:', error);
    //     // Rollback on error
    //     setDepartments(departments);
    //   });

    // Reset form
    setDeptName('');
    setShowDeptForm(false);
  };

  // Handle Circle form submission
  const handleCircleSubmit = (e) => {
    e.preventDefault();
    
    if (circleName.trim() === '') {
      alert('Please enter a circle name');
      return;
    }

    // Check for duplicate
    if (circles.some(circle => circle.name.toLowerCase() === circleName.trim().toLowerCase())) {
      alert('This circle already exists');
      return;
    }

    const newCircle = {
      id: Date.now(),
      name: circleName.trim()
    };

    const updatedCircles = [...circles, newCircle];
    setCircles(updatedCircles);
    
    // Save to localStorage
    localStorage.setItem('circles', JSON.stringify(updatedCircles));
    
    // TODO: API call to save circle to backend
    // axios.post('/api/circles', newCircle)
    //   .then(response => {
    //     console.log('Circle saved:', response.data);
    //   })
    //   .catch(error => {
    //     console.error('Error saving circle:', error);
    //     // Rollback on error
    //     setCircles(circles);
    //   });

    // Reset form
    setCircleName('');
    setShowCircleForm(false);
  };

  // Handle Department removal
  const handleRemoveDept = (deptId) => {
    if (window.confirm('Are you sure you want to remove this department?')) {
      const updatedDepartments = departments.filter(dept => dept.id !== deptId);
      setDepartments(updatedDepartments);
      
      // Update localStorage
      localStorage.setItem('departments', JSON.stringify(updatedDepartments));
      
      // TODO: API call to delete department from backend
      // axios.delete(`/api/departments/${deptId}`)
      //   .then(response => {
      //     console.log('Department deleted:', response.data);
      //   })
      //   .catch(error => {
      //     console.error('Error deleting department:', error);
      //     // Rollback on error
      //     setDepartments(departments);
      //   });
    }
  };

  // Handle Circle removal
  const handleRemoveCircle = (circleId) => {
    if (window.confirm('Are you sure you want to remove this circle?')) {
      const updatedCircles = circles.filter(circle => circle.id !== circleId);
      setCircles(updatedCircles);
      
      // Update localStorage
      localStorage.setItem('circles', JSON.stringify(updatedCircles));
      
      // TODO: API call to delete circle from backend
      // axios.delete(`/api/circles/${circleId}`)
      //   .then(response => {
      //     console.log('Circle deleted:', response.data);
      //   })
      //   .catch(error => {
      //     console.error('Error deleting circle:', error);
      //     // Rollback on error
      //     setCircles(circles);
      //   });
    }
  };

  // Handle form cancel
  const handleCancel = () => {
    setShowDeptForm(false);
    setShowCircleForm(false);
    setDeptName('');
    setCircleName('');
  };

  return (
    <div className="add-dept-circle-container">
      <div className="add-dept-circle-wrapper">
        {/* Back Button */}
        {onBack && (
          <button className="btn-back-updates" onClick={onBack}>
            <ArrowLeft size={16} /> Back to Updates
          </button>
        )}
        
        {/* Page Heading */}
        <div className="page-header">
          <h1 className="page-heading">Department & Circle Management</h1>
        </div>

        {/* Action Buttons */}
        <div className="action-buttons">
          <button 
            className="add-button add-dept-button" 
            onClick={handleAddDeptClick}
          >
            <Plus size={20} />
            Add Department
          </button>
          <button 
            className="add-button add-circle-button" 
            onClick={handleAddCircleClick}
          >
            <Plus size={20} />
            Add Circle
          </button>
        </div>

        {/* Forms Section */}
        {(showDeptForm || showCircleForm) && (
          <div className="form-container">
            {showDeptForm && (
              <form className="input-form" onSubmit={handleDeptSubmit}>
                <div className="form-header">
                  <h3>Add New Department</h3>
                  <button 
                    type="button" 
                    className="close-button" 
                    onClick={handleCancel}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="form-body">
                  <input
                    type="text"
                    placeholder="Enter department name"
                    value={deptName}
                    onChange={(e) => setDeptName(e.target.value)}
                    className="form-input"
                    autoFocus
                  />
                  <div className="form-actions">
                    <button type="submit" className="submit-button">
                      Submit
                    </button>
                    <button 
                      type="button" 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}

            {showCircleForm && (
              <form className="input-form" onSubmit={handleCircleSubmit}>
                <div className="form-header">
                  <h3>Add New Circle</h3>
                  <button 
                    type="button" 
                    className="close-button" 
                    onClick={handleCancel}
                  >
                    <X size={20} />
                  </button>
                </div>
                <div className="form-body">
                  <input
                    type="text"
                    placeholder="Enter circle name"
                    value={circleName}
                    onChange={(e) => setCircleName(e.target.value)}
                    className="form-input"
                    autoFocus
                  />
                  <div className="form-actions">
                    <button type="submit" className="submit-button">
                      Submit
                    </button>
                    <button 
                      type="button" 
                      className="cancel-button" 
                      onClick={handleCancel}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Two Column Layout */}
        <div className="content-grid">
          {/* Left Section - Departments */}
          <div className="card-container">
            <div className="card-header">
              <h2>Departments</h2>
              <span className="count-badge">{departments.length}</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Department</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {departments.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        No departments added yet
                      </td>
                    </tr>
                  ) : (
                    departments.map((dept) => (
                      <tr key={dept.id}>
                        <td className="item-name">{dept.name}</td>
                        <td>
                          <button
                            className="remove-button"
                            onClick={() => handleRemoveDept(dept.id)}
                            title="Remove department"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Section - Circles */}
          <div className="card-container">
            <div className="card-header">
              <h2>Circles</h2>
              <span className="count-badge">{circles.length}</span>
            </div>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Circle</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {circles.length === 0 ? (
                    <tr>
                      <td colSpan="2" className="no-data">
                        No circles added yet
                      </td>
                    </tr>
                  ) : (
                    circles.map((circle) => (
                      <tr key={circle.id}>
                        <td className="item-name">{circle.name}</td>
                        <td>
                          <button
                            className="remove-button"
                            onClick={() => handleRemoveCircle(circle.id)}
                            title="Remove circle"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddDeptCircle;