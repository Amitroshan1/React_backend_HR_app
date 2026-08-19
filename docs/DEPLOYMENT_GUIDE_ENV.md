# Enable deployment guide in Admin Panel

On your **vendor master** instance (e.g. Solviotec ops server), add to `backend_HRMS/.env`:

```env
SHOW_DEPLOYMENT_GUIDE=1
```

Optional — limit to specific admin emails:

```env
DEPLOYMENT_GUIDE_EMAILS=akumar4@saffotech.com,ops@yourcompany.com
```

On **each customer’s dedicated server**, leave unset or use:

```env
SHOW_DEPLOYMENT_GUIDE=0
```

Restart the backend after changing `.env`.

Admins will see **New customer deployment → Open guide** on the Admin Panel and a full checklist at `/admin/deployment-guide`.

---

# ITAM feature flags (default OFF)

Inventory / asset-management rollout flags. Leave unset or `0` until the matching phase is ready. See `docs/itam/P0_CONTRACTS.md` and `docs/itam/P0_ROLLOUT_CHECKLIST.md`.

```env
ITAM_TRANSITIONS_V1=0
ITAM_TIMELINE_V1=0
ITAM_LIFECYCLE_V1=0
ITAM_API_FIRST_V1=0
ITAM_SELF_SERVICE_V1=0
ITAM_OFFBOARD_GATE_V1=0
```
