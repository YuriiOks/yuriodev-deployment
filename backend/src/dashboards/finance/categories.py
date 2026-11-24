"""One small set of spending categories for every provider.

Every transaction gets one of `CATEGORIES`, worked out from what the provider says (Monzo's own
category, or the ISO 18245 merchant category code of a card payment for Monobank) and kept next to
the raw code (`category_code`), which is never thrown away. The rules, in order:

1. a transfer between the owner's own accounts and pots is `transfers`, whatever the provider says
   (and the reports leave internal transfers out of spending altogether);
2. the provider's own label or code decides, through the tables below;
3. money in (a positive amount) that nothing else explains is `income`; anything unknown is
   `other`.

An owner override is a second column (`category_override`), never written by a collector, so a
re-import keeps it; the category a page shows is the override when there is one. A rule per
counterparty can later fill the same column.
"""

from typing import Literal, get_args

Category = Literal[
    "housing_utilities",
    "groceries",
    "eating_out",
    "transport",
    "subscriptions",
    "health",
    "shopping",
    "entertainment",
    "debt",
    "income",
    "transfers",
    "cash",
    "other",
]
CATEGORIES: tuple[str, ...] = get_args(Category)

# Monzo's categories (https://docs.monzo.com/, transactions) and the newer ones seen in use.
MONZO_CATEGORIES = {
    "general": "other",
    "eating_out": "eating_out",
    "expenses": "other",
    "transport": "transport",
    "cash": "cash",
    "bills": "housing_utilities",
    "entertainment": "entertainment",
    "shopping": "shopping",
    "holidays": "entertainment",
    "groceries": "groceries",
    "mondo": "transfers",  # a top-up
    "personal_care": "health",
    "gifts": "shopping",
    "charity": "other",
    "family": "other",
    "finances": "debt",
    "savings": "transfers",
    "income": "income",
}

# ISO 18245 merchant category codes: (first, last, category), the first range that matches wins.
MCC_RANGES: tuple[tuple[int, int, str], ...] = (
    (4814, 4814, "housing_utilities"),  # telecommunication services
    (4899, 4899, "subscriptions"),  # cable, satellite and other pay TV and radio
    (4900, 4900, "housing_utilities"),  # utilities
    (4829, 4829, "transfers"),  # money transfer
    (6538, 6540, "transfers"),  # money send, stored value load
    (6010, 6011, "cash"),  # financial institutions: manual cash, ATM
    (6012, 6012, "debt"),  # financial institutions: merchandise and services (loan payments)
    (6050, 6051, "cash"),  # quasi cash
    (6513, 6513, "housing_utilities"),  # real estate agents and managers: rent
    (4011, 4131, "transport"),  # railways, taxis, local transport, buses
    (4784, 4784, "transport"),  # tolls and bridge fees
    (5541, 5542, "transport"),  # service stations, fuel
    (7511, 7523, "transport"),  # truck stops, car rental, parking
    (3000, 3299, "transport"),  # airlines
    (4511, 4511, "transport"),  # airlines and air carriers
    (5411, 5411, "groceries"),  # grocery stores and supermarkets
    (5422, 5499, "groceries"),  # meat, dairy, bakeries, miscellaneous food stores
    (5300, 5300, "groceries"),  # wholesale clubs
    (5811, 5814, "eating_out"),  # caterers, restaurants, bars, fast food
    (5912, 5912, "health"),  # drug stores and pharmacies
    (8011, 8099, "health"),  # doctors, dentists, hospitals, medical services
    (7230, 7299, "health"),  # beauty and barber shops, spas
    (7832, 7841, "entertainment"),  # cinemas, video rental
    (7911, 7999, "entertainment"),  # amusement, recreation, sports
    (5815, 5815, "subscriptions"),  # digital media: books, movies, music
    (5816, 5816, "entertainment"),  # digital games
    (5817, 5818, "subscriptions"),  # digital applications and large digital goods
    (7399, 7399, "subscriptions"),  # business services (many online subscriptions)
    (5310, 5399, "shopping"),  # discount and department stores, general merchandise
    (5611, 5699, "shopping"),  # clothing
    (5712, 5735, "shopping"),  # furniture, appliances, electronics, music stores
    (5942, 5949, "shopping"),  # books, jewellery, toys, gifts
    (5200, 5261, "shopping"),  # home supply and garden
    (5732, 5734, "shopping"),  # electronics, computer software
    (4722, 4722, "entertainment"),  # travel agencies
    (7011, 7011, "entertainment"),  # lodging: hotels
)

def category_from_monzo(code: str | None) -> str | None:
    return MONZO_CATEGORIES.get(code) if code else None


def category_from_mcc(code: str | None) -> str | None:
    if not code or not code.isdigit():
        return None
    mcc = int(code)
    for first, last, category in MCC_RANGES:
        if first <= mcc <= last:
            return category
    return None


def categorize(provider: str, code: str | None, amount: int, internal: bool) -> str:
    """The category of a transaction (see the module's rules). `code` is the provider's raw one:
    Monzo's category name, or a card payment's merchant category code."""
    if internal:
        return "transfers"
    found = category_from_monzo(code) if provider == "monzo" else category_from_mcc(code)
    if found is None or found == "other":
        return "income" if amount > 0 else "other"
    return found
