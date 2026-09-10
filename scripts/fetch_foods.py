"""
Fetch curated common foods from USDA FoodData Central (SR Legacy) and emit
app/data/food_catalogue.json + app/data/food_catalogue.csv -- app/data is the
single source of truth the web app fetches from at runtime.

Never guesses a nutrient value: every number comes straight from the FDC API
response for the matched fdcId. If USDA has no value for a nutrient on a
given food, the field is stored as null ("no data"), never 0 -- 0 is only
used when USDA explicitly reports a zero amount.

Usage: FDC_API_KEY=<key> python scripts/fetch_foods.py
Falls back to DEMO_KEY if FDC_API_KEY is not set (heavily rate-limited).
"""
import json
import os
import sys
import time
import urllib.request
import urllib.parse

sys.path.insert(0, os.path.dirname(__file__))
from food_list import FOOD_QUERIES

API_KEY = os.environ.get("FDC_API_KEY", "DEMO_KEY")
CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", ".cache", "foods")
os.makedirs(CACHE_DIR, exist_ok=True)

# Map FDC nutrient names -> our internal keys + target unit.
# "unit" is what we store the value as; FDC sometimes reports IU for
# vitamins A/D/E, which we skip in favor of the RAE/mg/µg forms below.
NUTRIENT_MAP = {
    "Energy": ("kcal", "KCAL"),
    "Protein": ("protein_g", "G"),
    "Carbohydrate, by difference": ("carb_g", "G"),
    "Fiber, total dietary": ("fiber_g", "G"),
    "Sugars, total including NLEA": ("sugar_g", "G"),
    "Sugars, total": ("sugar_g", "G"),
    "Total lipid (fat)": ("fat_g", "G"),
    "Fatty acids, total saturated": ("sat_fat_g", "G"),
    "Calcium, Ca": ("calcium_mg", "MG"),
    "Phosphorus, P": ("phosphorus_mg", "MG"),
    "Magnesium, Mg": ("magnesium_mg", "MG"),
    "Potassium, K": ("potassium_mg", "MG"),
    "Sodium, Na": ("sodium_mg", "MG"),
    "Iron, Fe": ("iron_mg", "MG"),
    "Zinc, Zn": ("zinc_mg", "MG"),
    "Selenium, Se": ("selenium_ug", "UG"),
    "Copper, Cu": ("copper_ug", "MG"),  # FDC reports mg; convert to ug below
    "Manganese, Mn": ("manganese_mg", "MG"),
    "Vitamin A, RAE": ("vitA_ug", "UG"),
    "Vitamin D (D2 + D3)": ("vitD_ug", "UG"),
    "Vitamin E (alpha-tocopherol)": ("vitE_mg", "MG"),
    "Vitamin K (phylloquinone)": ("vitK_ug", "UG"),
    "Vitamin C, total ascorbic acid": ("vitC_mg", "MG"),
    "Thiamin": ("thiamin_mg", "MG"),
    "Riboflavin": ("riboflavin_mg", "MG"),
    "Niacin": ("niacin_mg", "MG"),
    "Vitamin B-6": ("vitB6_mg", "MG"),
    "Folate, total": ("folate_ug", "UG"),
    "Vitamin B-12": ("vitB12_ug", "UG"),
    "Pantothenic acid": ("pantothenic_mg", "MG"),
    "Choline, total": ("choline_mg", "MG"),
    # Iodine, Biotin: intentionally absent from SR Legacy. Not mapped here;
    # left as null/"no data" for every food, see CLAUDE.md known-issues.
}

ALL_FIELD_KEYS = sorted(set(v[0] for v in NUTRIENT_MAP.values()))

# Manual alias overrides for foods whose everyday name USDA doesn't carry in
# any field (checked: commonNames is empty for these on the live API as of
# this fetch). This is a search-only annotation, not a nutrient value -- it
# does not touch any macro/micro figure, so it doesn't violate the
# "never guess a nutrient value" rule. Extend this dict if another required
# food turns out to have the same gap.
MANUAL_ALIASES = {
    169979: "napa cabbage, chinese cabbage, pe-tsai",  # Cabbage, chinese (pe-tsai), raw
}


def http_get_json(url, retries=5, backoff=20):
    last_err = None
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                wait = backoff * (attempt + 1)
                print(f"  HTTP {e.code}, retrying in {wait}s (attempt {attempt+1}/{retries})...")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError) as e:
            last_err = e
            if attempt < retries - 1:
                wait = backoff * (attempt + 1)
                print(f"  network error ({e}), retrying in {wait}s...")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"failed after {retries} attempts: {url}") from last_err


def search_food(query, api_key):
    cache_file = os.path.join(CACHE_DIR, f"search_{query.replace(' ', '_').replace('/', '-')}.json")
    if os.path.exists(cache_file):
        with open(cache_file, encoding="utf-8") as f:
            return json.load(f)
    qs = urllib.parse.urlencode({
        "query": query, "dataType": "SR Legacy", "pageSize": 25, "api_key": api_key
    })
    url = f"https://api.nal.usda.gov/fdc/v1/foods/search?{qs}"
    data = http_get_json(url)
    with open(cache_file, "w", encoding="utf-8") as f:
        json.dump(data, f)
    time.sleep(0.3)
    return data


