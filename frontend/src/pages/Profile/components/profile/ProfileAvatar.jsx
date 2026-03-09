import React, { useRef, useState, useEffect } from 'react';
import AvatarEditor from 'react-avatar-editor';

export const ProfileAvatar = ({ imageUrl, onImageChange }) => {
    // Use imageUrl as the initial state for the image source
    const [image, setImage] = useState(imageUrl || '');
    const [isEditing, setIsEditing] = useState(false);
    const editorRef = useRef(null);

    // Sync internal state when imageUrl prop changes (e.g. after successful upload)
    useEffect(() => {
        if (imageUrl && !isEditing) {
            setImage(imageUrl);
        }
    }, [imageUrl, isEditing]);

    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
            const isValidType = ALLOWED_IMAGE_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext);
            if (!isValidType) {
                if (typeof onImageChange === 'function') {
                    onImageChange(null, 'Please upload only image files (JPEG, PNG, GIF, or WebP). Unsupported formats like .exe are not allowed.');
                }
                e.target.value = '';
                return;
            }
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