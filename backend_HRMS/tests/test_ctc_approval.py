from website.ctc_approval_service import increment_pct


def test_increment_pct_none_when_no_old():
    assert increment_pct(0, 900000) is None
    assert increment_pct(None, 900000) is None


def test_increment_pct_roundtrip():
    assert increment_pct(1000000, 1250000) == 25.0
    assert increment_pct(1000000, 800000) == -20.0