def pick_match(results, preferred_substring):
    """
    Only ever returns a food we can positively identify against
    `preferred_substring` (exact match, then substring match). Never falls
    back to "top search hit" -- FDC's relevance ranking degrades badly when
    a query includes a generic modifier word like "raw" that isn't actually
    part of the target food's description (e.g. "almonds raw" ranks
    "Nuts, almonds" far down and an unrelated food first). Silently taking
    foods[0] in that case would mean guessing which food a nutrient row
    describes -- not acceptable. Caller must supply a `preferred_substring`
    for every query; a miss is reported and requires fixing food_list.py.
    """
    foods = results.get("foods", [])
    if not foods or not preferred_substring:
        return None
    for f in foods:
        if f["description"].strip().lower() == preferred_substring.strip().lower():
            return f
    for f in foods:
        if preferred_substring.lower() in f["description"].lower():
            return f
    return None


def extract_nutrients(food_search_hit):
    """
    foods/search hits already embed foodNutrients with name/unitName/value.

    IMPORTANT: FDC reports "Energy" TWICE per food -- once in KCAL and once
    in KJ (same quantity, different unit). NUTRIENT_MAP keys on name alone,
    so without a unit check whichever entry appears second in the array
    silently overwrites the first -- e.g. napa cabbage's kcal value (16.0)
    was being clobbered by its kJ value (67.0), which is wrong by ~4x and
    would corrupt every food's stored "kcal" whenever kJ sorts after kcal.
    Guard against this generally: skip any nutrient entry whose reported
    unit doesn't match what NUTRIENT_MAP expects for that field.
    """
    out = {k: None for k in ALL_FIELD_KEYS}
    for n in food_search_hit.get("foodNutrients", []):
        name = n.get("nutrientName")
        if name not in NUTRIENT_MAP:
            continue
        field, expected_unit = NUTRIENT_MAP[name]
        unit = (n.get("unitName") or "").upper()
        if unit != expected_unit:
            continue
        val = n.get("value")
        if val is None:
            continue
        # FDC's "Copper, Cu" is reported in mg; we store as ug for consistency
        # with our display unit map (choline/copper/etc. shown in µg).
        if field == "copper_ug":
            val = val * 1000.0
        out[field] = round(val, 4)
    return out


def main():
    if API_KEY == "DEMO_KEY":
        print("WARNING: using DEMO_KEY (10 req/hr). Set FDC_API_KEY for a real key.")

    catalogue = []
    missing = []

    for category, query, preferred in FOOD_QUERIES:
        print(f"[{category}] searching: {query}")
        try:
            results = search_food(query, API_KEY)
        except Exception as e:
            # Never let one unrecoverable request abort the whole run and
            # lose everything fetched so far -- record it as missing and
            # keep going; write_catalogue() below still runs at the end.
            print(f"  FAILED: {e}")
            missing.append((category, query))
            continue
        if "error" in results:
            print(f"  ERROR: {results['error']}")
            missing.append((category, query))
            continue
        match = pick_match(results, preferred)
        if match is None:
            print(f"  NO MATCH for '{query}'")
            missing.append((category, query))
            continue

        fdc_id = match["fdcId"]
        name = match["description"]
        nutrients = extract_nutrients(match)

        entry = {
            "category": category,
            "name": name,
            # FDC's official description often omits the everyday name
            # (e.g. "Cabbage, chinese (pak-choi), raw" for bok choy) --
            # commonNames is only present on /foods/search hits, so capture
            # it here for search/autofill to match against.
            "common_names": match.get("commonNames") or MANUAL_ALIASES.get(fdc_id, ""),
            "fdc_id": fdc_id,
            "source_name": "USDA FoodData Central, SR Legacy",
            "source_url": f"https://api.nal.usda.gov/fdc/v1/food/{fdc_id}",
            "published_date": match.get("publishedDate"),
            **nutrients,
        }
        catalogue.append(entry)
        print(f"  -> {name} (fdcId {fdc_id})")

    # app/data is the single source of truth the web app fetches from at
    # runtime -- writing here directly avoids a second copy that can drift.
    out_dir = os.path.join(os.path.dirname(__file__), "..", "app", "data")
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "food_catalogue.json"), "w", encoding="utf-8") as f:
        json.dump(catalogue, f, indent=2)

    # CSV export
    import csv
    csv_fields = ["category", "name", "common_names", "fdc_id", "source_name", "source_url", "published_date"] + ALL_FIELD_KEYS
    with open(os.path.join(out_dir, "food_catalogue.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=csv_fields)
        w.writeheader()
        for row in catalogue:
            w.writerow(row)

    print(f"\nTOTAL fetched: {len(catalogue)} / {len(FOOD_QUERIES)}")
    if missing:
        print("MISSING:")
        for cat, q in missing:
            print(f"  [{cat}] {q}")

    # sanity checks required by plan
    names_lower = [c["name"].lower() for c in catalogue]
    has_bokchoy = any("pak-choi" in n or "bok choy" in n or "pak choi" in n for n in names_lower)
    has_napa = any("pe-tsai" in n or "napa" in n for n in names_lower)
    print(f"bok choy present: {has_bokchoy}")
    print(f"napa cabbage present: {has_napa}")

    cats = {}
    for c in catalogue:
        cats[c["category"]] = cats.get(c["category"], 0) + 1
    print("by category:", cats)

    no_source = [c["name"] for c in catalogue if not c.get("source_url")]
    if no_source:
        print("ROWS MISSING SOURCE URL:", no_source)

    if missing or not has_bokchoy or not has_napa:
        sys.exit(1)


if __name__ == "__main__":
    main()
