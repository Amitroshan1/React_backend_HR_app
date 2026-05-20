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
