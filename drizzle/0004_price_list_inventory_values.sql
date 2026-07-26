-- Source: Insurance inventory 2026.xlsx, Price List tab.
-- User adjustment: every $20.00/ft rule is applied at $25.00/ft.
-- Preserve manually entered prices and leave unmatched species/sizes unchanged.
UPDATE `inventory_groups`
SET `price_cents` = CASE
  -- Live Oak and Ranch Oak values are listed per tree by size.
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '36"' THEN 1500
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '3"' THEN 27500
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '4"' THEN 37500
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '5"' THEN 50000
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '6"' THEN 250000
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '9"' THEN 350000
  WHEN lower(trim(`species`)) IN ('live oak', 'live oaks', 'ranch oak') AND trim(`height`) = '12"+' THEN 450000

  -- Ligustrum values are listed per tree for these four sizes.
  WHEN lower(trim(`species`)) = 'ligustrum' AND trim(`height`) = '4''' THEN 1500
  WHEN lower(trim(`species`)) = 'ligustrum' AND trim(`height`) = '6''' THEN 20000
  WHEN lower(trim(`species`)) = 'ligustrum' AND trim(`height`) = '8''' THEN 25000
  WHEN lower(trim(`species`)) = 'ligustrum' AND trim(`height`) = '10''' THEN 30000

  -- Calophyllum has one per-tree size; all other listed heights use $25/ft.
  WHEN lower(trim(`species`)) IN ('calophyllum', 'calophylum') AND trim(`height`) = '36"' THEN 1500

  -- Species with a flat per-tree price.
  WHEN lower(trim(`species`)) = 'coconut' THEN 10000
  WHEN lower(trim(`species`)) = 'banyan' THEN 200000

  -- Price-list entries originally marked $20/ft, increased to $25/ft.
  WHEN lower(trim(`species`)) IN (
    'bald cypress', 'eagleston holly', 'wax myrtle', 'pine', 'densa pine',
    'red cedar', 'red maple', 'japanese blueberry', 'blueberry',
    'dahoon holly', 'shady lady', 'thatch palm', 'fox tail', 'foxtail',
    'silver buttonwood', 'silver button', 'orander geigar', 'orange geigar', 'orange geiger',
    'white geigar', 'white geiger', 'pigeon plum', 'yellow tabebuia', 'yellow tab',
    'alexander palm', 'alexander', 'christmas palm', 'gumbo limbo', 'gumbo',
    'simson stopper', 'guava', 'calophyllum', 'calophylum'
  ) AND (
    trim(`height`) = '36"'
    OR instr(trim(`height`), char(39)) > 0
    OR (trim(`height`) <> '' AND trim(`height`) NOT GLOB '*[^0-9.]*')
  ) THEN CASE
    WHEN trim(`height`) = '36"' THEN 7500
    WHEN instr(trim(`height`), char(39)) > 0
      THEN CAST(ROUND(CAST(substr(trim(`height`), 1, instr(trim(`height`), char(39)) - 1) AS REAL) * 2500) AS INTEGER)
    ELSE CAST(ROUND(CAST(trim(`height`) AS REAL) * 2500) AS INTEGER)
  END

  -- Price-list entries that retain their original per-foot rates.
  WHEN lower(trim(`species`)) = 'podocarpus maki' AND (
    trim(`height`) = '36"'
    OR instr(trim(`height`), char(39)) > 0
    OR (trim(`height`) <> '' AND trim(`height`) NOT GLOB '*[^0-9.]*')
  ) THEN CASE
    WHEN trim(`height`) = '36"' THEN 9000
    WHEN instr(trim(`height`), char(39)) > 0
      THEN CAST(ROUND(CAST(substr(trim(`height`), 1, instr(trim(`height`), char(39)) - 1) AS REAL) * 3000) AS INTEGER)
    ELSE CAST(ROUND(CAST(trim(`height`) AS REAL) * 3000) AS INTEGER)
  END

  WHEN lower(trim(`species`)) IN ('podocarpus weeping', 'weeping podo', 'sea grape') AND (
    trim(`height`) = '36"'
    OR instr(trim(`height`), char(39)) > 0
    OR (trim(`height`) <> '' AND trim(`height`) NOT GLOB '*[^0-9.]*')
  ) THEN CASE
    WHEN trim(`height`) = '36"' THEN 10500
    WHEN instr(trim(`height`), char(39)) > 0
      THEN CAST(ROUND(CAST(substr(trim(`height`), 1, instr(trim(`height`), char(39)) - 1) AS REAL) * 3500) AS INTEGER)
    ELSE CAST(ROUND(CAST(trim(`height`) AS REAL) * 3500) AS INTEGER)
  END

  WHEN lower(trim(`species`)) = 'garcinia' AND (
    trim(`height`) = '36"'
    OR instr(trim(`height`), char(39)) > 0
    OR (trim(`height`) <> '' AND trim(`height`) NOT GLOB '*[^0-9.]*')
  ) THEN CASE
    WHEN trim(`height`) = '36"' THEN 15000
    WHEN instr(trim(`height`), char(39)) > 0
      THEN CAST(ROUND(CAST(substr(trim(`height`), 1, instr(trim(`height`), char(39)) - 1) AS REAL) * 5000) AS INTEGER)
    ELSE CAST(ROUND(CAST(trim(`height`) AS REAL) * 5000) AS INTEGER)
  END

  ELSE `price_cents`
END
WHERE `price_cents` = 0;
