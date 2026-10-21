-- Cached balances are derived exclusively from posted ledger entries. Reject
-- direct application writes while allowing the nested journal-posting trigger
-- to maintain the projection.
CREATE FUNCTION "protect_ledger_account_balance_projection"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW."cached_balance_minor" <> 0 THEN
            RAISE EXCEPTION 'Ledger account balances must start at zero';
        END IF;

        RETURN NEW;
    END IF;

    IF NEW."cached_balance_minor" IS DISTINCT FROM OLD."cached_balance_minor"
       AND pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Ledger account balances may only be changed by posting a journal';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "ledger_accounts_balance_projection_guard"
BEFORE INSERT OR UPDATE OF "cached_balance_minor" ON "ledger_accounts"
FOR EACH ROW
EXECUTE FUNCTION "protect_ledger_account_balance_projection"();
