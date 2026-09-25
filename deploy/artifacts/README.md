# Provision artifacts

Phase 2 writes generated customer env files here when
`PROVISION_ARTIFACTS_DIR` points at this folder.

```text
artifacts/
└── {slug}/
    └── .env          e.g. artifacts/acme_corp/.env
```

Downloads from the Admin UI are also named `{slug}.env`.

**Never commit real `.env` files.** Copy into
`customers/{slug}/…/backend_HRMS/.env` on the customer instance.
