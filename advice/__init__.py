"""Эрсдэлийн хүчин зүйлсээс шалтгаалан олон хувилбарын зөвлөмж сонгодог сан.

Хүчин зүйл тус бүрт 20, хослол бүрт 20, гурвалсан бүрт 20 арга хэмжээ бичиж,
оролсон муу үзүүлэлтүүдэд тохирох бүлгүүдийг нь эргүүлэн буцаана.
"""

from itertools import combinations

from advice.pairs import PAIRS
from advice.singles import SINGLES
from advice.triples import TRIPLES

ORDER = ["stocking", "livestock", "ndvi", "precipitation", "temperature"]

LABELS = {
    "mn": {
        "stocking": "Малын ачаалал",
        "livestock": "Малын тоо",
        "ndvi": "Ургамлын бүрхэвч",
        "precipitation": "Хур тунадас",
        "temperature": "Температур",
        "single": "Үзүүлэлт бүрд",
        "pair": "Хоёр үзүүлэлт давхцахад",
        "triple": "Гурван үзүүлэлт давхцахад",
    },
    "en": {
        "stocking": "Grazing pressure",
        "livestock": "Herd size",
        "ndvi": "Vegetation cover",
        "precipitation": "Rainfall",
        "temperature": "Temperature",
        "single": "Per indicator",
        "pair": "When two indicators combine",
        "triple": "When three indicators combine",
    },
}

def key_of(keys):
    """Дарааллаас үл хамаарах түлхүүр: 'stocking+ndvi' гэх мэт."""
    return "+".join(sorted(keys))


def _table(kind):
    if kind == "single":
        return SINGLES
    if kind == "pair":
        return PAIRS
    return TRIPLES


def _rotate(items, seed):
    """Ижил оролт дахин давхтад өөр дарааллаар гаргахын тулд эргүүлнэ."""
    if not items:
        return []
    offset = seed % len(items)
    return items[offset:] + items[:offset]


def build_advice(keys, lang="mn", seed=0):
    """Муу үзүүлэлтүүдийн жагсаалтаас зөвлөмжийн бүлгүүдийг буцаана."""
    labels = LABELS["mn" if lang != "en" else "en"]
    present = list(dict.fromkeys(k for k in keys if k in ORDER))
    wanted = [(list(ks), kind) for kind, size in (("single", 1), ("pair", 2), ("triple", 3))
              for ks in combinations(present, size)]

    groups = []
    for i, (ks, kind) in enumerate(wanted):
        table = _table(kind)
        lookup = ks[0] if kind == "single" else key_of(ks)
        items = table.get(lookup, [])
        if not items:
            continue
        picked = _rotate(items, seed + 11 * i)
        groups.append({
            "kind": kind,
            "keys": ks,
            "label": " + ".join(labels[k] for k in ks),
            "kind_label": labels[kind],
            "count": len(picked),
            "items": [{"tag": (t[1] if lang == "en" else t[0]),
                       "text": (t[3] if lang == "en" else t[2])} for t in picked],
        })
    return groups


def advice_total(groups):
    return sum(g["count"] for g in groups)
