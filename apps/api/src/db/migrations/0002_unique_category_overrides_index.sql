-- The schema-as-code declares the (space_id, merchant_normalized) pair on
-- category_overrides as a UNIQUE index so we can `ON CONFLICT (space_id,
-- merchant_normalized) DO UPDATE`. The original migration emitted only a
-- non-unique btree index. Replace it.
DROP INDEX IF EXISTS "category_overrides_space_merchant_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "category_overrides_space_merchant_unique"
  ON "category_overrides" ("space_id", "merchant_normalized");
