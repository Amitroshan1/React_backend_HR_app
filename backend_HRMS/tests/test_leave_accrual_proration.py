"""Unit tests for prorated leave accrual scheduling (no DB required)."""
import importlib.util
import unittest
from datetime import date
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "website"
    / "commands"
    / "leave_accrual_schedule.py"
)
spec = importlib.util.spec_from_file_location("leave_accrual_schedule", MODULE_PATH)
schedule = importlib.util.module_from_spec(spec)
spec.loader.exec_module(schedule)


class LeaveAccrualProrationTests(unittest.TestCase):
    def test_probation_end_six_months(self):
        end = schedule.probation_end_date(date(2025, 11, 10))
        self.assertEqual(end, date(2026, 5, 10))

    def test_first_eligible_month_before_20th(self):
        probation_end = date(2026, 5, 10)
        self.assertEqual(schedule.first_eligible_month_in_year(probation_end, 2026), 5)

    def test_first_eligible_month_on_or_after_20th(self):
        probation_end = date(2026, 5, 20)
        self.assertEqual(schedule.first_eligible_month_in_year(probation_end, 2026), 6)

    def test_eligible_months_may_through_december(self):
        probation_end = date(2026, 5, 10)
        months = schedule.eligible_months_in_year(probation_end, 2026)
        self.assertEqual(months, [5, 6, 7, 8, 9, 10, 11, 12])
        pl_target, cl_target = schedule.annual_targets(len(months))
        self.assertEqual(pl_target, 10)
        self.assertEqual(cl_target, 4)

    def test_may_probation_pl_cl_schedule(self):
        probation_end = date(2026, 5, 10)
        pl_sched, cl_sched, meta = schedule.build_yearly_accrual_schedule(
            probation_end, 2026
        )
        self.assertEqual(meta["pl_target"], 10)
        self.assertEqual(meta["cl_target"], 4)
        self.assertEqual(sum(pl_sched.values()), 10)
        self.assertEqual(sum(cl_sched.values()), 4)
        self.assertEqual(pl_sched.get(5), 1)
        self.assertEqual(pl_sched.get(10), 1)
        self.assertEqual(pl_sched.get(11), 2)
        self.assertEqual(pl_sched.get(12), 2)
        self.assertEqual(cl_sched.get(5), 1)
        self.assertEqual(cl_sched.get(6), 1)
        self.assertEqual(cl_sched.get(7), 1)
        self.assertEqual(cl_sched.get(8), 1)
        self.assertNotIn(9, cl_sched)

    def test_full_year_twelve_months(self):
        probation_end = date(2020, 1, 1)
        pl_sched, cl_sched, meta = schedule.build_yearly_accrual_schedule(
            probation_end, 2026
        )
        self.assertEqual(meta["eligible_month_count"], 12)
        self.assertEqual(meta["pl_target"], int(round(schedule.ANNUAL_PL_ENTITLEMENT)))
        self.assertEqual(meta["cl_target"], int(round(schedule.ANNUAL_CL_ENTITLEMENT)))
        self.assertEqual(sum(pl_sched.values()), 15)
        self.assertEqual(sum(cl_sched.values()), 6)
        self.assertEqual(cl_sched.get(6), 1)
        self.assertNotIn(7, cl_sched)

    def test_july_probation_six_months_remaining(self):
        probation_end = date(2026, 7, 5)
        months = schedule.eligible_months_in_year(probation_end, 2026)
        self.assertEqual(len(months), 6)
        pl_target, cl_target = schedule.annual_targets(len(months))
        self.assertEqual(pl_target, 8)
        self.assertEqual(cl_target, 3)

    def test_no_eligible_months_probation_late_december(self):
        probation_end = date(2026, 12, 21)
        months = schedule.eligible_months_in_year(probation_end, 2026)
        self.assertEqual(months, [])
        pl_sched, cl_sched, meta = schedule.build_yearly_accrual_schedule(
            probation_end, 2026
        )
        self.assertEqual(meta["pl_target"], 0)
        self.assertEqual(pl_sched, {})
        self.assertEqual(cl_sched, {})

    def test_distribute_single_month(self):
        sched = schedule.distribute_integer_credits([8], 3)
        self.assertEqual(sched, {8: 3})

    def test_distribute_two_months(self):
        sched = schedule.distribute_integer_credits([11, 12], 5)
        self.assertEqual(sum(sched.values()), 5)
        self.assertEqual(sched[11], 3)
        self.assertEqual(sched[12], 2)


if __name__ == "__main__":
    unittest.main()
