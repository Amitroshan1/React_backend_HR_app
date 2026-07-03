"""Unit tests for offboarding status and checklist logic."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "website"


def _load():
    path = ROOT / "offboarding_service.py"
    spec = importlib.util.spec_from_file_location("website.offboarding_service", path)
    mod = importlib.util.module_from_spec(spec)
    if "website" not in sys.modules:
        sys.modules["website"] = types.ModuleType("website")
    sys.modules["website.offboarding_service"] = mod
    spec.loader.exec_module(mod)
    return mod


obs = _load()


class TestOffboardingLogic(unittest.TestCase):
    def test_status_clearance_when_noc_pending(self):
        status = obs.compute_offboarding_status(
            is_exited=False,
            resignation_status="Approved",
            has_resignation=True,
            noc_total=4,
            noc_pending=2,
            fnf_latest_status=None,
        )
        self.assertEqual(status, "clearance")

    def test_status_ready_when_noc_cleared(self):
        status = obs.compute_offboarding_status(
            is_exited=False,
            resignation_status="Approved",
            has_resignation=True,
            noc_total=3,
            noc_pending=0,
            fnf_latest_status=None,
        )
        self.assertEqual(status, "ready")

    def test_hard_blocker_pending_noc(self):
        checklist = obs.build_exit_checklist(
            is_exited=False,
            exit_type="Resigned",
            resignation_status="Approved",
            has_resignation=True,
            noc_total=2,
            noc_pending=1,
            unreturned_assets=0,
            pending_leave_count=0,
            pending_wfh_count=0,
            has_fnf_settlement=False,
            fnf_latest_status=None,
        )
        self.assertFalse(obs.checklist_can_exit_without_override(checklist))
        blockers = obs.checklist_hard_blockers(checklist)
        self.assertEqual(blockers[0]["key"], "noc_pending")

    def test_can_exit_when_no_hard_blockers(self):
        checklist = obs.build_exit_checklist(
            is_exited=False,
            exit_type="Terminated",
            resignation_status=None,
            has_resignation=False,
            noc_total=0,
            noc_pending=0,
            unreturned_assets=2,
            pending_leave_count=1,
            pending_wfh_count=0,
            has_fnf_settlement=False,
            fnf_latest_status=None,
        )
        self.assertTrue(obs.checklist_can_exit_without_override(checklist))

    def test_exited_fnf_settled_status(self):
        status = obs.compute_offboarding_status(
            is_exited=True,
            resignation_status="Completed",
            has_resignation=True,
            noc_total=0,
            noc_pending=0,
            fnf_latest_status="finalized",
        )
        self.assertEqual(status, "fnf_settled")

    def test_admin_login_allowed_grace_period(self):
        from datetime import date, timedelta

        class FakeAdmin:
            is_active = True
            is_exited = True
            exit_login_until = date.today() + timedelta(days=3)

        self.assertTrue(obs.admin_login_allowed(FakeAdmin()))

    def test_admin_login_blocked_after_grace(self):
        from datetime import date, timedelta

        class FakeAdmin:
            is_active = True
            is_exited = True
            exit_login_until = date.today() - timedelta(days=1)

        self.assertFalse(obs.admin_login_allowed(FakeAdmin()))


def _load_exit_interview():
    path = ROOT / "exit_interview_service.py"
    spec = importlib.util.spec_from_file_location("website.exit_interview_service", path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["website.exit_interview_service"] = mod
    spec.loader.exec_module(mod)
    return mod


eis = _load_exit_interview()


class TestExitInterviewAndRehire(unittest.TestCase):
    def test_default_rehire_ineligible_for_terminated(self):
        self.assertFalse(eis.default_rehire_eligible("Terminated"))

    def test_default_rehire_eligible_for_resigned(self):
        self.assertTrue(eis.default_rehire_eligible("Resigned"))

    def test_cooldown_90_days(self):
        from datetime import date

        lwd = date(2025, 1, 1)
        self.assertEqual(eis.default_rehire_cooldown_until(lwd), date(2025, 4, 1))

    def test_absconded_not_rehire_eligible(self):
        self.assertFalse(eis.default_rehire_eligible("Absconded"))


if __name__ == "__main__":
    unittest.main()
