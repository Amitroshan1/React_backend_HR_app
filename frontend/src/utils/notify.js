import { toast } from "react-toastify";

const defaultOptions = {
    position: "bottom-right",
    autoClose: 4000,
    hideProgressBar: false,
    closeOnClick: true,
    pauseOnHover: true,
};

export function notifySuccess(message, options = {}) {
    if (!message) return;
    toast.success(message, { ...defaultOptions, ...options });
}

export function notifyError(message, options = {}) {
    if (!message) return;
    toast.error(message, { ...defaultOptions, autoClose: 5000, ...options });
}

export function notifyInfo(message, options = {}) {
    if (!message) return;
    toast.info(message, { ...defaultOptions, ...options });
}

export function notifyWarning(message, options = {}) {
    if (!message) return;
    toast.warning(message, { ...defaultOptions, autoClose: 5000, ...options });
}
