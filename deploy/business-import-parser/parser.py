from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import os
import re
import select
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

MAX_INPUT_BYTES = 10 * 1024 * 1024
MAX_PAGES = 100
MAX_CHARACTERS = 1_000_000
MAX_WORDS = 250_000
MAX_OUTPUT_BYTES = 8 * 1024 * 1024
MAX_METADATA_BYTES = 64 * 1024
MAX_RASTER_BYTES = 64 * 1024 * 1024
MAX_OCR_PAGES = 20
MAX_OCR_PAGE_PIXELS = 15_000_000
MAX_OCR_PIXELS = 50_000_000
REQUEST_TIMEOUT_MS = 240_000
SUBPROCESS_POLL_SECONDS = 0.1
NATIVE_CHARACTER_THRESHOLD = 24
DEFAULT_OCR_LANGUAGES = "eng+rus+deu+spa+fra+por"
PARSER_VERSION = "poppler-tesseract-v1"
CONTRACT_VERSION = "leadvirt.pdf-extraction.v1"
PROCESSING = threading.BoundedSemaphore(1)
DEPENDENCIES_READY = False
SAFE_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "HOME": "/nonexistent",
    "TMPDIR": "/tmp",
}
REQUIRED_COMMANDS = ("pdfinfo", "pdftotext", "pdftoppm", "tesseract")


class ParserError(Exception):
    def __init__(self, code: str, status: int = HTTPStatus.UNPROCESSABLE_ENTITY):
        super().__init__(code)
        self.code = code
        self.status = status


def configured_ocr_languages() -> str:
    value = os.environ.get(
        "BUSINESS_IMPORT_PARSER_OCR_LANGUAGES", DEFAULT_OCR_LANGUAGES
    ).strip()
    if not re.fullmatch(r"[a-z]{3}(?:\+[a-z]{3}){0,15}", value):
        raise SystemExit("invalid OCR language configuration")
    languages = value.split("+")
    if len(languages) != len(set(languages)):
        raise SystemExit("duplicate OCR language configuration")
    return value


OCR_LANGUAGES = configured_ocr_languages()


@dataclass
class RequestBudget:
    deadline: float
    disconnected: Callable[[], bool] | None = None

    @classmethod
    def for_timeout_ms(
        cls,
        timeout_ms: int = REQUEST_TIMEOUT_MS,
        disconnected: Callable[[], bool] | None = None,
        started: float | None = None,
    ) -> "RequestBudget":
        return cls((started if started is not None else time.monotonic()) + timeout_ms / 1000, disconnected)

    def check(self) -> None:
        if self.disconnected is not None and self.disconnected():
            raise ParserError("PDF_PARSER_CLIENT_DISCONNECTED", 499)
        if time.monotonic() >= self.deadline:
            raise ParserError("PDF_PARSER_TIMEOUT", HTTPStatus.REQUEST_TIMEOUT)

    def remaining_seconds(self) -> float:
        self.check()
        return max(0.001, self.deadline - time.monotonic())


