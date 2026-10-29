# Customer registry access and ITAM feature flags

On your **vendor master** instance (e.g. Solviotec ops server), enable the Admin Customer registry in `backend_HRMS/.env`:

```env
SHOW_DEPLOYMENT_GUIDE=1
```

Optionally limit registry access to specific admin emails. `CUSTOMER_REGISTRY_EMAILS` is preferred; `DEPLOYMENT_GUIDE_EMAILS` remains accepted for backward compatibility:

```env
DEPLOYMENT_GUIDE_EMAILS=akumar4@saffotech.com,ops@yourcompany.com
```

On customer instances, leave the legacy flag unset or use:

```env
SHOW_DEPLOYMENT_GUIDE=0
```

Restart the backend after changing `.env`. Authorized platform admins can manage companies through **Admin → Customers**.

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
