import { Paperclip } from "lucide-react";
import { queryAttachmentDisplayName } from "./queryChatHelpers";

export function QueryChatAttachmentsBar({
    attachments = [],
    onOpenFile,
    label = "Files uploaded with query",
}) {
    if (!attachments.length) return null;

    return (
        <div className="query-chat-attachments-bar">
            <span className="query-chat-attachments-bar-label">{label}</span>
            <ul className="query-chat-attachments-bar-list">
                {attachments.map((file) => (
                    <li key={file}>
                        <button
                            type="button"
                            className="query-chat-attachments-bar-link"
                            onClick={() => onOpenFile(file)}
                            title={queryAttachmentDisplayName(file)}
                        >
                            <Paperclip size={14} aria-hidden="true" />
                            <span>{queryAttachmentDisplayName(file)}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </div>
    );
}
