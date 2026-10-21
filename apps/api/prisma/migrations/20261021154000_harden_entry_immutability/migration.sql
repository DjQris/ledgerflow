-- An update must protect both sides of a ledger-entry reassignment. Checking
-- only NEW.transaction_id would allow an entry to be moved out of a posted
-- journal and would silently invalidate its financial history.
CREATE OR REPLACE FUNCTION "enforce_ledger_entry_mutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    old_journal_status "ledger_transaction_status";
    new_journal_status "ledger_transaction_status";
BEGIN
    IF TG_OP IN ('UPDATE', 'DELETE') THEN
        SELECT "status"
        INTO old_journal_status
        FROM "ledger_transactions"
        WHERE "id" = OLD."transaction_id";

        IF old_journal_status = 'posted' THEN
            RAISE EXCEPTION 'Entries in a posted ledger transaction are immutable';
        END IF;
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT "status"
        INTO new_journal_status
        FROM "ledger_transactions"
        WHERE "id" = NEW."transaction_id";

        IF new_journal_status = 'posted' THEN
            RAISE EXCEPTION 'Entries in a posted ledger transaction are immutable';
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;

    RETURN NEW;
END;
$$;
