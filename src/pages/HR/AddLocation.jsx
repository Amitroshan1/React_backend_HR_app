// import React from 'react';
// import { ArrowLeft, Search, MapPin } from 'lucide-react';
// import './AddLocation.css';

// export const AddLocation = ({ onBack }) => {
//   return (
//     <div className="location-page-wrapper">
//       <div className="location-container">
//         {/* Back Button Tab */}
//         <button className="btn-back-tab" onClick={onBack}>
//           <ArrowLeft size={16} /> Back to Updates
//         </button>

//         <div className="location-card">
//           <div className="location-card-header">
//             <h2>Add Location</h2>
//             <Search size={20} className="header-icon-blue" />
//           </div>

//           <form className="location-form" onSubmit={(e) => e.preventDefault()}>
//             <div className="form-section">
//               <h3>Office Details</h3>
              
//               <div className="input-group">
//                 <label>Circle / Region</label>
//                 <select defaultValue="">
//                   <option value="" disabled>Choose Circle</option>
//                   <option value="NHQ">NHQ</option>
//                   <option value="Delhi">Delhi</option>
//                   <option value="Mumbai">Mumbai</option>
//                 </select>
//               </div>

//               <div className="input-group">
//                 <label>Location Name</label>
//                 <input type="text" placeholder="e.g. Okhla Phase III" />
//               </div>

//               <div className="input-group">
//                 <label>Full Address</label>
//                 <textarea placeholder="Enter complete office address" rows="3"></textarea>
//               </div>

//               <div className="input-row">
//                 <div className="input-group flex-1">
//                   <label>City</label>
//                   <input type="text" placeholder="City" />
//                 </div>
//                 <div className="input-group flex-1">
//                   <label>Pincode</label>
//                   <input type="text" placeholder="Pincode" />
//                 </div>
//               </div>
//             </div>

//             <div className="location-footer">
//               <button type="submit" className="btn-save-location">
//                 <MapPin size={18} /> Save Location
//               </button>
//             </div>
//           </form>
//         </div>
//       </div>
//     </div>
//   );
// };
















import React, { useState } from 'react';
import { ArrowLeft, Search, PlusCircle } from 'lucide-react';
import './AddLocation.css';

export const AddLocation = ({ onBack }) => {
  const [showTable, setShowTable] = useState(false);

  // Sample data to match the layout of your reference image
  const locations = [
    { name: 'ROHINI', lat: '28.1111', long: '77.2222', radius: '300.0' },
    { name: 'LONI', lat: '28.1541', long: '77.2783', radius: '300.0' },
    { name: 'REWARI', lat: '28.4842', long: '77.0189', radius: '300.0' },
  ];

  return (
    <div className="location-page-wrapper">
      <div className="location-container">
        {/* Navigation Tab */}
        <button className="btn-back-tab" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="location-card">
          <div className="location-card-header">
            <h2>Manage Office Locations</h2>
            <Search size={20} className="header-icon-blue" />
          </div>

          {/* Search/Add Section */}
          <div className="search-section">
            <div className="input-group">
              <label>Location Name</label>
              <input type="text" placeholder="Enter location name" />
            </div>
            <div className="input-row">
              <div className="input-group flex-1">
                <label>Latitude</label>
                <input type="text" placeholder="Latitude" />
              </div>
              <div className="input-group flex-1">
                <label>Longitude</label>
                <input type="text" placeholder="Longitude" />
              </div>
            </div>
            <div className="input-group">
              <label>Radius (meters)</label>
              <input type="text" defaultValue="100" />
            </div>
            <button className="btn-add-blue" onClick={() => setShowTable(true)}>
              Add Location
            </button>
          </div>

          {/* Table Section (Visible on Search/Add) */}
          {showTable && (
            <div className="results-section">
              <h3>Existing Locations</h3>
              <div className="table-responsive">
                <table className="location-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Latitude</th>
                      <th>Longitude</th>
                      <th>Radius (m)</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {locations.map((loc, index) => (
                      <tr key={index}>
                        <td>{loc.name}</td>
                        <td>{loc.lat}</td>
                        <td>{loc.long}</td>
                        <td>{loc.radius}</td>
                        <td>
                          <button className="btn-delete-red">Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

