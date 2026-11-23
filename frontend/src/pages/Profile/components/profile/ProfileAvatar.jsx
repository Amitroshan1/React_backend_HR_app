import React, { useRef, useState, useEffect } from 'react';
import AvatarEditor from 'react-avatar-editor';
import { isDecodableImageFile } from '../../utils/validateImageFile';

const FALLBACK_AVATAR =
    'data:image/svg+xml,' +
    encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
        '<circle cx="50" cy="50" r="50" fill="#2563eb"/>' +
        '<circle cx="50" cy="38" r="16" fill="#fff"/>' +
        '<path d="M22 82c4-14 16-22 28-22s24 8 28 22" fill="#fff"/></svg>'
    );

export const ProfileAvatar = ({ imageUrl, onImageChange }) => {
    // Use imageUrl as the initial state for the image source
    const [image, setImage] = useState(imageUrl || '');
    const [displaySrc, setDisplaySrc] = useState(imageUrl || FALLBACK_AVATAR);
    const [isEditing, setIsEditing] = useState(false);
    const editorRef = useRef(null);

    // Sync internal state when imageUrl prop changes (e.g. after successful upload)
    useEffect(() => {
        if (imageUrl && !isEditing) {
            setImage(imageUrl);
            setDisplaySrc(imageUrl);
        }
    }, [imageUrl, isEditing]);

    const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
    const MAX_IMAGE_MB = 5;

    const rejectFile = (input, message) => {
        if (typeof onImageChange === 'function') {
            onImageChange(null, message);
        }
        if (input) input.value = '';
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const input = e.target;
        const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
        const isValidType = ALLOWED_IMAGE_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext);
        if (!isValidType) {
            rejectFile(input, 'Please upload only image files (JPEG, PNG, GIF, or WebP). Unsupported formats like .exe are not allowed.');
            return;
        }
        if (file.size > MAX_IMAGE_BYTES) {
            rejectFile(
                input,
                `Image is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum allowed size is ${MAX_IMAGE_MB} MB.`
            );
            return;
        }
        const readable = await isDecodableImageFile(file);
        if (!readable) {
            rejectFile(input, 'This image file is corrupted or unreadable. Please upload a valid JPEG, PNG, GIF, or WebP.');
            return;
        }
        setImage(file);
        setIsEditing(true);
    };

    const handleEditorLoadFailure = () => {
        setIsEditing(false);
        setImage(imageUrl || '');
        if (typeof onImageChange === 'function') {
            onImageChange(null, 'Could not read this image. Use a JPEG, PNG, GIF, or WebP file under 5 MB.');
        }
    };

    const handleSave = () => {
        if (!editorRef.current) return;
        const canvas = editorRef.current.getImageScaledToCanvas();
        canvas.toBlob(
            (blob) => {
                if (!blob || blob.size < 500) {
                    if (typeof onImageChange === 'function') {
                        onImageChange(null, 'Could not process image. Try another photo or a smaller file (max 5 MB).');
                    }
                    setIsEditing(false);
                    setImage(imageUrl || '');
                    return;
                }
                onImageChange(blob);
                setIsEditing(false);
            },
            'image/png',
            0.92
        );
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
                        onLoadFailure={handleEditorLoadFailure}
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
                        src={displaySrc || FALLBACK_AVATAR}
                        alt=""
                        className="avatar"
                        onError={() => setDisplaySrc(FALLBACK_AVATAR)}
                    />
                    <div className="avatar-overlay">Change</div>
                    <input
                        type="file"
                        id="avatar-input"
                        accept="image/jpeg,image/png,image/gif,image/webp"
                        onChange={handleFileChange}
                        style={{ display: 'none' }}
                    />
                </div>
            )}
            <p className="avatar-size-hint">JPEG, PNG, GIF or WebP. Max 5 MB.</p>
        </div>
    );
}