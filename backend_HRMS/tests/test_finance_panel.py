"""Finance is its own panel and only pays fully approved claims."""
from website.finance import apply_claim_payout, claim_is_fully_approved
from website.plan_features import is_accounts_department, is_finance_department


class _Item:
    def __init__(self, status):
        self.status = status


class _Claim:
    def __init__(self, items, payout_status=None):
        self.expenses = items
        self.payout_status = payout_status
        self.payout_at = None
        self.payout_by_admin_id = None


def test_finance_department_does_not_open_accounts():
    assert is_finance_department("Finance")
    assert is_finance_department("Finance Department")
    assert is_accounts_department("Finance") is False
    assert is_accounts_department("Accounts") is True
    assert is_finance_department("Accounts") is False
    assert is_finance_department("Financial analyst") is False


def test_payout_requires_every_line_approved():
    claim = _Claim([_Item("Approved"), _Item("Pending")])
    assert claim_is_fully_approved(claim.expenses) is False
    try:
        apply_claim_payout(claim, "paid", 9)
        raised = False
    except ValueError:
        raised = True
    assert raised is True
    assert claim.payout_status is None


def test_paid_claim_cannot_be_held_later():
    claim = _Claim([_Item("Approved")], payout_status="paid")
    try:
        apply_claim_payout(claim, "hold", 9)
        raised = False
    except ValueError:
        raised = True
    assert raised is True


def test_hold_then_paid():
    claim = _Claim([_Item("Approved")])
    apply_claim_payout(claim, "hold", 4)
    assert claim.payout_status == "hold"
    apply_claim_payout(claim, "paid", 4)
    assert claim.payout_status == "paid"
    assert claim.payout_by_admin_id == 4
