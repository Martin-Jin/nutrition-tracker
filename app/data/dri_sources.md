# DRI data sources

All values in `data/dri.json` were transcribed from the NASEM (National
Academies of Sciences, Engineering, and Medicine) / IOM Dietary Reference
Intake summary tables, hosted on NCBI Bookshelf. Fetched 2026-09-10.

Book: *Dietary Reference Intakes for Sodium and Potassium* (2019) and prior
DRI reports, compiled into the standard "Appendix J" DRI summary tables
reproduced at:

- https://www.ncbi.nlm.nih.gov/books/NBK545442/

## Table-by-table mapping

| Table | Content | Used for |
|---|---|---|
| appJ_tab4 | RDA/AI: Total Water and Macronutrients | `protein_g`, `carb_g`, `fiber_g`, `fat_g` (infant AI grams only; adult/child fat is AMDR %, not gram RDA/AI — see comment field in dri.json) |
| appJ_tab2 | RDA/AI: Vitamins | `vitA_ug`, `vitC_mg`, `vitD_ug`, `vitE_mg`, `vitK_ug`, `thiamin_mg`, `riboflavin_mg`, `niacin_mg`, `vitB6_mg`, `folate_ug`, `vitB12_ug`, `pantothenic_mg`, `biotin_ug`, `choline_mg` |
| appJ_tab3 | RDA/AI: Elements | `calcium_mg`, `copper_ug`, `iodine_ug`, `iron_mg`, `magnesium_mg`, `manganese_mg`, `phosphorus_mg`, `selenium_ug`, `zinc_mg`, `potassium_mg`, `sodium_mg` |
| appJ_tab8 | Tolerable Upper Intake Levels: Vitamins | `ul_value` for `vitA_ug`, `vitD_ug`, `vitE_mg`, `niacin_mg`, `vitB6_mg`, `folate_ug`, `choline_mg` |
| appJ_tab9 | Tolerable Upper Intake Levels: Elements | `ul_value` for `calcium_mg`, `phosphorus_mg`, `magnesium_mg`, `iron_mg`, `zinc_mg`, `iodine_ug`, `selenium_ug`, `copper_ug`, `manganese_mg` |
| appJ_tab7 | Chronic Disease Risk Reduction Intakes (sodium) | `ul_value` for `sodium_mg` (CDRR, not a classical UL — NASEM has not set a sodium UL for most groups; CDRR is the closest published ceiling and is noted as such in dri.json) |
| appJ_tab5 | Acceptable Macronutrient Distribution Ranges (AMDR) | Referenced only for the `fat_g` comment field; no gram values populated for children/adults since NASEM publishes this nutrient as a percent-of-energy range, not a gram target — populating an estimated gram value would violate the project's never-guess rule |
| appJ_tab6 | Additional macronutrient recommendations (cholesterol, trans fat, saturated fat, added sugars) | Not modeled — no corresponding nutrient key in dri.json (out of scope per task spec) |

## Notes on transcription

- Bold values in the NASEM tables denote RDA; values with an asterisk (*)
  denote AI. This distinction is preserved in dri.json via each nutrient's
  `"type"` field (`"RDA"` or `"AI"`).
- `"ND"` (not determinable) in the UL tables is stored as `null` in
  `ul_value`, never as 0 or an invented number.
- Iodine and biotin DRI targets are transcribed in full from the same
  authoritative tables even though USDA FoodData Central does not carry
  per-food values for either nutrient (0/200 sampled SR Legacy foods have
  either field, per prior project verification in CLAUDE.md). Both are
  marked `"trackable": false` so the app's solver excludes them from
  pass/fail logic while still surfacing the real DRI number to the user.
- Sodium's `ul_value` is the CDRR (Chronic Disease Risk Reduction Intake)
  from appJ_tab7, since NASEM has not established a classical UL for sodium
  in most life-stage groups (elements UL table shows "ND" for sodium
  everywhere). This is noted in the `comment` field on `sodium_mg` in
  dri.json.
- Fat (`fat_g`) has no adult/child gram RDA/AI in NASEM tables — only an
  AMDR (Acceptable Macronutrient Distribution Range) expressed as percent
  of energy (20-35% for adults, per appJ_tab5). Per the project's
  never-guess rule, `fat_g` is `null` for all groups except infants (0-6mo:
  31 g/d AI; 7-12mo: 30 g/d AI), where NASEM does publish a gram AI value.
  This is documented in the `comment` field on `fat_g` in dri.json.
