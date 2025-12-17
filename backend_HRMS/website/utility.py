from .models.attendance import LeaveApplication
from datetime import date



def is_on_leave(admin_id, today):
    return LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= today,
        LeaveApplication.end_date >= today
    ).first() is not None



def is_wfh_allowed(admin_id):
    # Example: reuse leave table with leave_type = 'WFH'
    return LeaveApplication.query.filter(
        LeaveApplication.admin_id == admin_id,
        LeaveApplication.leave_type == "WFH",
        LeaveApplication.status == "Approved",
        LeaveApplication.start_date <= date.today(),
        LeaveApplication.end_date >= date.today()
    ).first() is not None
