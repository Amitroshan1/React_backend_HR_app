import React, { useState, useRef } from 'react';

const IMAGE_EXT_PATTERN = /\.(jpe?g|png|gif|webp|bmp|svg)$/i;

function isImageFile(fileData) {
    if (!fileData) return false;
    if (typeof fileData === 'object') {
        if (fileData.type?.startsWith('image/')) return true;
        return IMAGE_EXT_PATTERN.test(fileData.name || '');
    }
    return IMAGE_EXT_PATTERN.test(String(fileData));
}

function triggerFileDownload(url, filename) {
    if (!url) return;
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename || '';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
}

export const FileUpload = ({ label, name, onFileChange, fileData, error, adminId, uploadProfileFileUrl, accept }) => {
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

        if (accept) {
            const allowedExts = accept.replace(/\./g, '').toLowerCase().split(',');
            const ext = (file.name.split('.').pop() || '').toLowerCase();
            if (!allowedExts.includes(ext)) {
                setUploadError(`Unsupported file format (.${ext}). Please use .pdf, .jpg, .jpeg, or .png only.`);
                if (inputRef.current) inputRef.current.value = '';
                return;
            }
        }

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
    const isImage = isImageFile(fileData);

    const handleOpenFile = (e) => {
        e?.stopPropagation?.();
        if (!previewUrl) return;
        if (isImage) {
            setIsPreviewOpen(true);
            return;
        }
        triggerFileDownload(previewUrl, getDisplayName() || 'download');
    };

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
                accept={accept}
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
                        onClick={previewUrl ? handleOpenFile : undefined}
                        title={previewUrl ? (isImage ? 'Click to preview' : 'Click to download') : undefined}
                    >
                        <span style={{ fontSize: '24px', flexShrink: 0 }}>
                            {previewUrl && isImage ? (
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
                                <button
                                    type="button"
                                    onClick={handleOpenFile}
                                    style={{
                                        fontSize: '12px',
                                        color: '#3b82f6',
                                        marginTop: '2px',
                                        display: 'inline-block',
                                        border: 'none',
                                        background: 'none',
                                        padding: 0,
                                        cursor: 'pointer',
                                        textDecoration: 'underline',
                                    }}
                                >
                                    {isImage ? 'View' : 'Download'}
                                </button>
                            )}
                        </div>
                    </div>

                    {isPreviewOpen && previewUrl && isImage && (
                        <div
                            className="file-preview-backdrop"
                            onClick={() => setIsPreviewOpen(false)}
                        >
                            <div
                                className="file-preview-modal"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="file-preview-modal__header">
                                    <span className="file-preview-modal__title">
                                        {getDisplayName()}
                                    </span>
                                    <button
                                        type="button"
                                        className="file-preview-modal__close"
                                        onClick={() => setIsPreviewOpen(false)}
                                    >
                                        ✕
                                    </button>
                                </div>

                                <img
                                    src={previewUrl}
                                    alt={getDisplayName()}
                                    className="file-preview-modal__image"
                                />
                            </div>
                        </div>
                    )}
                </>
            )}

            {(uploadError || error) && <p className="error-text">{uploadError || error}</p>}
        </div>
    );
}