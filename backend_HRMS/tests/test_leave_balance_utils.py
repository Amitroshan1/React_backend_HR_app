from website.leave_balance_utils import (
    computed_total_entitlement,
    credit_cl_entitlement,
    credit_pl_entitlement,
    reset_annual_casual_entitlement_counters,
    sync_leave_balance_totals,
)


class _FakeLeaveBalance:
    def __init__(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)


def test_sync_totals_from_remaining_plus_used():
    lb = _FakeLeaveBalance(
        privilege_leave_balance=9.5,
        used_privilege_leave=3.0,
        total_privilege_leave=0.0,
        casual_leave_balance=2.0,
        used_casual_leave=3.0,
        total_casual_leave=0.0,
        compensatory_leave_balance=0.0,
        used_comp_leave=0.0,
        total_compensatory_leave=0.0,
    )
    assert sync_leave_balance_totals(lb) is True
    assert lb.total_privilege_leave == 12.5
    assert lb.total_casual_leave == 5.0


def test_credit_pl_updates_balance_and_total():
    lb = _FakeLeaveBalance(
        privilege_leave_balance=1.0,
        total_privilege_leave=1.0,
    )
    credit_pl_entitlement(lb, 1.5)
    assert lb.privilege_leave_balance == 2.5
    assert lb.total_privilege_leave == 2.5


def test_credit_cl_updates_balance_and_total():
    lb = _FakeLeaveBalance(
        casual_leave_balance=0.0,
        total_casual_leave=0.0,
    )
    credit_cl_entitlement(lb, 1.0)
    assert lb.casual_leave_balance == 1.0
    assert lb.total_casual_leave == 1.0


def test_reset_annual_casual_counters():
    lb = _FakeLeaveBalance(
        casual_leave_balance=2.0,
        used_casual_leave=3.0,
        total_casual_leave=5.0,
    )
    reset_annual_casual_entitlement_counters(lb)
    assert lb.casual_leave_balance == 0.0
    assert lb.used_casual_leave == 0.0
    assert lb.total_casual_leave == 0.0


def test_computed_total_entitlement_keeps_higher_stored():
    assert computed_total_entitlement(2.0, 3.0, 10.0) == 10.0
    assert computed_total_entitlement(2.0, 3.0, 0.0) == 5.0
