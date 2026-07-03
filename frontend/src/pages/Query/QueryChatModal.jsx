import { useEffect } from "react";
import { createPortal } from "react-dom";
import "./queryChatModal.css";

export function QueryChatModal({ open, onClose, children, ariaLabelledBy }) {
    useEffect(() => {
        if (!open) return undefined;

        const onKeyDown = (e) => {
            if (e.key === "Escape") onClose();
        };
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);

        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [open, onClose]);

    if (!open) return null;

    return createPortal(
        <div className="query-chat-modal-overlay" onClick={onClose} role="presentation">
            <div
                className="query-chat-modal-card"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby={ariaLabelledBy}
            >
                {children}
            </div>
        </div>,
        document.body
    );
}
