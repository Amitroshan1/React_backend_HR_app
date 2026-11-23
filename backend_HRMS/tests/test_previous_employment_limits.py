from datetime import date

from website.previous_employment import (
    parse_experience_years,
    validate_previous_employment_dates,
)


def test_rejects_huge_and_scientific_years():
    assert parse_experience_years("5000000000000000000")[0] is None
    assert parse_experience_years("5e18")[0] is None
    assert parse_experience_years("-1")[0] is None
    assert parse_experience_years("50.1")[0] is None
    assert parse_experience_years("2.55")[0] is None


def test_accepts_valid_years():
    yrs, err = parse_experience_years("2.5")
    assert err is None and yrs == 2.5
    yrs, err = parse_experience_years("0")
    assert err is None and yrs == 0.0
    yrs, err = parse_experience_years("50")
    assert err is None and yrs == 50.0
    yrs, err = parse_experience_years("")
    assert err is None and yrs == 0.0


def test_leaving_date_not_future_or_after_doj():
    today = date(2026, 11, 6)
    doj_here = date(2024, 1, 15)
    dol = date(2025, 6, 1)
    start, err = validate_previous_employment_dates(
        dol, 2.0, company_doj=doj_here, today=today
    )
    assert err is not None

    start, err = validate_previous_employment_dates(
        date(2023, 6, 1), 2.0, company_doj=doj_here, today=today
    )
    assert err is None
    assert start < date(2023, 6, 1)


def test_leaving_not_before_working_age():
    today = date(2026, 11, 6)
    dob = date(2000, 5, 1)
    start, err = validate_previous_employment_dates(
        date(2010, 1, 1), 1.0, dob=dob, today=today
    )
    assert err is not None
