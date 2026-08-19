"""In-process SSE subscriber hub (per Gunicorn worker). Cross-worker uses outbox."""

from __future__ import annotations

import logging
import queue
import threading
from dataclasses import dataclass, field
from typing import Any, Dict, Optional, Set

logger = logging.getLogger(__name__)


@dataclass(eq=False)
class Subscriber:
    viewer_admin_id: int
    # None = org-wide (HR/Admin); else allowlist of employee Admin.ids
    allowed_employee_ids: Optional[Set[int]]
    q: queue.Queue = field(default_factory=lambda: queue.Queue(maxsize=64), repr=False)

    def __hash__(self) -> int:
        return id(self)


class AttendanceEventHub:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._subs: Set[Subscriber] = set()

    def subscribe(
        self,
        viewer_admin_id: int,
        allowed_employee_ids: Optional[Set[int]],
    ) -> Subscriber:
        sub = Subscriber(
            viewer_admin_id=viewer_admin_id,
            allowed_employee_ids=allowed_employee_ids,
        )
        with self._lock:
            self._subs.add(sub)
        return sub

    def unsubscribe(self, sub: Subscriber) -> None:
        with self._lock:
            self._subs.discard(sub)

    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subs)

    def publish_local(self, event: Dict[str, Any]) -> None:
        """Fan-out to subscribers on this worker only."""
        emp_id = event.get("employee_id")
        try:
            emp_id_int = int(emp_id) if emp_id is not None else None
        except (TypeError, ValueError):
            emp_id_int = None

        with self._lock:
            targets = list(self._subs)

        for sub in targets:
            if not _sub_may_receive(sub, emp_id_int):
                continue
            try:
                sub.q.put_nowait(event)
            except queue.Full:
                # Drop oldest-style: skip rather than block attendance path
                logger.warning(
                    "ATTENDANCE_SSE_QUEUE_FULL viewer=%s", sub.viewer_admin_id
                )


def _sub_may_receive(sub: Subscriber, employee_admin_id: Optional[int]) -> bool:
    if employee_admin_id is None:
        return False
    if sub.allowed_employee_ids is None:
        return True
    return employee_admin_id in sub.allowed_employee_ids


hub = AttendanceEventHub()
