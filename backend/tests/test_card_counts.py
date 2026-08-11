from app.card_counts import (
    estimate_card_count,
    estimate_pdf_pages,
    is_situational_material,
)


def _pdf_with_pages(n: int) -> bytes:
    page_objs = b"".join(b"1 0 obj\n<< /Type /Page >>\nendobj\n" for _ in range(n))
    catalog = f"2 0 obj\n<< /Type /Pages /Kids [] /Count {n} >>\nendobj\n".encode()
    return b"%PDF-1.4\n" + page_objs + catalog + b"%%EOF\n"


def test_estimate_pdf_pages_counts_page_objects():
    assert estimate_pdf_pages(_pdf_with_pages(60)) == 60
    assert estimate_pdf_pages(_pdf_with_pages(3)) == 3


def test_estimate_card_count_scales_with_pages():
    small = estimate_card_count("pdf", _pdf_with_pages(2), filename="short.pdf")
    large = estimate_card_count("pdf", _pdf_with_pages(60), filename="long.pdf")
    assert 4 <= small <= 20
    assert large >= 40
    assert large <= 60


def test_estimate_card_count_photo_stays_small():
    count = estimate_card_count("photo", b"x" * 500_000, filename="notes.jpg")
    assert 5 <= count <= 14


def test_is_situational_material_detects_law():
    assert is_situational_material("Contracts Law Midterm.pdf")
    assert is_situational_material("criminal procedure notes")
    assert not is_situational_material("Biology photosynthesis chapter")
