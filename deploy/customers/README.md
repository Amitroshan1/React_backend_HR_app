# Customer instances

One folder per company at runtime. **Do not commit** full app copies or `.env` files.

```text
customers/
├── _template/           Instructions only (in git)
├── acme_corp/           Example name = DeployedCustomer.slug
│   └── React_backend_HR_app/
│       └── backend_HRMS/.env    ← ALWAYS this filename on the live instance
└── company_b/
    └── …
```

## Create a customer instance (checklist)

1. Register + Provision in Admin (or dry-run) → get `{slug}.env` from artifacts/download.
2. Copy/clone the **same** repo release into `customers/{slug}/React_backend_HR_app/`.
3. Place the generated file as:
   `customers/{slug}/React_backend_HR_app/backend_HRMS/.env`
4. Ensure MySQL DB `hrms_{slug}` exists (Provision can create it).
5. Run that instance on its own port/process; point subdomain at it.
6. Mark company **Active** in the registry.

See `_template/README.md` for a concrete copy command.
