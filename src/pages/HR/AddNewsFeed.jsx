import React from 'react';
import { ArrowLeft, Search, Bell } from 'lucide-react';
import './AddNewsFeed.css';

export const AddNewsFeed = ({ onBack }) => {
  return (
    <div className="newsfeed-page-container">

      {/* Content Area */}
      <div className="newsfeed-content">
        <button className="btn-back-link" onClick={onBack}>
          <ArrowLeft size={16} /> Back to Updates
        </button>

        <div className="announcement-card">
          <form className="newsfeed-form" onSubmit={(e) => e.preventDefault()}>
            <div className="form-item">
              <label>Circle</label>
              <select defaultValue="">
                <option value="" disabled>Choose Your Circle</option>
                <option value="NHQ">NHQ</option>
                <option value="Mumbai">Mumbai</option>
                <option value="Delhi">Delhi</option>
              </select>
            </div>

            <div className="form-item">
              <label>Employee Type</label>
              <select defaultValue="">
                <option value="" disabled>Select Employee Type</option>
                <option value="All">All Employees</option>
                <option value="Software Developer">Software Developer</option>
                <option value="Human Resource">Human Resource</option>
              </select>
            </div>

            <div className="form-item">
              <label>Title</label>
              <input type="text" placeholder="Enter title" />
            </div>

            <div className="form-item">
              <label>Content</label>
              <textarea placeholder="Enter content" rows="5"></textarea>
            </div>

            {/* <div className="form-item">
              <label>File</label>
              <div className="file-input-wrapper">
                <input type="file" id="news-file" />
              </div>
            </div> */}
            <div className="form-item">
  <label>File</label>
  <div className="file-input-wrapper">
    <label htmlFor="news-file" className="custom-file-upload">
      <span className="choose-btn">Choose File</span>
      <span className="file-name">No file chosen</span>
    </label>
    <input 
      type="file" 
      id="news-file" 
      onChange={(e) => {
        const fileName = e.target.files[0]?.name || "No file chosen";
        document.querySelector('.file-name').textContent = fileName;
      }}
    />
  </div>
</div>

            <div className="form-submit">
              <button type="submit" className="btn-post">Post</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

