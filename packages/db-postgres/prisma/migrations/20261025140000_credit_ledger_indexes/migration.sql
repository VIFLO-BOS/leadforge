-- Phase 3: credit settlement looks up a hold's capture and release rows by hold_id, and
-- reconciliation scans open holds by entry type and age.
CREATE INDEX "credit_ledger_hold_id_idx" ON "credit_ledger"("hold_id");
CREATE INDEX "credit_ledger_entry_type_created_at_idx" ON "credit_ledger"("entry_type", "created_at");
