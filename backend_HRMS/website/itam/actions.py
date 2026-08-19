"""Canonical ITAM transition action codes (frozen for P1+)."""

from __future__ import annotations

from enum import Enum


class TransitionAction(str, Enum):
    RECEIVE = "RECEIVE"
    CHECKOUT = "CHECKOUT"
    CHECKIN = "CHECKIN"
    TRANSFER = "TRANSFER"
    DEPLOY = "DEPLOY"
    UNDEPLOY = "UNDEPLOY"
    MARK_QUARANTINE = "MARK_QUARANTINE"
    SEND_REPAIR = "SEND_REPAIR"
    COMPLETE_REPAIR = "COMPLETE_REPAIR"
    REQUEST_RETURN = "REQUEST_RETURN"
    APPROVE_RETURN = "APPROVE_RETURN"
    REJECT_RETURN = "REJECT_RETURN"
    EXPORT = "EXPORT"
    RETIRE = "RETIRE"
    LOST = "LOST"
    NOTE = "NOTE"
    ACK_CUSTODY = "ACK_CUSTODY"


ACTION_LABELS: dict[str, str] = {
    TransitionAction.RECEIVE.value: "Received into stock",
    TransitionAction.CHECKOUT.value: "Assigned to employee",
    TransitionAction.CHECKIN.value: "Returned to stock",
    TransitionAction.TRANSFER.value: "Custody transfer",
    TransitionAction.DEPLOY.value: "Deployed to location",
    TransitionAction.UNDEPLOY.value: "Returned from location",
    TransitionAction.MARK_QUARANTINE.value: "Marked not working",
    TransitionAction.SEND_REPAIR.value: "Sent for repair",
    TransitionAction.COMPLETE_REPAIR.value: "Repair completed",
    TransitionAction.REQUEST_RETURN.value: "Return requested",
    TransitionAction.APPROVE_RETURN.value: "Return approved",
    TransitionAction.REJECT_RETURN.value: "Return rejected",
    TransitionAction.EXPORT.value: "Exported",
    TransitionAction.RETIRE.value: "Retired / dead",
    TransitionAction.LOST.value: "Marked lost",
    TransitionAction.NOTE.value: "Comment only",
    TransitionAction.ACK_CUSTODY.value: "Employee acknowledgement",
}

ACTION_CODES: tuple[str, ...] = tuple(a.value for a in TransitionAction)


def is_valid_action(code: str) -> bool:
    return str(code or "").strip().upper() in ACTION_CODES
