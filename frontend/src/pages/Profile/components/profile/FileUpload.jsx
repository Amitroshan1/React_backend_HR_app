import React, { useState, useRef } from 'react';

export const FileUpload = ({ label, name, onFileChange, fileData, error, adminId, uploadProfileFileUrl }) => {
    const [progress, setProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const inputRef = useRef(null);

    const getFilePreview = (file) => {
        if (!file || !file.name) return '📂';
        if (file.type && file.type.startsWith('image/')) return '🖼️';
        if (file.name.endsWith('.pdf')) return '📄';
        if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) return '📰';
        return '📎';
    };

    const getDisplayName = () => {
        if (!fileData) return null;
        if (typeof fileData === 'string') {
            const parts = fileData.split('/');
            return parts[parts.length - 1] || 'Document Uploaded';
        }
        return fileData.name || 'Document Uploaded';
    };

    const handleActualFileChange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (!adminId || !uploadProfileFileUrl) {
            setUploadError('Profile not loaded. Please refresh and try again.');
            if (inputRef.current) inputRef.current.value = '';
            return;
        }

        setIsUploading(true);
        setProgress(10);
        setUploadError('');

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('admin_id', String(adminId));
            formData.append('field', name);

            const token = localStorage.getItem('token');
            const res = await fetch(uploadProfileFileUrl, {
                method: 'POST',
                headers: token ? { Authorization: `Bearer ${token}` } : {},
                body: formData,
            });
            const data = await res.json().catch(() => ({}));

            if (!res.ok) {
                setUploadError(data.message || 'Upload failed');
                return;
            }
            setProgress(100);
            onFileChange(name, data.path || null);
        } catch (err) {
            setUploadError('Network error. Please try again.');
        } finally {
            setIsUploading(false);
            if (inputRef.current) inputRef.current.value = '';
        }
    };

    const handleRemoveFile = (e) => {
        e.stopPropagation();
        if (fileData && typeof fileData === 'object' && fileData.url) {
            URL.revokeObjectURL(fileData.url);
        }
        onFileChange(name, null);
        setIsUploading(false);
        setProgress(0);
        setUploadError('');
        setIsPreviewOpen(false);
        if (inputRef.current) inputRef.current.value = '';
    };

    const previewUrl = typeof fileData === 'string' ? `/static/uploads/${fileData}` : (fileData?.url || null);

    return (
        <div className="input-box file-upload-box">
            <label htmlFor={name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {label}
                {fileData && (
                    <span
                        onClick={handleRemoveFile}
                        style={{ color: '#ef4444', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                        title="Remove Document"
                    >
                        ❌ Remove
                    </span>
                )}
            </label>
            <input
                type="file"
                id={name}
                name={name}
                ref={inputRef}
                onChange={handleActualFileChange}
                style={{
                    border: error ? '1px solid red' : '1px solid #ddd',
                    padding: '8px',
                    borderRadius: '6px',
                    width: '100%',
                    boxSizing: 'border-box'
                }}
                disabled={isUploading}
            />

            {isUploading && (
                <div style={{ marginTop: '8px' }}>
                    <p style={{ fontSize: '12px', color: '#3b82f6', marginBottom: '4px' }}>Uploading... {Math.min(99, progress)}%</p>
                    <div style={{ height: '4px', backgroundColor: '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                        <div
                            style={{
                                width: `${Math.min(99, progress)}%`,
                                height: '100%',
                                backgroundColor: '#3b82f6',
                                transition: 'width 0.3s'
                            }}
                        />
                    </div>
                </div>
            )}

            {fileData && !isUploading && (
                <>
                    <div
                        className="file-upload-preview-row"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            marginTop: '8px',
                            gap: '10px',
                            padding: '6px 8px',
                            border: '1px solid #d1d5db',
                            borderRadius: '6px',
                            background: '#f9fafb',
                            cursor: previewUrl ? 'pointer' : 'default'
                        }}
                        onClick={previewUrl ? () => setIsPreviewOpen(true) : undefined}
                        title={previewUrl ? 'Click to preview' : undefined}
                    >
                        <span style={{ fontSize: '24px', flexShrink: 0 }}>
                            {previewUrl && (typeof fileData === 'object' ? fileData?.type?.startsWith('image/') : /\.(jpe?g|png|gif|webp)$/i.test(String(fileData))) ? (
                                <img
                                    src={previewUrl}
                                    alt="Preview"
                                    style={{
                                        width: '40px',
                                        height: '40px',
                                        objectFit: 'cover',
                                        borderRadius: '4px'
                                    }}
                                />
                            ) : (
                                getFilePreview(typeof fileData === 'object' ? fileData : { name: getDisplayName() })
                            )}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <p
                                style={{
                                    fontSize: '14px',
                                    color: '#111827',
                                    margin: 0,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    fontWeight: 600
                                }}
                            >
                                {getDisplayName()}
                            </p>
                            {typeof fileData === 'object' && fileData?.size !== undefined && (
                                <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0' }}>
                                    {(fileData.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                            )}
                            {typeof fileData === 'string' && (
                                <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: '#3b82f6', marginTop: '2px', display: 'inline-block' }}>View</a>
                            )}
                        </div>
                    </div>

                    {isPreviewOpen && previewUrl && (
                        <div
                            className="file-preview-backdrop"
                            style={{
                                position: 'fixed',
                                inset: 0,
                                background: 'rgba(0,0,0,0.75)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                zIndex: 1000
                            }}
                            onClick={() => setIsPreviewOpen(false)}
                        >
                            <div
                                className="file-preview-modal"
                                style={{
                                    background: '#ffffff',
                                    borderRadius: '10px',
                                    maxWidth: '95vw',
                                    maxHeight: '95vh',
                                    width: 'auto',
                                    padding: '12px 16px 16px',
                                    boxShadow: '0 20px 40px rgba(0,0,0,0.45)',
                                    boxSizing: 'border-box',
                                    overflow: 'auto'
                                }}
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: '10px'
                                    }}
                                >
                                    <span style={{ fontSize: '14px', fontWeight: 600, color: '#111827' }}>
                                        {getDisplayName()}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setIsPreviewOpen(false)}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}
                                    >
                                        ✕
                                    </button>
                                </div>

                                {(typeof fileData === 'object' ? fileData?.type?.startsWith('image/') : /\.(jpe?g|png|gif|webp)$/i.test(String(fileData))) ? (
                                    <img
                                        src={previewUrl}
                                        alt={getDisplayName()}
                                        style={{
                                            maxWidth: '100%',
                                            maxHeight: '80vh',
                                            display: 'block',
                                            borderRadius: '6px',
                                            objectFit: 'contain'
                                        }}
                                    />
                                ) : (
                                    <iframe
                                        src={previewUrl}
                                        title={getDisplayName()}
                                        style={{
                                            width: '80vw',
                                            maxWidth: '100%',
                                            height: '70vh',
                                            border: 'none',
                                            borderRadius: '6px'
                                        }}
                                    />
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {(uploadError || error) && <p className="error-text">{uploadError || error}</p>}
        </div>
    );
}