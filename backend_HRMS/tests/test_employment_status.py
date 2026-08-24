"""Employment status, probation dates, leave eligibility, and migration helpers."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from website.employment_status import (
    DEFAULT_PROBATION_MONTHS,
    STATUS_CONTRACT,
    STATUS_ON_ROLE,
    STATUS_PROBATION,
    EmploymentStatusError,
    add_calendar_months,
    accrual_schedule_anchor_date,
    duration_months_from_dates,
    employment_fields_changed,
    infer_legacy_employment_fields,
    is_pl_cl_accrual_eligible,
    normalize_employment_status,
    resolve_employment_payload,
    serialize_employment_fields,
    snapshot_employment,
    transition_to_on_role,
)
from website.commands.leave_accrual_schedule import build_yearly_accrual_schedule


def test_default_probation_is_six_months():
    doj = date(2025, 11, 10)
    fields = resolve_employment_payload({}, doj=doj, for_create=True)
    assert fields["employment_status"] == STATUS_PROBATION
    assert fields["probation_start_date"] == doj
    assert fields["probation_duration_months"] == DEFAULT_PROBATION_MONTHS
    assert fields["probation_end_date"] == date(2026, 5, 10)


def test_signup_on_role_and_contract():
    doj = date(2026, 1, 15)
    on_role = resolve_employment_payload(
        {"employment_status": "on_role"}, doj=doj, for_create=True
    )
    assert on_role["employment_status"] == STATUS_ON_ROLE
    contract = resolve_employment_payload(
        {"employment_status": "contract"}, doj=doj, for_create=True
    )
    assert contract["employment_status"] == STATUS_CONTRACT


def test_manual_probation_dates_and_duration():
    doj = date(2026, 1, 1)
    fields = resolve_employment_payload(
        {
            "employment_status": "probation",
            "probation_start_date": "2026-02-01",
            "probation_duration_months": 4,
        },
        doj=doj,
        for_create=True,
    )
    assert fields["probation_start_date"] == date(2026, 2, 1)
    assert fields["probation_end_date"] == date(2026, 6, 1)
    assert fields["probation_duration_months"] == 4


def test_inconsistent_probation_dates_rejected():
    doj = date(2026, 1, 1)
    try:
        resolve_employment_payload(
            {
                "employment_status": "probation",
                "probation_start_date": "2026-01-01",
                "probation_duration_months": 6,
                "probation_end_date": "2026-02-01",
            },
            doj=doj,
            for_create=True,
        )
        raise AssertionError("expected EmploymentStatusError")
    except EmploymentStatusError as exc:
        assert "does not match" in str(exc)


def test_hr_status_update_payload():
    existing = SimpleNamespace(
        employment_status=STATUS_PROBATION,
        employment_status_effective_from=date(2026, 1, 1),
        probation_start_date=date(2026, 1, 1),
        probation_end_date=date(2026, 7, 1),
        probation_duration_months=6,
        doj=date(2026, 1, 1),
    )
    fields = resolve_employment_payload(
        {"employment_status": "on_role"},
        doj=existing.doj,
        existing=existing,
        for_create=False,
    )
    assert fields["employment_status"] == STATUS_ON_ROLE
    assert fields["probation_start_date"] == date(2026, 1, 1)
    assert fields["probation_end_date"] == date(2026, 7, 1)


def test_status_history_change_map():
    before = snapshot_employment(
        SimpleNamespace(
            employment_status=STATUS_PROBATION,
            employment_status_effective_from=date(2026, 1, 1),
            probation_start_date=date(2026, 1, 1),
            probation_end_date=date(2026, 7, 1),
            probation_duration_months=6,
        )
    )
    after = dict(before)
    after["employment_status"] = STATUS_ON_ROLE
    after["employment_status_effective_from"] = date(2026, 7, 1)
    changed = employment_fields_changed(before, after)
    assert "employment_status" in changed
    assert changed["employment_status"]["from"] == STATUS_PROBATION
    assert changed["employment_status"]["to"] == STATUS_ON_ROLE


def test_welcome_email_rows_include_probation():
    admin = SimpleNamespace(
        employment_status=STATUS_PROBATION,
        employment_status_effective_from=date(2026, 1, 10),
        probation_start_date=date(2026, 1, 10),
        probation_end_date=date(2026, 7, 10),
        probation_duration_months=6,
    )
    payload = serialize_employment_fields(admin)
    assert payload["employment_status"] == STATUS_PROBATION
    assert payload["employment_status_label"] == "Probation"
    assert payload["probation_start_date"] == "2026-01-10"
    assert payload["probation_end_date"] == "2026-07-10"
    assert payload["probation_duration_months"] == 6


def test_welcome_email_includes_employment_rows():
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "website" / "email.py").read_text(encoding="utf-8")
    assert "def employment_status_email_rows" in src
    assert "def send_employment_status_updated_email" in src
    assert "employment_status_email_rows(admin)" in src


def test_probation_confirmation_sets_on_role():
    admin = SimpleNamespace(
        id=1,
        employment_status=STATUS_PROBATION,
        employment_status_effective_from=date(2026, 1, 1),
        probation_start_date=date(2026, 1, 1),
        probation_end_date=date(2026, 7, 1),
        probation_duration_months=6,
    )
    with patch("website.employment_status._write_history"), patch(
        "website.employment_status.sync_leave_eligibility_for_admin", create=True
    ), patch("website.commands.leave_accrual.sync_leave_eligibility_for_admin"):
        changed = transition_to_on_role(
            admin, effective_from=date(2026, 7, 2), changed_by="hr@x.com"
        )
    assert admin.employment_status == STATUS_ON_ROLE
    assert admin.employment_status_effective_from == date(2026, 7, 2)
    assert "employment_status" in changed


def test_probation_extension_updates_end_and_stays_probation():
    from website.employment_status import apply_probation_extension

    admin = SimpleNamespace(
        id=1,
        employment_status=STATUS_PROBATION,
        employment_status_effective_from=date(2026, 1, 1),
        probation_start_date=date(2026, 1, 1),
        probation_end_date=date(2026, 7, 1),
        probation_duration_months=6,
        doj=date(2026, 1, 1),
    )
    with patch("website.employment_status._write_history"):
        apply_probation_extension(admin, date(2026, 10, 1), changed_by="hr@x.com")
    assert admin.employment_status == STATUS_PROBATION
    assert admin.probation_end_date == date(2026, 10, 1)
    assert admin.probation_duration_months == 9


def test_leave_eligibility_before_and_after_on_role():
    probation = SimpleNamespace(employment_status=STATUS_PROBATION)
    on_role = SimpleNamespace(employment_status=STATUS_ON_ROLE)
    contract = SimpleNamespace(employment_status=STATUS_CONTRACT)
    assert is_pl_cl_accrual_eligible(probation, date(2026, 12, 20)) is False
    assert is_pl_cl_accrual_eligible(on_role, date(2026, 12, 20)) is True
    with patch("website.employment_status.load_leave_settings", create=True), patch(
        "website.leave_settings.load_leave_settings",
        return_value={"contract_leave_accrual_default": False},
    ):
        assert is_pl_cl_accrual_eligible(contract, date(2026, 12, 20)) is False
    with patch(
        "website.leave_settings.load_leave_settings",
        return_value={"contract_leave_accrual_default": True},
    ):
        assert is_pl_cl_accrual_eligible(contract, date(2026, 12, 20)) is True


def test_calendar_end_does_not_make_probation_eligible():
    """Elapsed 6 months without HR confirm stays ineligible for PL/CL accrual."""
    admin = SimpleNamespace(
        employment_status=STATUS_PROBATION,
        probation_end_date=date(2026, 1, 1),
        employment_status_effective_from=date(2025, 7, 1),
    )
    assert is_pl_cl_accrual_eligible(admin, date(2026, 8, 20)) is False


def test_on_role_schedule_uses_status_effective_from():
    admin = SimpleNamespace(
        employment_status=STATUS_ON_ROLE,
        employment_status_effective_from=date(2026, 5, 10),
        doj=date(2025, 11, 10),
    )
    anchor = accrual_schedule_anchor_date(admin)
    assert anchor == date(2026, 5, 10)
    _pl, _cl, meta = build_yearly_accrual_schedule(anchor, 2026)
    assert meta["eligible_months"][0] == 5


def test_migration_confirmed_is_on_role():
    admin = SimpleNamespace(
        id=9,
        doj=date(2025, 1, 1),
        employment_status=None,
        probation_start_date=None,
        probation_end_date=None,
        probation_duration_months=None,
    )
    confirmed = SimpleNamespace(
        probation_end_date=date(2025, 7, 1),
        hr_decided_at=date(2025, 7, 5),
    )
    fake_query = SimpleNamespace(
        filter_by=lambda **_k: SimpleNamespace(
            order_by=lambda *_a: SimpleNamespace(first=lambda: confirmed)
        )
    )
    with patch("website.models.probation.ProbationReview") as pr:
        pr.query = fake_query
        fields = infer_legacy_employment_fields(admin, today=date(2026, 1, 1))
    assert fields["employment_status"] == STATUS_ON_ROLE
    assert fields["employment_status_effective_from"] == date(2025, 7, 5)


def test_migration_unconfirmed_stays_probation_even_after_calendar_end():
    admin = SimpleNamespace(
        id=10,
        doj=date(2024, 1, 1),
        employment_status=None,
        probation_start_date=None,
        probation_end_date=None,
        probation_duration_months=None,
    )

    class _Q:
        def filter_by(self, **kwargs):
            return self

        def order_by(self, *args):
            return self

        def first(self):
            return None

    with patch("website.models.probation.ProbationReview") as pr, patch(
        "website.probation_utils.effective_probation_end_date",
        return_value=date(2024, 7, 1),
    ):
        pr.query = _Q()
        fields = infer_legacy_employment_fields(admin, today=date(2026, 8, 21))
    assert fields["employment_status"] == STATUS_PROBATION
    assert fields["employment_status"] != STATUS_CONTRACT


def test_migration_does_not_touch_leave_balances():
    import inspect
    from website.employment_status import backfill_legacy_employment_status, infer_legacy_employment_fields

    src = inspect.getsource(backfill_legacy_employment_status)
    assert "leave_balance" not in src.lower()
    assert "LeaveBalance" not in src
    src2 = inspect.getsource(infer_legacy_employment_fields)
    assert "LeaveBalance" not in src2


def test_employment_status_module_does_not_import_punch():
    import inspect
    import website.employment_status as mod

    src = inspect.getsource(mod)
    assert "Punch" not in src
    assert "PunchSession" not in src
    assert "emp_type" not in src or "not department" in (mod.__doc__ or "")


def test_invalid_status_rejected():
    try:
        normalize_employment_status("intern", strict=True)
        raise AssertionError("expected error")
    except EmploymentStatusError:
        pass


def test_duration_from_dates():
    assert duration_months_from_dates(date(2025, 11, 10), date(2026, 5, 10)) == 6
    assert add_calendar_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
