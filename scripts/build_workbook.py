"""
Build nutrition_workbook.xlsx from app/data/dri.json and app/data/food_catalogue.json
-- the same files the web app reads, so the workbook can never drift from it.

Sheets:
  1. My Profile      -- input cells: age, sex/life-stage, weight, height, activity
  2. DRI Values      -- all nutrients x all life stages, with a live lookup
                        formula resolving the profile inputs to a personal
                        target column
  3. Food Catalogue  -- the fetched catalogue, incl. FDC ID + source link
  4. Sources & Notes -- citations and the iodine/biotin data-gap statement

Usage: python scripts/build_workbook.py
"""
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

HERE = os.path.dirname(__file__)
DATA_DIR = os.path.join(HERE, "..", "app", "data")
OUT_PATH = os.path.join(HERE, "..", "nutrition_workbook.xlsx")

HEADER_FILL = PatternFill("solid", fgColor="1F3A2E")
HEADER_FONT = Font(color="FFFFFF", bold=True)
INPUT_FILL = PatternFill("solid", fgColor="FFF6E0")


def load_data():
    with open(os.path.join(DATA_DIR, "dri.json"), encoding="utf-8") as f:
        dri = json.load(f)
    with open(os.path.join(DATA_DIR, "food_catalogue.json"), encoding="utf-8") as f:
        foods = json.load(f)
    return dri, foods


