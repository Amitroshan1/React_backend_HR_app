import React, { useState, useRef } from 'react';

export const FileUpload = ({ label, name, onFileChange, fileData, error }) => {
    const [progress, setProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [isPreviewOpen, setIsPreviewOpen] = useState(false);
    const inputRef = useRef(null);

    const getFilePreview = (file) => {
        if (!file || !file.name) return '📂';
        if (file.type && file.type.startsWith('image/')) return '🖼️';
        if (file.name.endsWith('.pdf')) return '📄';
        if (file.name.endsWith('.doc') || file.name.endsWith('.docx')) return '📰';
        return '📎';
    };

    const handleActualFileChange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setIsUploading(true);
        setProgress(0);

        // 1. Simulate Upload Progress
        const interval = setInterval(() => {
            setProgress(prev => {
                if (prev >= 95) {
                    clearInterval(interval);
                    return prev;
                }
                return prev + 10;
            });
        }, 300);

        // 2. Simulate Upload Completion (after a short delay)
        setTimeout(() => {
            clearInterval(interval);
            setProgress(100);
            setIsUploading(false);

            const newFileData = {
                name: file.name,
                type: file.type,
                size: file.size,
                url: URL.createObjectURL(file)
            };
            onFileChange(name, newFileData);

            if (inputRef.current) {
                inputRef.current.value = "";
            }

        }, 3500);
    };

    const handleRemoveFile = (e) => {
        e.stopPropagation(); // Stop click from propagating to label's input
        if (fileData && fileData.url) {
            URL.revokeObjectURL(fileData.url);
        }
        onFileChange(name, null);
        setIsUploading(false);
        setProgress(0);
        setIsPreviewOpen(false);
        if (inputRef.current) {
            inputRef.current.value = "";
        }
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
                            cursor: 'pointer'
                        }}
                        onClick={() => setIsPreviewOpen(true)}
                        title="Click to preview"
                    >
                        <span style={{ fontSize: '24px', flexShrink: 0 }}>
                            {fileData.url && fileData.type && fileData.type.startsWith('image/') ? (
                                <img
                                    src={fileData.url}
                                    alt="Preview"
                                    style={{
                                        width: '40px',
                                        height: '40px',
                                        objectFit: 'cover',
                                        borderRadius: '4px'
                                    }}
                                />
                            ) : (
                                getFilePreview(fileData)
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
                                {fileData.name}
                            </p>
                            {fileData.size !== undefined && (
                                <p
                                    style={{
                                        fontSize: '11px',
                                        color: '#6b7280',
                                        margin: '2px 0 0'
                                    }}
                                >
                                    {(fileData.size / (1024 * 1024)).toFixed(2)} MB
                                </p>
                            )}
                        </div>
                    </div>

                    {isPreviewOpen && fileData.url && (
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
                                    <span
                                        style={{
                                            fontSize: '14px',
                                            fontWeight: 600,
                                            color: '#111827'
                                        }}
                                    >
                                        {fileData.name}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setIsPreviewOpen(false)}
                                        style={{
                                            border: 'none',
                                            background: 'transparent',
                                            cursor: 'pointer',
                                            fontSize: '18px',
                                            lineHeight: 1
                                        }}
                                    >
                                        ✕
                                    </button>
                                </div>

                                {fileData.type && fileData.type.startsWith('image/') ? (
                                    <img
                                        src={fileData.url}
                                        alt={fileData.name}
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
                                        src={fileData.url}
                                        title={fileData.name}
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

            {error && <p className="error-text">{error}</p>}
        </div>
    );
}