from __future__ import annotations

import http.client
import json
import re
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

BASE_URL = "http://127.0.0.1:8080"
PRIVATE_SENTINEL = "PRIVATE_SERVICE_SENTINEL_7843"


def assemble_pdf(objects: list[bytes]) -> bytes:
    result = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
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


def native_pdf(text: str, font_size: int = 18) -> bytes:
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream = f"BT /F1 {font_size} Tf 72 650 Td ({escaped}) Tj ET".encode("ascii")
    return assemble_pdf(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
            b"<< /Length "
            + str(len(stream)).encode("ascii")
            + b" >>\nstream\n"
            + stream
            + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        ]
    )


def blank_pdf(page_count: int, width: int = 612, height: int = 792) -> bytes:
    first_page = 3
    content_object = first_page + page_count
    kids = " ".join(f"{number} 0 R" for number in range(first_page, content_object))
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        f"<< /Type /Pages /Kids [{kids}] /Count {page_count} >>".encode("ascii"),
    ]
    objects.extend(
        (
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] "
            f"/Resources << >> /Contents {content_object} 0 R >>"
        ).encode("ascii")
        for _ in range(page_count)
    )
    objects.append(b"<< /Length 0 >>\nstream\n\nendstream")
    return assemble_pdf(objects)


def image_only_pdf(text: str) -> bytes:
    with tempfile.TemporaryDirectory(prefix="leadvirt-parser-runtime-") as directory:
        root = Path(directory)
        source = root / "source.pdf"
        source.write_bytes(native_pdf(text, font_size=42))
        prefix = root / "page"
        subprocess.run(
            [
                "pdftoppm",
                "-f",
                "1",
                "-l",
                "1",
                "-singlefile",
                "-r",
                "150",
                str(source),
                str(prefix),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            check=True,
            timeout=20,
        )
        ppm = prefix.with_suffix(".ppm").read_bytes()
    header = re.match(rb"P6\s+(\d+)\s+(\d+)\s+255\s", ppm)
    assert header is not None
    width = int(header.group(1))
    height = int(header.group(2))
    pixels = ppm[header.end() :]
    assert len(pixels) == width * height * 3
    compressed = zlib.compress(pixels, level=9)
    content = b"q 612 0 0 792 0 0 cm /Im0 Do Q"
    return assemble_pdf(
        [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>",
            b"<< /Length "
            + str(len(content)).encode("ascii")
            + b" >>\nstream\n"
            + content
            + b"\nendstream",
            (
                f"<< /Type /XObject /Subtype /Image /Width {width} /Height {height} "
                f"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode "
                f"/Length {len(compressed)} >>\nstream\n"
            ).encode("ascii")
            + compressed
            + b"\nendstream",
        ]
    )


def request_json(request: urllib.request.Request, timeout: float = 30) -> tuple[int, dict]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, json.load(error)


def post_pdf(
    source: bytes, allow_ocr: bool, budget_ms: int | None = None, timeout: float = 30
) -> tuple[int, dict]:
    headers = {
        "Content-Type": "application/pdf",
        "X-LeadVirt-OCR": "true" if allow_ocr else "false",
    }
    if budget_ms is not None:
        headers["X-LeadVirt-Parser-Budget-Ms"] = str(budget_ms)
    return request_json(
        urllib.request.Request(
            f"{BASE_URL}/v1/pdf/extract", data=source, headers=headers, method="POST"
        ),
        timeout,
    )


health_status, health = request_json(urllib.request.Request(f"{BASE_URL}/health"), 5)
assert health_status == 200
assert health == {
    "ready": True,
    "version": "poppler-tesseract-v1",
    "contractVersion": "leadvirt.pdf-extraction.v1",
    "ocrLanguageCount": 6,
}

native = native_pdf(f"{PRIVATE_SENTINEL} costs 25 EUR")
status, payload = post_pdf(native, allow_ocr=False)
assert status == 200, payload
assert payload["data"]["pages"][0]["source"] == "NATIVE"
assert PRIVATE_SENTINEL in " ".join(
    word["text"] for word in payload["data"]["pages"][0]["words"]
)

scanned = image_only_pdf("SERVICE PRICE 25 EUR")
status, payload = post_pdf(scanned, allow_ocr=True)
assert status == 200, payload
assert payload["data"]["counts"]["ocrPages"] == 1
assert payload["data"]["pages"][0]["source"] == "OCR"
ocr_text = " ".join(word["text"] for word in payload["data"]["pages"][0]["words"])
assert "SERVICE" in ocr_text.upper(), ocr_text

status, payload = post_pdf(blank_pdf(21), allow_ocr=True)
assert (status, payload["error"]["code"]) == (422, "PDF_PARSER_OCR_PAGE_LIMIT")

status, payload = post_pdf(blank_pdf(1, width=5_000, height=5_000), allow_ocr=True)
assert (status, payload["error"]["code"]) == (
    422,
    "PDF_PARSER_OCR_PAGE_PIXEL_LIMIT",
)

status, payload = post_pdf(native, allow_ocr=False, budget_ms=1)
assert (status, payload["error"]["code"]) == (408, "PDF_PARSER_TIMEOUT")

connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=5)
connection.putrequest("POST", "/v1/pdf/extract")
connection.putheader("Content-Type", "application/pdf")
connection.putheader("Content-Length", str(10 * 1024 * 1024 + 1))
connection.putheader("Connection", "close")
connection.endheaders()
response = connection.getresponse()
limit_payload = json.load(response)
assert (response.status, limit_payload["error"]["code"]) == (
    413,
    "PDF_PARSER_INPUT_LIMIT",
)
connection.close()

blocker = socket.create_connection(("127.0.0.1", 8080), timeout=5)
blocker.sendall(
    (
        "POST /v1/pdf/extract HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Content-Type: application/pdf\r\n"
        f"Content-Length: {len(native)}\r\n"
        "X-LeadVirt-OCR: false\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii")
    + native[:8]
)
time.sleep(0.2)
status, payload = post_pdf(native, allow_ocr=False)
assert (status, payload["error"]["code"]) == (429, "PDF_PARSER_BUSY")
blocker.close()

deadline = time.monotonic() + 5
while True:
    status, payload = post_pdf(native, allow_ocr=False)
    if status == 200:
        break
    assert status == 429, payload
    assert time.monotonic() < deadline
    time.sleep(0.05)

disconnect = socket.create_connection(("127.0.0.1", 8080), timeout=5)
disconnect.sendall(
    (
        "POST /v1/pdf/extract HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Content-Type: application/pdf\r\n"
        f"Content-Length: {len(scanned)}\r\n"
        "X-LeadVirt-OCR: true\r\n"
        "Connection: close\r\n\r\n"
    ).encode("ascii")
    + scanned
)
disconnect.close()

deadline = time.monotonic() + 5
while True:
    status, payload = post_pdf(native, allow_ocr=False)
    if status == 200:
        break
    assert status == 429, payload
    assert time.monotonic() < deadline
    time.sleep(0.05)

print("business import parser hardened HTTP runtime smoke passed")