def style_header_row(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT


def build_profile_sheet(wb, dri):
    ws = wb.active
    ws.title = "My Profile"
    ws["A1"] = "My Profile"
    ws["A1"].font = Font(bold=True, size=14)

    rows = [
        ("Age (years)", 30),
        ("Sex / life stage", "male"),
        ("Weight (kg)", 70),
        ("Height (cm)", 175),
        ("Activity level", "moderate"),
    ]
    ws["A3"] = "Field"; ws["B3"] = "Value"
    style_header_row(ws, 3, 2)
    for i, (label, default) in enumerate(rows, start=4):
        ws.cell(row=i, column=1, value=label)
        cell = ws.cell(row=i, column=2, value=default)
        cell.fill = INPUT_FILL

    # data validation for sex and activity dropdowns
    dv_sex = DataValidation(type="list", formula1='"male,female,pregnant,lactating"', allow_blank=False)
    ws.add_data_validation(dv_sex)
    dv_sex.add(ws["B5"])
    dv_activity = DataValidation(type="list", formula1='"sedentary,light,moderate,active,very_active"', allow_blank=False)
    ws.add_data_validation(dv_activity)
    dv_activity.add(ws["B8"])

    # Bounded ranges, not whole-column refs ($B:$B) -- whole-column array
    # arithmetic inside MATCH is technically valid Excel but evaluates far
    # too slowly in some engines (confirmed: a formula-evaluation check of
    # this exact pattern with whole-column refs did not return in a
    # reasonable time, while the identical formula bounded to the actual
    # data range evaluates instantly). Bounding to the real row count is
    # both correct and fast everywhere.
    last_row = 1 + len(dri["lifeStages"])
    ws["A10"] = "Matched life stage:"
    ws["B10"] = (
        f"=IFERROR(INDEX('DRI Values'!A2:A{last_row}, MATCH(1, "
        f"('DRI Values'!$B$2:$B${last_row}=$B$5)*('DRI Values'!$C$2:$C${last_row}<=$B$4)*"
        f"('DRI Values'!$D$2:$D${last_row}>=$B$4), 0)), \"no match\")"
    )
    ws.column_dimensions['A'].width = 22
    ws.column_dimensions['B'].width = 40
    return ws


def build_dri_sheet(wb, dri):
    ws = wb.create_sheet("DRI Values")
    life_stages = dri["lifeStages"]
    nutrients = dri["nutrients"]
    nutrient_keys = list(nutrients.keys())

    # Layout: one row per life stage (id, sex, age_min, age_max, label), then
    # one column per nutrient. This lets the profile sheet's MATCH/INDEX find
    # the row for the user's age/sex, and lets "Your Targets" pull across.
    headers = ["life_stage_id", "sex", "age_min", "age_max", "label"] + [
        f"{nutrients[k]['label']} ({nutrients[k]['unit']})" for k in nutrient_keys
    ]
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header_row(ws, 1, len(headers))

    for r, ls in enumerate(life_stages, start=2):
        ws.cell(row=r, column=1, value=ls["id"])
        ws.cell(row=r, column=2, value=ls["sex"])
        ws.cell(row=r, column=3, value=ls["age_min"])
        ws.cell(row=r, column=4, value=ls["age_max"])
        ws.cell(row=r, column=5, value=ls["label"])
        for c, k in enumerate(nutrient_keys, start=6):
            val = nutrients[k]["values"].get(ls["id"])
            ws.cell(row=r, column=c, value=val if val is not None else "n/a")

    ws.column_dimensions['A'].width = 18
    ws.column_dimensions['E'].width = 22
    for c in range(6, 6 + len(nutrient_keys)):
        ws.column_dimensions[get_column_letter(c)].width = 14

    # "Your Targets" row at the bottom: live lookup based on My Profile inputs
    target_row = len(life_stages) + 3
    ws.cell(row=target_row - 1, column=1, value="Your personal targets (from My Profile):").font = Font(bold=True)
    ws.cell(row=target_row, column=5, value="YOUR TARGET")
    for c, k in enumerate(nutrient_keys, start=6):
        col_letter = get_column_letter(c)
        formula = (
            f"=IFERROR(INDEX({col_letter}2:{col_letter}{1+len(life_stages)}, "
            f"MATCH(1, (B2:B{1+len(life_stages)}='My Profile'!$B$5)*"
            f"(C2:C{1+len(life_stages)}<='My Profile'!$B$4)*"
            f"(D2:D{1+len(life_stages)}>='My Profile'!$B$4), 0)), \"no match\")"
        )
        ws.cell(row=target_row, column=c, value=formula)
    return ws


def build_catalogue_sheet(wb, foods):
    ws = wb.create_sheet("Food Catalogue")
    if not foods:
        return ws
    # column order: identifying fields first, then all nutrient fields present
    id_fields = ["category", "name", "common_names", "fdc_id", "source_name", "source_url", "published_date"]
    nutrient_fields = [k for k in foods[0].keys() if k not in id_fields]
    headers = id_fields + nutrient_fields
    for c, h in enumerate(headers, start=1):
        ws.cell(row=1, column=c, value=h)
    style_header_row(ws, 1, len(headers))

    for r, food in enumerate(foods, start=2):
        for c, field in enumerate(headers, start=1):
            val = food.get(field)
            ws.cell(row=r, column=c, value=val if val is not None else "no data")

    ws.column_dimensions['B'].width = 45
    ws.column_dimensions['C'].width = 30
    ws.column_dimensions['F'].width = 40
    ws.freeze_panes = "A2"
    return ws


def build_sources_sheet(wb):
    ws = wb.create_sheet("Sources & Notes")
    ws["A1"] = "Sources & Notes"
    ws["A1"].font = Font(bold=True, size=14)
    notes = [
        "",
        "Nutrient requirements (DRI Values sheet):",
        "National Academies of Sciences, Engineering, and Medicine (NASEM/IOM),",
        "Dietary Reference Intakes Summary Tables -- NCBI Bookshelf NBK545442",
        "(https://www.ncbi.nlm.nih.gov/books/NBK545442/). See app/data/dri_sources.md",
        "in the project repository for the exact table citations used per nutrient.",
        "",
        "Food nutrient values (Food Catalogue sheet):",
        "USDA FoodData Central, SR Legacy. Every row includes its own fdc_id and",
        "source_url pointing to the exact FDC record used -- values are fetched,",
        "never estimated. Fetched via scripts/fetch_foods.py.",
        "",
        "KNOWN DATA GAP -- Iodine and Biotin:",
        "USDA FoodData Central (SR Legacy) does not measure iodine or biotin in",
        "foods at all -- these columns will show \"no data\" for every food in the",
        "catalogue. The DRI targets for both ARE included in the DRI Values sheet",
        "(they do have official NASEM targets), but no combination of foods from",
        "this catalogue can ever be checked against them, because the food-side",
        "data doesn't exist. The web app excludes both from its solver's pass/fail",
        "logic for this reason and shows them separately as \"not tracked\".",
        "",
        "Several other nutrients (vitamin D, B12, choline, vitamin K, selenium)",
        "have sparse -- not absent -- coverage in SR Legacy. A food missing one of",
        "these shows \"no data\", which is NOT the same as a true zero amount.",
        "",
        "This tool is for general planning purposes only and does not replace",
        "advice from a registered dietitian or physician.",
    ]
    for i, line in enumerate(notes, start=2):
        ws.cell(row=i, column=1, value=line)
    ws.column_dimensions['A'].width = 90
    return ws


def main():
    dri, foods = load_data()
    wb = Workbook()
    build_profile_sheet(wb, dri)
    build_dri_sheet(wb, dri)
    build_catalogue_sheet(wb, foods)
    build_sources_sheet(wb)
    wb.save(OUT_PATH)
    print(f"Wrote {OUT_PATH}")
    print(f"Life stages: {len(dri['lifeStages'])}, Nutrients: {len(dri['nutrients'])}, Foods: {len(foods)}")


if __name__ == "__main__":
    main()
