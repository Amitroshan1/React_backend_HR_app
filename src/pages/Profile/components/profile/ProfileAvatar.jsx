import React, { useRef, useState } from 'react';
import AvatarEditor from 'react-avatar-editor';

export const ProfileAvatar = ({ imageUrl, onImageChange }) => {
    // Use imageUrl as the initial state for the image source
    const [image, setImage] = useState(imageUrl || '');
    const [isEditing, setIsEditing] = useState(false);
    const editorRef = useRef(null);

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            // When a file is selected, set the state to the File object to trigger the editor
            setImage(file);
            setIsEditing(true);
        }
    };

    const handleSave = () => {
        if (editorRef.current) {
            const canvas = editorRef.current.getImageScaledToCanvas();
            canvas.toBlob((blob) => {
                // Call the parent handler to upload the new image blob
                onImageChange(blob); 
                setIsEditing(false);
            });
        }
    };

    const handleCancel = () => {
        setIsEditing(false);
        // 🛑 Ensure the image state reverts to the original URL string (prop)
        // This is important if the user canceled before saving.
        setImage(imageUrl); 
    };

    return (
        <div className="profile-avatar-container">
            {isEditing ? (
                <div className="avatar-editor-wrapper">
                    <AvatarEditor
                        ref={editorRef}
                        image={image} // This is the File object or original URL string
                        width={140}
                        height={140}
                        border={20}
                        borderRadius={70}
                        color={[255, 255, 255, 0.6]}
                        scale={1.2}
                    />
                    <div className="avatar-editor-actions">
                        <button className="save-btn" onClick={handleSave}>Save</button>
                        <button className="edit-btn" onClick={handleCancel}>Cancel</button>
                    </div>
                </div>
            ) : (
                <div 
                    className="avatar-wrapper" 
                    onClick={() => document.getElementById('avatar-input').click()}
                    // 🛑 Ensure the cursor indicates it's clickable (for better UX)
                    style={{ cursor: 'pointer' }} 
                >
                    <img
                        src={imageUrl || '/default-avatar.png'} // Use the prop for the final rendered image
                        alt="Profile"
                        className="avatar"
                    />
                    <div className="avatar-overlay">Change</div>
                    <input
                        type="file"
                        id="avatar-input"
                        accept="image/*"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                    />
                </div>
            )}
        </div>
    );
}