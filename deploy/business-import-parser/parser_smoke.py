from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


spec = importlib.util.spec_from_file_location("leadvirt_parser", Path("/app/parser.py"))
assert spec and spec.loader
parser = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = parser
spec.loader.exec_module(parser)


def expect_error(code: str, action) -> None:
    try:
        action()
    except parser.ParserError as error:
        assert error.code == code, (error.code, code)
    else:
        raise AssertionError(f"expected {code}")


def pdf(text: str) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 18 Tf 72 720 Td ({escaped}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    result = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, value in enumerate(objects, start=1):
        offsets.append(len(result))
        result.extend(f"{number} 0 obj\n".encode("ascii"))
        result.extend(value)
        result.extend(b"\nendobj\n")
    xref = len(result)
    result.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    result.extend(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        result.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    result.extend(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF\n"
        ).encode("ascii")
    )
    return bytes(result)


result = parser.extract_pdf(pdf("Haircut service costs 25 EUR today"), allow_ocr=False)
assert result["document"]["pageCount"] == 1
assert result["counts"]["ocrPages"] == 0
assert "Haircut" in " ".join(word["text"] for word in result["pages"][0]["words"])
assert all(len(word["box"]) == 4 for word in result["pages"][0]["words"])

readiness = parser.verify_dependencies()
assert readiness == {"commandCount": 4, "ocrLanguageCount": 6}


def missing_language_readiness() -> None:
    original = parser.OCR_LANGUAGES
    parser.OCR_LANGUAGES = "zzz"
    try:
        parser.verify_dependencies()
    finally:
        parser.OCR_LANGUAGES = original


expect_error("PDF_PARSER_OCR_LANGUAGE_UNAVAILABLE", missing_language_readiness)


def native_xml(width: str, box: tuple[str, str, str, str]) -> bytes:
    x_min, y_min, x_max, y_max = box
    return (
        f'<doc><page width="{width}" height="100">'
        f'<word xMin="{x_min}" yMin="{y_min}" xMax="{x_max}" yMax="{y_max}">x</word>'
        "</page></doc>"
    ).encode("ascii")


expect_error(
    "PDF_PARSER_NATIVE_OUTPUT_INVALID",
    lambda: parser.parse_native_words(native_xml("nan", ("0", "0", "1", "1"))),
)
expect_error(
    "PDF_PARSER_NATIVE_OUTPUT_INVALID",
    lambda: parser.parse_native_words(native_xml("100", ("-1", "0", "1", "1"))),
)
expect_error(
    "PDF_PARSER_NATIVE_OUTPUT_INVALID",
    lambda: parser.parse_native_words(native_xml("100", ("0", "0", "101", "1"))),
)
expect_error(
    "PDF_PARSER_OCR_PAGE_PIXEL_LIMIT",
    lambda: parser.planned_raster_dimensions({"width": 10_000, "height": 10_000}),
)
expect_error(
    "PDF_PARSER_OCR_PIXEL_LIMIT",
    lambda: parser.validate_ocr_pixel_budget(
        parser.MAX_OCR_PAGE_PIXELS,
        parser.MAX_OCR_PIXELS - parser.MAX_OCR_PAGE_PIXELS + 1,
    ),
)
expect_error(
    "PDF_PARSER_TIMEOUT",
    lambda: parser.RequestBudget(parser.time.monotonic() - 1).check(),
)

png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8 + (100).to_bytes(4, "big") + (200).to_bytes(4, "big")
assert parser.png_dimensions(png) == (100, 200)

tsv = (
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n"
    "5\t1\t1\t1\t1\t1\t10\t20\t30\t40\t90\tService\n"
    "5\t1\t1\t1\t1\t2\t-1\t20\t30\t40\t90\tNegative\n"
    "5\t1\t1\t1\t1\t3\t90\t20\t30\t40\t90\tOverflow\n"
    "5\t1\t1\t1\t1\t4\t10\t20\t30\t40\tnan\tNonfinite\n"
).encode("utf-8")
words = parser.parse_tesseract_tsv(tsv, 100, 200, 612.0, 792.0)
assert words == [{"text": "Service", "box": [61.2, 79.2, 244.8, 237.6], "confidence": 0.9}]
expect_error(
    "PDF_PARSER_OUTPUT_LIMIT",
    lambda: parser.parse_tesseract_tsv(
        tsv, 100, 200, 612.0, 792.0, max_characters=6
    ),
)
expect_error(
    "PDF_PARSER_OUTPUT_LIMIT",
    lambda: parser.parse_tesseract_tsv(tsv, 100, 200, 612.0, 792.0, max_words=0),
)

print("business import PDF parser smoke passed")
