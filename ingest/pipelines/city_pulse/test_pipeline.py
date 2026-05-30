from ingest.pipelines.city_pulse.pipeline import CITIES, slug


def test_seven_cities_including_lehigh():
    assert CITIES == [
        "Lehigh Acres", "Cape Coral", "Fort Myers", "Naples",
        "Estero", "Bonita Springs", "Fort Myers Beach",
    ]


def test_slug_is_filesystem_safe():
    assert slug("Fort Myers Beach") == "fort-myers-beach"
    assert slug("Lehigh Acres") == "lehigh-acres"
