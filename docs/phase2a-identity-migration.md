# Phase 2A identity migration

The previous schema identifies a wallet by a unique simulated `test-*` owner reference. That reference is not an authenticated user. Phase 2A keeps it and adds a required `wallets.user_id` reference without moving or recreating any financial row.

The migration creates `users`, `auth_sessions`, and `refresh_tokens`, then inserts one provisional user per existing wallet. Each backfilled user receives the wallet's UUID as its ID, a deterministic `simulated-<wallet-uuid>@ledgerflow.invalid` email, customer role, suspended status, and no password hash. These are non-deliverable identifiers, not login credentials. The migration checks for unowned wallets before making `user_id` non-null and adding the restrictive foreign key. It is wrapped in a PostgreSQL transaction so an error rolls back the entire schema/data change. New wallet creation provisions its user, wallet, ledger account, and audit event in one application transaction.

Before applying this migration to an existing installation:

1. Take a database backup and record counts and a balance fingerprint for `wallets`, `ledger_accounts`, `ledger_transactions`, `ledger_entries`, `transfers`, and `audit_events`.
2. Stop the Phase 1 API and other wallet writers. The old code cannot satisfy the new required `user_id` constraint.
3. Run `npm run db:migrate:deploy`, then `npm run db:generate` and deploy the new API.
4. Confirm every wallet has a user and that financial row counts and balances match the recorded pre-migration values. Run `npm run ledger:verify` and the isolated integration suite.

Example read-only ownership check:

```sql
SELECT count(*) AS unowned_wallets
FROM wallets AS wallet
LEFT JOIN users AS owner ON owner.id = wallet.user_id
WHERE owner.id IS NULL;
```

The result must be zero. Do not treat a provisional user as enrolled: no password, session, or token is issued by Phase 2A. The legacy simulated actor header remains local-development-only and is not authorization. Future identity enrollment must explicitly verify ownership before setting real email or credentials. Existing audit actor strings are historical records and are not rewritten into user IDs.

## Reserved module boundaries

- `users/` owns identity records and currently provisions only suspended simulated users.
- `auth/` is reserved for future enrollment and sign-in services, request DTOs, and authentication guards.
- `security/` is reserved for session and refresh-token lifecycle services.
- `access-control/` is reserved for role policy definitions, decorators, and authorization guards.

The latter three modules deliberately have no active providers or HTTP routes in Phase 2A. Their behavior and credentials must be designed and tested before activation.
