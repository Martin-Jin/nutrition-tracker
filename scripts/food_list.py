"""
Curated list of common foods to fetch from USDA FoodData Central (SR Legacy).
Each entry: (category, search_query, preferred_description_substring or None).

Search queries are run against the FDC search API; preferred_match narrows
multiple hits to the plain/raw form we want (avoids canned/frozen/juice
variants per the "common foods only" decision). Categories match the
required set: Meats, Vegetables, Fruits, Nuts.
"""

FOOD_QUERIES = [
    # ---- Meats ---- (cooked forms: meat is not commonly eaten raw)
    ("Meats", "chicken breast cooked roasted", "Chicken, broilers or fryers, breast, meat only, cooked, roasted"),
    ("Meats", "chicken thigh cooked roasted", "Chicken, broilers or fryers, thigh, meat only, cooked, roasted"),
    ("Meats", "ground beef 85% cooked broiled", "Beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled"),
    ("Meats", "ground beef 93% cooked broiled", "Beef, ground, 93% lean meat / 7% fat, patty, cooked, broiled"),
    ("Meats", "pork chop cooked broiled", "Pork, fresh, loin, center loin (chops), bone-in, separable lean only, cooked, broiled"),
    ("Meats", "bacon cooked pan-fried", "Pork, cured, bacon, pre-sliced, cooked, pan-fried"),
    ("Meats", "turkey breast cooked roasted", "Turkey, whole, breast, meat only, cooked, roasted"),
    ("Meats", "turkey ground cooked", "Turkey, Ground, cooked"),
    ("Meats", "lamb loin cooked broiled", "Lamb, loin, separable lean only, trimmed to 1/4\" fat, choice, cooked, broiled"),
    ("Meats", "salmon atlantic cooked", "Fish, salmon, atlantic, wild, cooked, dry heat"),
    ("Meats", "tuna yellowfin cooked", "Fish, tuna, yellowfin, fresh, cooked, dry heat"),
    ("Meats", "shrimp cooked", "Crustaceans, shrimp, mixed species, cooked, moist heat"),
    ("Meats", "cod cooked", "Fish, cod, atlantic, cooked, dry heat"),
    ("Meats", "egg whole cooked hard boiled", "Egg, whole, cooked, hard-boiled"),
    ("Meats", "liver beef cooked", "Beef, variety meats and by-products, liver, cooked, pan-fried"),

    # ---- Vegetables ----
    ("Vegetables", "bok choy raw", "Cabbage, chinese (pak-choi), raw"),
    ("Vegetables", "napa cabbage raw", "Cabbage, chinese (pe-tsai), raw"),
    ("Vegetables", "cabbage raw", "Cabbage, raw"),
    ("Vegetables", "broccoli raw", "Broccoli, raw"),
    ("Vegetables", "spinach raw", "Spinach, raw"),
    ("Vegetables", "kale raw", "Kale, raw"),
    ("Vegetables", "carrot raw", "Carrots, raw"),
    ("Vegetables", "sweet potato cooked baked", "Sweet potato, cooked, baked in skin, flesh, without salt"),
    ("Vegetables", "potatoes baked flesh skin", "Potatoes, baked, flesh and skin, without salt"),
    ("Vegetables", "tomato raw", "Tomatoes, red, ripe, raw, year round average"),
    ("Vegetables", "cucumber raw", "Cucumber, with peel, raw"),
    ("Vegetables", "bell pepper red raw", "Peppers, sweet, red, raw"),
    ("Vegetables", "onion raw", "Onions, raw"),
    ("Vegetables", "garlic raw", "Garlic, raw"),
    ("Vegetables", "green beans cooked boiled", "Beans, snap, green, cooked, boiled, drained, without salt"),
    ("Vegetables", "zucchini raw", "Squash, summer, zucchini, includes skin, raw"),
    ("Vegetables", "cauliflower raw", "Cauliflower, raw"),
    ("Vegetables", "brussels sprouts cooked boiled", "Brussels sprouts, cooked, boiled, drained, without salt"),
    ("Vegetables", "asparagus cooked boiled", "Asparagus, cooked, boiled, drained"),
    ("Vegetables", "mushroom white raw", "Mushrooms, white, raw"),
    ("Vegetables", "celery raw", "Celery, raw"),
    ("Vegetables", "lettuce romaine raw", "Lettuce, cos or romaine, raw"),
    ("Vegetables", "corn sweet cooked boiled", "Corn, sweet, yellow, cooked, boiled, drained, without salt"),
    ("Vegetables", "peas green cooked boiled", "Peas, green, cooked, boiled, drained, without salt"),
    ("Vegetables", "beet cooked boiled", "Beets, cooked, boiled, drained"),
    ("Vegetables", "eggplant cooked boiled", "Eggplant, cooked, boiled, drained, without salt"),

    # ---- Fruits ----
    ("Fruits", "apple raw with skin", "Apples, raw, with skin"),
    ("Fruits", "banana raw", "Bananas, raw"),
    ("Fruits", "orange raw", "Oranges, raw, all commercial varieties"),
    ("Fruits", "strawberries raw", "Strawberries, raw"),
    ("Fruits", "blueberries raw", "Blueberries, raw"),
    ("Fruits", "grapes raw", "Grapes, red or green (European type, such as thompson seedless), raw"),
    ("Fruits", "watermelon raw", "Watermelon, raw"),
    ("Fruits", "pineapple raw", "Pineapple, raw, all varieties"),
    ("Fruits", "mango raw", "Mangos, raw"),
    ("Fruits", "peach raw", "Peaches, yellow, raw"),
    ("Fruits", "pear raw", "Pears, raw"),
    ("Fruits", "kiwifruit raw", "Kiwifruit, green, raw"),
    ("Fruits", "avocado raw", "Avocados, raw, all commercial varieties"),
    ("Fruits", "lemon raw", "Lemons, raw, without peel"),
    ("Fruits", "cherries raw", "Cherries, sweet, raw"),
    ("Fruits", "raspberries raw", "Raspberries, raw"),
    ("Fruits", "cantaloupe raw", "Melons, cantaloupe, raw"),
    ("Fruits", "grapefruit raw", "Grapefruit, raw, pink and red, all areas"),
    ("Fruits", "plum raw", "Plums, raw"),
    ("Fruits", "papaya raw", "Papayas, raw"),

    # ---- Nuts ----
    ("Nuts", "almonds", "Nuts, almonds"),
    ("Nuts", "walnuts raw", "Nuts, walnuts, english"),
    ("Nuts", "cashews raw", "Nuts, cashew nuts, raw"),
    ("Nuts", "pistachios raw", "Nuts, pistachio nuts, raw"),
    ("Nuts", "pecans raw", "Nuts, pecans"),
    ("Nuts", "peanuts raw", "Peanuts, all types, raw"),
    ("Nuts", "hazelnuts raw", "Nuts, hazelnuts or filberts"),
    ("Nuts", "macadamia raw", "Nuts, macadamia nuts, raw"),
    ("Nuts", "brazilnuts", "Nuts, brazilnuts, dried, unblanched"),
    ("Nuts", "pine nuts raw", "Nuts, pine nuts, dried"),
    ("Nuts", "sunflower seeds raw", "Seeds, sunflower seed kernels, dried"),
    ("Nuts", "pumpkin seeds raw", "Seeds, pumpkin and squash seed kernels, dried"),
    ("Nuts", "chia seeds raw", "Seeds, chia seeds, dried"),
    ("Nuts", "flaxseed raw", "Seeds, flaxseed"),
]
