-- Swap make and model columns in it_asset_units for Laptop units.
-- make currently contains "model" data, model currently contains "laptop code" data.
-- This migration swaps them to match the corrected UI labels.

UPDATE it_asset_units
SET make  = model,
    model = make
WHERE hw_type = 'Laptop'
  AND (make IS NOT NULL OR model IS NOT NULL);