def terminate_process(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except OSError:
        process.terminate()
    try:
        process.wait(timeout=0.25)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            process.kill()
        process.wait(timeout=1)


def run_command(
    arguments: list[str],
    budget: RequestBudget,
    timeout_seconds: float,
    output_limit: int = MAX_OUTPUT_BYTES,
) -> bytes:
    budget.check()
    command_deadline = min(budget.deadline, time.monotonic() + timeout_seconds)
    with tempfile.TemporaryFile() as stdout_file:
        try:
            process = subprocess.Popen(
                arguments,
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=subprocess.DEVNULL,
                env=SAFE_ENV,
                cwd="/tmp",
                start_new_session=True,
            )
        except OSError as error:
            raise ParserError(
                "PDF_PARSER_DEPENDENCY_UNAVAILABLE", HTTPStatus.SERVICE_UNAVAILABLE
            ) from error
        try:
            while process.poll() is None:
                budget.check()
                remaining = command_deadline - time.monotonic()
                if remaining <= 0:
                    raise ParserError("PDF_PARSER_TIMEOUT", HTTPStatus.REQUEST_TIMEOUT)
                try:
                    process.wait(timeout=min(SUBPROCESS_POLL_SECONDS, remaining))
                except subprocess.TimeoutExpired:
                    if stdout_file.tell() > output_limit:
                        raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
            budget.check()
            if process.returncode != 0:
                raise ParserError("PDF_PARSER_COMMAND_FAILED")
            size = stdout_file.tell()
            if size > output_limit:
                raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
            stdout_file.seek(0)
            return stdout_file.read(size)
        except BaseException:
            terminate_process(process)
            raise


def pdf_metadata(path: Path, budget: RequestBudget) -> dict[str, Any]:
    output = run_command(
        ["pdfinfo", str(path)],
        budget,
        timeout_seconds=30,
        output_limit=MAX_METADATA_BYTES,
    ).decode("utf-8", "replace")
    metadata: dict[str, str] = {}
    for line in output.splitlines():
        key, separator, value = line.partition(":")
        if separator:
            metadata[key.strip()] = value.strip()
    try:
        pages = int(metadata.get("Pages", "0"))
    except ValueError as error:
        raise ParserError("PDF_PARSER_METADATA_INVALID") from error
    if pages < 1 or pages > MAX_PAGES:
        raise ParserError("PDF_PARSER_PAGE_LIMIT")
    if metadata.get("Encrypted", "no").lower().startswith("yes"):
        raise ParserError("PDF_PARSER_ENCRYPTED")
    return {
        "pageCount": pages,
        "pdfVersion": metadata.get("PDF version", "unknown")[:32],
    }


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def finite_number(value: str) -> float:
    number = float(value)
    if not math.isfinite(number):
        raise ValueError("non-finite number")
    return number


def parse_native_words(
    source: bytes, budget: RequestBudget | None = None
) -> list[dict[str, Any]]:
    active_budget = budget or RequestBudget.for_timeout_ms()
    active_budget.check()
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID") from error
    active_budget.check()
    pages: list[dict[str, Any]] = []
    word_count = 0
    character_count = 0
    for page_number, page in enumerate(
        (node for node in root.iter() if local_name(node.tag) == "page"),
        start=1,
    ):
        active_budget.check()
        if page_number > MAX_PAGES:
            raise ParserError("PDF_PARSER_PAGE_LIMIT")
        try:
            width = finite_number(page.attrib["width"])
            height = finite_number(page.attrib["height"])
        except (KeyError, ValueError) as error:
            raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID") from error
        if width <= 0 or height <= 0:
            raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID")
        words: list[dict[str, Any]] = []
        for node_number, node in enumerate(page.iter(), start=1):
            if node_number % 256 == 0:
                active_budget.check()
            if local_name(node.tag) != "word":
                continue
            text = "".join(node.itertext()).strip()
            if not text:
                continue
            try:
                x_min = finite_number(node.attrib["xMin"])
                y_min = finite_number(node.attrib["yMin"])
                x_max = finite_number(node.attrib["xMax"])
                y_max = finite_number(node.attrib["yMax"])
            except (KeyError, ValueError) as error:
                raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID") from error
            if not (
                0 <= x_min <= x_max <= width and 0 <= y_min <= y_max <= height
            ):
                raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID")
            character_count += len(text)
            word_count += 1
            if character_count > MAX_CHARACTERS or word_count > MAX_WORDS:
                raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
            words.append(
                {
                    "text": text,
                    "box": [
                        round(x_min, 3),
                        round(y_min, 3),
                        round(x_max, 3),
                        round(y_max, 3),
                    ],
                    "confidence": 1.0,
                }
            )
        pages.append(
            {
                "pageNumber": page_number,
                "width": round(width, 3),
                "height": round(height, 3),
                "source": "NATIVE",
                "words": words,
                "characterCount": sum(len(word["text"]) for word in words),
            }
        )
    active_budget.check()
    return pages


def png_dimensions(source: bytes) -> tuple[int, int]:
    if len(source) < 24 or source[:8] != b"\x89PNG\r\n\x1a\n":
        raise ParserError("PDF_PARSER_RASTER_INVALID")
    width, height = struct.unpack(">II", source[16:24])
    if width < 1 or height < 1:
        raise ParserError("PDF_PARSER_RASTER_INVALID")
    return width, height


def planned_raster_dimensions(page: dict[str, Any]) -> tuple[int, int, int]:
    width = float(page["width"])
    height = float(page["height"])
    if (
        not math.isfinite(width)
        or not math.isfinite(height)
        or width <= 0
        or height <= 0
    ):
        raise ParserError("PDF_PARSER_NATIVE_OUTPUT_INVALID")
    max_dimension_points = MAX_OCR_PAGE_PIXELS * 72 / 200
    if width > max_dimension_points or height > max_dimension_points:
        raise ParserError("PDF_PARSER_OCR_PAGE_PIXEL_LIMIT")
    raster_width = math.ceil(width * 200 / 72)
    raster_height = math.ceil(height * 200 / 72)
    pixels = raster_width * raster_height
    validate_ocr_pixel_budget(pixels, 0)
    return raster_width, raster_height, pixels


def validate_ocr_pixel_budget(pixels: int, cumulative_pixels: int) -> None:
    if pixels < 1:
        raise ParserError("PDF_PARSER_RASTER_INVALID")
    if pixels > MAX_OCR_PAGE_PIXELS:
        raise ParserError("PDF_PARSER_OCR_PAGE_PIXEL_LIMIT")
    if cumulative_pixels + pixels > MAX_OCR_PIXELS:
        raise ParserError("PDF_PARSER_OCR_PIXEL_LIMIT")


def parse_tesseract_tsv(
    source: bytes,
    image_width: int,
    image_height: int,
    page_width: float,
    page_height: float,
    budget: RequestBudget | None = None,
    max_characters: int = MAX_CHARACTERS,
    max_words: int = MAX_WORDS,
) -> list[dict[str, Any]]:
    active_budget = budget or RequestBudget.for_timeout_ms()
    words: list[dict[str, Any]] = []
    character_count = 0
    reader = csv.DictReader(
        io.StringIO(source.decode("utf-8", "replace")), delimiter="\t"
    )
    for row_number, row in enumerate(reader, start=1):
        if row_number % 256 == 0:
            active_budget.check()
        text = (row.get("text") or "").strip()
        if not text:
            continue
        try:
            left = int(row.get("left") or "0")
            top = int(row.get("top") or "0")
            width = int(row.get("width") or "0")
            height = int(row.get("height") or "0")
            confidence_raw = float(row.get("conf") or "-1")
        except ValueError:
            continue
        if (
            left < 0
            or top < 0
            or width <= 0
            or height <= 0
            or left + width > image_width
            or top + height > image_height
            or not math.isfinite(confidence_raw)
            or confidence_raw < 0
            or confidence_raw > 100
        ):
            continue
        character_count += len(text)
        if character_count > max_characters or len(words) >= max_words:
            raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
        box = [
            round(left / image_width * page_width, 3),
            round(top / image_height * page_height, 3),
            round((left + width) / image_width * page_width, 3),
            round((top + height) / image_height * page_height, 3),
        ]
        words.append(
            {"text": text, "box": box, "confidence": round(confidence_raw / 100, 4)}
        )
    active_budget.check()
    return words


def ocr_page(
    path: Path,
    page: dict[str, Any],
    work: Path,
    cumulative_pixels: int,
    budget: RequestBudget,
    remaining_characters: int,
    remaining_words: int,
) -> tuple[list[dict[str, Any]], int]:
    page_number = int(page["pageNumber"])
    _, _, planned_pixels = planned_raster_dimensions(page)
    validate_ocr_pixel_budget(planned_pixels, cumulative_pixels)
    prefix = work / f"page-{page_number}"
    run_command(
        [
            "pdftoppm",
            "-f",
            str(page_number),
            "-l",
            str(page_number),
            "-singlefile",
            "-r",
            "200",
            "-png",
            str(path),
            str(prefix),
        ],
        budget,
        timeout_seconds=budget.remaining_seconds(),
        output_limit=MAX_METADATA_BYTES,
    )
    png_path = prefix.with_suffix(".png")
    try:
        try:
            raster_bytes = png_path.stat().st_size
            with png_path.open("rb") as image_file:
                header = image_file.read(24)
        except OSError as error:
            raise ParserError("PDF_PARSER_RASTER_INVALID") from error
        if raster_bytes < 24 or raster_bytes > MAX_RASTER_BYTES:
            raise ParserError("PDF_PARSER_RASTER_LIMIT")
        image_width, image_height = png_dimensions(header)
        pixels = image_width * image_height
        validate_ocr_pixel_budget(pixels, cumulative_pixels)
        tsv = run_command(
            [
                "tesseract",
                str(png_path),
                "stdout",
                "-l",
                OCR_LANGUAGES,
                "--psm",
                "6",
                "tsv",
            ],
            budget,
            timeout_seconds=budget.remaining_seconds(),
        )
        return (
            parse_tesseract_tsv(
                tsv,
                image_width,
                image_height,
                float(page["width"]),
                float(page["height"]),
                budget,
                remaining_characters,
                remaining_words,
            ),
            pixels,
        )
    finally:
        png_path.unlink(missing_ok=True)


def extract_pdf(
    source: bytes, allow_ocr: bool, budget: RequestBudget | None = None
) -> dict[str, Any]:
    active_budget = budget or RequestBudget.for_timeout_ms()
    if len(source) < 8 or len(source) > MAX_INPUT_BYTES or not source.startswith(b"%PDF-"):
        raise ParserError("PDF_PARSER_INPUT_INVALID", HTTPStatus.BAD_REQUEST)
    started = time.monotonic()
    active_budget.check()
    with tempfile.TemporaryDirectory(prefix="leadvirt-pdf-") as directory:
        work = Path(directory)
        path = work / "input.pdf"
        path.write_bytes(source)
        active_budget.check()
        metadata = pdf_metadata(path, active_budget)
        native = run_command(
            ["pdftotext", "-bbox-layout", "-enc", "UTF-8", str(path), "-"],
            active_budget,
            timeout_seconds=active_budget.remaining_seconds(),
        )
        pages = parse_native_words(native, active_budget)
        if len(pages) != metadata["pageCount"]:
            raise ParserError("PDF_PARSER_PAGE_COUNT_MISMATCH")
        warnings: list[str] = []
        ocr_pages = 0
        ocr_pixels = 0
        pages_requiring_ocr = [
            page
            for page in pages
            if int(page["characterCount"]) < NATIVE_CHARACTER_THRESHOLD
        ]
        if allow_ocr and len(pages_requiring_ocr) > MAX_OCR_PAGES:
            raise ParserError("PDF_PARSER_OCR_PAGE_LIMIT")
        retained_characters = sum(
            int(page["characterCount"])
            for page in pages
            if int(page["characterCount"]) >= NATIVE_CHARACTER_THRESHOLD
        )
        retained_words = sum(
            len(page["words"])
            for page in pages
            if int(page["characterCount"]) >= NATIVE_CHARACTER_THRESHOLD
        )
        for page in pages:
            active_budget.check()
            if int(page["characterCount"]) >= NATIVE_CHARACTER_THRESHOLD:
                continue
            if not allow_ocr:
                warnings.append(f"PAGE_{page['pageNumber']}_OCR_REQUIRED")
                page["source"] = "UNREADABLE"
                page["words"] = []
                page["characterCount"] = 0
                continue
            words, pixels = ocr_page(
                path,
                page,
                work,
                ocr_pixels,
                active_budget,
                MAX_CHARACTERS - retained_characters,
                MAX_WORDS - retained_words,
            )
            ocr_pixels += pixels
            page["source"] = "OCR"
            page["words"] = words
            page["characterCount"] = sum(len(word["text"]) for word in words)
            retained_characters += int(page["characterCount"])
            retained_words += len(words)
            ocr_pages += 1
            if not words:
                warnings.append(f"PAGE_{page['pageNumber']}_OCR_EMPTY")
        character_count = sum(int(page["characterCount"]) for page in pages)
        word_count = sum(len(page["words"]) for page in pages)
        if character_count > MAX_CHARACTERS or word_count > MAX_WORDS:
            raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
        active_budget.check()
        result = {
            "contractVersion": CONTRACT_VERSION,
            "parser": {
                "version": PARSER_VERSION,
                "ocrLanguages": OCR_LANGUAGES if allow_ocr else None,
            },
            "document": {
                "sha256": hashlib.sha256(source).hexdigest(),
                "pageCount": metadata["pageCount"],
                "pdfVersion": metadata["pdfVersion"],
            },
            "pages": pages,
            "counts": {
                "characters": character_count,
                "words": word_count,
                "ocrPages": ocr_pages,
                "ocrPixels": ocr_pixels,
            },
            "warnings": warnings,
            "durationMs": round((time.monotonic() - started) * 1000),
        }
        encoded = json.dumps(
            result, ensure_ascii=False, allow_nan=False, separators=(",", ":")
        ).encode("utf-8")
        if len(encoded) > MAX_OUTPUT_BYTES:
            raise ParserError("PDF_PARSER_OUTPUT_LIMIT")
        active_budget.check()
        return result


def verify_dependencies() -> dict[str, int]:
    for command in REQUIRED_COMMANDS:
        if shutil.which(command, path=SAFE_ENV["PATH"]) is None:
            raise ParserError(
                "PDF_PARSER_DEPENDENCY_UNAVAILABLE", HTTPStatus.SERVICE_UNAVAILABLE
            )
    budget = RequestBudget.for_timeout_ms(15_000)
    output = run_command(
        ["tesseract", "--list-langs"],
        budget,
        timeout_seconds=10,
        output_limit=MAX_METADATA_BYTES,
    ).decode("utf-8", "replace")
    available = {
        line.strip()
        for line in output.splitlines()
        if re.fullmatch(r"[A-Za-z0-9_]+", line.strip())
    }
    configured = set(OCR_LANGUAGES.split("+"))
    if not configured.issubset(available):
        raise ParserError(
            "PDF_PARSER_OCR_LANGUAGE_UNAVAILABLE", HTTPStatus.SERVICE_UNAVAILABLE
        )
    return {"commandCount": len(REQUIRED_COMMANDS), "ocrLanguageCount": len(configured)}


def log_event(event: str, **fields: object) -> None:
    record = {"event": event, "service": "business-import-parser", **fields}
    print(
        json.dumps(
            record,
            ensure_ascii=True,
            allow_nan=False,
            separators=(",", ":"),
            sort_keys=True,
        ),
        flush=True,
    )


class Handler(BaseHTTPRequestHandler):
    server_version = "LeadVirtBusinessImportParser/1"

    def log_message(self, _format: str, *args: object) -> None:
        return

    def send_json(self, status: int, value: dict[str, Any]) -> bool:
        encoded = json.dumps(
            value, ensure_ascii=True, allow_nan=False, separators=(",", ":")
        ).encode("ascii")
        try:
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(encoded)
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.close_connection = True
            return False

    def client_disconnected(self) -> bool:
        try:
            readable, _, _ = select.select([self.connection], [], [], 0)
            if not readable:
                return False
            value = self.connection.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT)
            return value == b""
        except BlockingIOError:
            return False
        except OSError:
            return True

    def request_budget(self, started: float) -> RequestBudget:
        raw = self.headers.get("X-LeadVirt-Parser-Budget-Ms")
        if raw is None:
            timeout_ms = REQUEST_TIMEOUT_MS
        elif not re.fullmatch(r"\d{1,6}", raw):
            raise ParserError("PDF_PARSER_DEADLINE_INVALID", HTTPStatus.BAD_REQUEST)
        else:
            timeout_ms = int(raw)
            if timeout_ms < 1 or timeout_ms > REQUEST_TIMEOUT_MS:
                raise ParserError("PDF_PARSER_DEADLINE_INVALID", HTTPStatus.BAD_REQUEST)
        return RequestBudget.for_timeout_ms(timeout_ms, self.client_disconnected, started)

    def read_body(self, length: int, budget: RequestBudget) -> bytes:
        chunks: list[bytes] = []
        remaining = length
        while remaining > 0:
            budget.check()
            self.connection.settimeout(budget.remaining_seconds())
            try:
                chunk = self.rfile.read1(min(64 * 1024, remaining))
            except (TimeoutError, socket.timeout) as error:
                raise ParserError(
                    "PDF_PARSER_TIMEOUT", HTTPStatus.REQUEST_TIMEOUT
                ) from error
            if not chunk:
                raise ParserError("PDF_PARSER_CLIENT_DISCONNECTED", 499)
            chunks.append(chunk)
            remaining -= len(chunk)
        self.connection.settimeout(None)
        budget.check()
        return b"".join(chunks)

    def complete(
        self,
        status: int,
        payload: dict[str, Any],
        code: str,
        started: float,
        input_bytes: int,
        allow_ocr: bool,
        result: dict[str, Any] | None = None,
    ) -> None:
        delivered = self.send_json(status, payload)
        fields: dict[str, object] = {
            "status": int(status),
            "code": code,
            "durationMs": round((time.monotonic() - started) * 1000),
            "inputBytes": input_bytes,
            "ocrAllowed": allow_ocr,
            "responseDelivered": delivered,
        }
        if result is not None:
            counts = result["counts"]
            fields.update(
                {
                    "pageCount": result["document"]["pageCount"],
                    "wordCount": counts["words"],
                    "ocrPageCount": counts["ocrPages"],
                    "ocrPixels": counts["ocrPixels"],
                }
            )
        log_event("request_completed", **fields)

    def do_GET(self) -> None:
        if self.path != "/health":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": {"code": "NOT_FOUND"}})
            return
        status = HTTPStatus.OK if DEPENDENCIES_READY else HTTPStatus.SERVICE_UNAVAILABLE
        self.send_json(
            status,
            {
                "ready": DEPENDENCIES_READY,
                "version": PARSER_VERSION,
                "contractVersion": CONTRACT_VERSION,
                "ocrLanguageCount": len(OCR_LANGUAGES.split("+")),
            },
        )

    def do_POST(self) -> None:
        started = time.monotonic()
        if self.path != "/v1/pdf/extract":
            self.complete(
                HTTPStatus.NOT_FOUND,
                {"error": {"code": "NOT_FOUND"}},
                "NOT_FOUND",
                started,
                0,
                False,
            )
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip()
        if content_type != "application/pdf":
            self.complete(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                {"error": {"code": "PDF_PARSER_CONTENT_TYPE_INVALID"}},
                "PDF_PARSER_CONTENT_TYPE_INVALID",
                started,
                0,
                False,
            )
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length < 1 or length > MAX_INPUT_BYTES:
            self.close_connection = True
            self.complete(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {"error": {"code": "PDF_PARSER_INPUT_LIMIT"}},
                "PDF_PARSER_INPUT_LIMIT",
                started,
                min(max(0, length), MAX_INPUT_BYTES + 1),
                False,
            )
            return
        ocr_header = self.headers.get("X-LeadVirt-OCR", "false").lower()
        if ocr_header not in {"true", "false"}:
            self.close_connection = True
            self.complete(
                HTTPStatus.BAD_REQUEST,
                {"error": {"code": "PDF_PARSER_OCR_HEADER_INVALID"}},
                "PDF_PARSER_OCR_HEADER_INVALID",
                started,
                length,
                False,
            )
            return
        allow_ocr = ocr_header == "true"
        try:
            budget = self.request_budget(started)
        except ParserError as error:
            self.close_connection = True
            self.complete(
                error.status,
                {"error": {"code": error.code}},
                error.code,
                started,
                length,
                allow_ocr,
            )
            return
        if not PROCESSING.acquire(blocking=False):
            self.close_connection = True
            self.complete(
                HTTPStatus.TOO_MANY_REQUESTS,
                {"error": {"code": "PDF_PARSER_BUSY"}},
                "PDF_PARSER_BUSY",
                started,
                length,
                allow_ocr,
            )
            return
        try:
            source = self.read_body(length, budget)
            result = extract_pdf(source, allow_ocr, budget)
            self.complete(
                HTTPStatus.OK,
                {"data": result},
                "OK",
                started,
                length,
                allow_ocr,
                result,
            )
        except ParserError as error:
            self.complete(
                error.status,
                {"error": {"code": error.code}},
                error.code,
                started,
                length,
                allow_ocr,
            )
        except Exception:
            self.complete(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"code": "PDF_PARSER_INTERNAL_ERROR"}},
                "PDF_PARSER_INTERNAL_ERROR",
                started,
                length,
                allow_ocr,
            )
        finally:
            PROCESSING.release()


def main() -> None:
    global DEPENDENCIES_READY
    port_raw = os.environ.get("BUSINESS_IMPORT_PARSER_PORT", "8080")
    if not re.fullmatch(r"\d{1,5}", port_raw):
        raise SystemExit("invalid port")
    port = int(port_raw)
    if port < 1 or port > 65535:
        raise SystemExit("invalid port")
    try:
        readiness = verify_dependencies()
    except ParserError as error:
        log_event("startup_failed", code=error.code)
        raise SystemExit(1) from error
    DEPENDENCIES_READY = True
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    server.daemon_threads = True
    log_event(
        "startup_ready",
        version=PARSER_VERSION,
        contractVersion=CONTRACT_VERSION,
        requestTimeoutMs=REQUEST_TIMEOUT_MS,
        maxOcrPages=MAX_OCR_PAGES,
        maxOcrPixels=MAX_OCR_PIXELS,
        **readiness,
    )
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
