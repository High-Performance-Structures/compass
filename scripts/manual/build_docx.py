#!/usr/bin/env python3
"""Assemble the Compass Developer Manual as a styled Word document.

Reads docs/manual/*.md in file-name order (chapters 01-12, then appendices
A-D) and writes build/manual/Compass Developer Manual.docx with a title page,
a table of contents with page numbers, heading styles, page-numbered footer,
embedded diagrams and tables.

The table of contents is filled in two passes: the document is converted to
PDF with LibreOffice, each heading's page is read back from the PDF, and the
document is written again with those numbers. Without LibreOffice the
contents list is written without page numbers.

Usage:
  python3 scripts/manual/build_docx.py --source docs/manual \
      --diagrams build/manual/diagrams --out build/manual [--soffice PATH]

Supported Markdown: #-#### headings, paragraphs, - and 1. lists (two-space
nesting), > notes, ``` code blocks, | tables |, ![caption](diagrams/x.png),
**bold**, *italic*, `code` and [links](url).
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK, WD_TAB_ALIGNMENT, WD_TAB_LEADER
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Emu, Inches, Pt, RGBColor

TITLE = "Compass Developer Manual"
FOOTER = "Confidential – for development use"
ACCENT = RGBColor(0x1F, 0x3A, 0x5F)
MUTED = RGBColor(0x55, 0x5F, 0x6D)
CODE_FILL = "F3F4F6"
HEADER_FILL = "E5EAF1"
PAGE_WIDTH_IN = 6.5
PAGE_HEIGHT_IN = 8.6


# ---------------------------------------------------------------------------
# Markdown parsing


@dataclass
class Block:
    kind: str  # heading, para, bullet, number, note, code, table, image, pagebreak
    text: str = ""
    level: int = 0
    rows: list[list[str]] = field(default_factory=list)
    path: str = ""


IMAGE = re.compile(r"^!\[(?P<caption>[^\]]*)\]\((?P<path>[^)]+)\)\s*$")
BULLET = re.compile(r"^(?P<indent>\s*)[-*]\s+(?P<text>.*)$")
NUMBER = re.compile(r"^(?P<indent>\s*)\d+[.)]\s+(?P<text>.*)$")
TABLE_SEPARATOR = re.compile(r"^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def split_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|") and not line.endswith("\\|"):
        line = line[:-1]
    cells, current, escaped = [], "", False
    for char in line:
        if escaped:
            current += char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == "|":
            cells.append(current.strip())
            current = ""
        else:
            current += char
    cells.append(current.strip())
    return cells


def parse(markdown: str) -> list[Block]:
    blocks: list[Block] = []
    lines = markdown.split("\n")
    index = 0
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            # An indented paragraph continues the list item above it.
            indented = paragraph[0].startswith("   ")
            blocks.append(Block("para", " ".join(part.strip() for part in paragraph), 1 if indented else 0))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()
        if stripped.startswith("```"):
            flush()
            code: list[str] = []
            index += 1
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(lines[index])
                index += 1
            blocks.append(Block("code", "\n".join(code), 1 if line.startswith("   ") else 0))
            index += 1
            continue
        if not stripped:
            flush()
            index += 1
            continue
        if stripped == "<!-- pagebreak -->":
            flush()
            blocks.append(Block("pagebreak"))
            index += 1
            continue
        if stripped.startswith("<!--"):
            index += 1
            continue
        heading = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if heading:
            flush()
            blocks.append(Block("heading", heading.group(2).strip(), len(heading.group(1))))
            index += 1
            continue
        image = IMAGE.match(stripped)
        if image:
            flush()
            blocks.append(Block("image", image.group("caption"), path=image.group("path")))
            index += 1
            continue
        if stripped.startswith("|") and index + 1 < len(lines) and TABLE_SEPARATOR.match(lines[index + 1].strip()):
            flush()
            rows = [split_row(stripped)]
            index += 2
            while index < len(lines) and lines[index].strip().startswith("|"):
                rows.append(split_row(lines[index]))
                index += 1
            blocks.append(Block("table", rows=rows))
            continue
        if stripped.startswith(">"):
            flush()
            note: list[str] = []
            while index < len(lines) and lines[index].strip().startswith(">"):
                note.append(lines[index].strip().lstrip(">").strip())
                index += 1
            blocks.append(Block("note", " ".join(note)))
            continue
        bullet = BULLET.match(line)
        number = NUMBER.match(line)
        if bullet or number:
            flush()
            match = bullet or number
            text = match.group("text")
            level = len(match.group("indent").replace("\t", "  ")) // 2
            index += 1
            # Continuation lines indented under the item.
            while index < len(lines) and lines[index].startswith("  ") and lines[index].strip() and not BULLET.match(lines[index]) and not NUMBER.match(lines[index]):
                text += " " + lines[index].strip()
                index += 1
            blocks.append(Block("bullet" if bullet else "number", text, min(level, 2)))
            continue
        paragraph.append(line)
        index += 1
    flush()
    return blocks


# ---------------------------------------------------------------------------
# Word helpers


CODE_SPAN = re.compile(r"`([^`]+)`")
PLACEHOLDER = re.compile(r"\x00(\d+)\x00")
# Applied after code spans are masked, so asterisks inside code never count.
EMPHASIS = re.compile(r"(\*\*.+?\*\*|\[[^\]]+\]\([^)]+\)|(?<![\w*])\*[^*\s][^*]*\*(?!\w))")


def add_inline(paragraph, text: str, size: Pt | None = None, color: RGBColor | None = None) -> None:
    codes: list[str] = []

    def mask(match: re.Match) -> str:
        codes.append(match.group(1))
        return f"\x00{len(codes) - 1}\x00"

    masked = CODE_SPAN.sub(mask, text)

    def emit(segment: str, bold: bool = False, italic: bool = False, link: bool = False) -> None:
        for index, piece in enumerate(PLACEHOLDER.split(segment)):
            if not piece and index % 2 == 0:
                continue
            is_code = index % 2 == 1
            run = paragraph.add_run(codes[int(piece)] if is_code else piece)
            run.bold = bold or None
            run.italic = italic or None
            if is_code:
                run.font.name = "Menlo"
                run._element.get_or_add_rPr().get_or_add_rFonts().set(qn("w:eastAsia"), "Menlo")
                run.font.size = Pt((size.pt if size else 10.5) - 1)
                run.font.color.rgb = RGBColor(0x8A, 0x1C, 0x3C)
                continue
            if link:
                run.font.color.rgb = ACCENT
                run.underline = True
            if size:
                run.font.size = size
            if color:
                run.font.color.rgb = color

    for part in EMPHASIS.split(masked):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            emit(part[2:-2], bold=True)
        elif part.startswith("[") and "](" in part:
            emit(part[1 : part.index("](")], link=True)
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            emit(part[1:-1], italic=True)
        else:
            emit(part)


def shade(cell, fill: str) -> None:
    properties = cell._element.get_or_add_tcPr()
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), fill)
    properties.append(shading)


def shade_paragraph(paragraph, fill: str) -> None:
    properties = paragraph._element.get_or_add_pPr()
    shading = OxmlElement("w:shd")
    shading.set(qn("w:val"), "clear")
    shading.set(qn("w:color"), "auto")
    shading.set(qn("w:fill"), fill)
    properties.append(shading)


def repeat_header(row) -> None:
    properties = row._tr.get_or_add_trPr()
    header = OxmlElement("w:tblHeader")
    header.set(qn("w:val"), "true")
    properties.append(header)


def no_split(row) -> None:
    properties = row._tr.get_or_add_trPr()
    cant = OxmlElement("w:cantSplit")
    cant.set(qn("w:val"), "true")
    properties.append(cant)


def add_field(paragraph, instruction: str) -> None:
    run = paragraph.add_run()
    begin = OxmlElement("w:fldChar")
    begin.set(qn("w:fldCharType"), "begin")
    run._r.append(begin)
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = instruction
    run._r.append(instr)
    separate = OxmlElement("w:fldChar")
    separate.set(qn("w:fldCharType"), "separate")
    run._r.append(separate)
    run._r.append(_text("1"))
    end = OxmlElement("w:fldChar")
    end.set(qn("w:fldCharType"), "end")
    run._r.append(end)


def _text(value: str):
    element = OxmlElement("w:t")
    element.text = value
    return element


def column_widths(rows: list[list[str]]) -> list[float]:
    columns = max(len(row) for row in rows)
    weights = []
    for column in range(columns):
        lengths = [len(row[column]) if column < len(row) else 0 for row in rows[:200]]
        average = sum(lengths) / max(len(lengths), 1)
        longest = max(lengths) if lengths else 0
        # Never narrower than the longest unbreakable word (a file name, say).
        tokens = [len(token) for row in rows[:200] if column < len(row) for token in re.split(r"[\s/]+", row[column])]
        longest_token = min(max(tokens, default=0), 28)
        header_token = max((len(token) for token in re.split(r"[\s/]+", rows[0][column])), default=0) if column < len(rows[0]) else 0
        weights.append(max(4.0, longest_token * 1.15, header_token * 1.4, min(average * 0.7 + min(longest, 60) * 0.3, 70.0)))
    total = sum(weights)
    # Whole hundredths of an inch keep the XML widths tidy.
    return [round(PAGE_WIDTH_IN * weight / total, 2) for weight in weights]


# ---------------------------------------------------------------------------
# Document assembly


def setup_styles(document: Document) -> None:
    styles = document.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.12
    sizes = {1: 22, 2: 15, 3: 12.5, 4: 11}
    for level, size in sizes.items():
        style = styles[f"Heading {level}"]
        style.font.name = "Calibri"
        style.element.rPr.rFonts.set(qn("w:eastAsia"), "Calibri")
        style.font.size = Pt(size)
        style.font.bold = True
        style.font.color.rgb = ACCENT if level < 4 else MUTED
        style.paragraph_format.space_before = Pt(18 if level == 1 else 12 if level == 2 else 9)
        style.paragraph_format.space_after = Pt(8 if level == 1 else 4)
        style.paragraph_format.keep_with_next = True
    for level in (1, 2):
        name = f"TOC {level}"
        try:
            style = styles[name]
        except KeyError:
            style = styles.add_style(name, 1)
        style.base_style = normal
        style.font.size = Pt(11 if level == 1 else 10)
        style.font.bold = level == 1
        style.paragraph_format.left_indent = Inches(0 if level == 1 else 0.3)
        style.paragraph_format.space_after = Pt(2 if level == 2 else 4)
        style.paragraph_format.space_before = Pt(6 if level == 1 else 0)
        style.paragraph_format.tab_stops.add_tab_stop(Inches(PAGE_WIDTH_IN), WD_TAB_ALIGNMENT.RIGHT, WD_TAB_LEADER.DOTS)


def set_footer(section, version: str) -> None:
    section.footer.is_linked_to_previous = False
    paragraph = section.footer.paragraphs[0]
    paragraph.text = ""
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = paragraph.add_run(f"{FOOTER}  ·  {TITLE} {version}  ·  Page ")
    run.font.size = Pt(8.5)
    run.font.color.rgb = MUTED
    add_field(paragraph, "PAGE")
    for run in paragraph.runs:
        run.font.size = Pt(8.5)
        run.font.color.rgb = MUTED


def title_page(document: Document, version: str, date: str, commit: str) -> None:
    for _ in range(7):
        document.add_paragraph()
    title = document.add_paragraph()
    run = title.add_run(TITLE)
    run.font.size = Pt(34)
    run.bold = True
    run.font.color.rgb = ACCENT
    subtitle = document.add_paragraph()
    run = subtitle.add_run("Technical reference for understanding, operating, extending and rebuilding Compass")
    run.font.size = Pt(14)
    run.font.color.rgb = MUTED
    document.add_paragraph()
    meta = document.add_paragraph()
    run = meta.add_run(f"Version {version}\n{date}\nSource commit {commit}")
    run.font.size = Pt(11)
    for _ in range(8):
        document.add_paragraph()
    note = document.add_paragraph()
    run = note.add_run(FOOTER)
    run.bold = True
    run.font.size = Pt(11)
    run.font.color.rgb = RGBColor(0x9B, 0x1C, 0x1C)
    note2 = document.add_paragraph()
    run = note2.add_run(
        "This manual is generated from the Compass repository by scripts/manual/build.mjs. "
        "Chapters 1–12 are maintained by hand in docs/manual/; Appendices A–D are regenerated from the code."
    )
    run.font.size = Pt(9)
    run.font.color.rgb = MUTED
    document.add_page_break()


@dataclass
class Heading:
    level: int
    text: str


def toc(document: Document, headings: list[Heading], pages: dict[int, int] | None) -> None:
    heading = document.add_paragraph("Contents", style="Heading 1")
    heading.paragraph_format.space_before = Pt(0)
    for index, entry in enumerate(headings):
        paragraph = document.add_paragraph(style=f"TOC {entry.level}")
        paragraph.add_run(strip_inline(entry.text))
        number = str(pages.get(index, "")) if pages else ""
        paragraph.add_run("\t" + (number or "  "))
    document.add_page_break()


def strip_inline(text: str) -> str:
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text


def add_image(document: Document, path: str, caption: str) -> None:
    from PIL import Image

    with Image.open(path) as image:
        width_px, height_px = image.size
    # Rendered at scale 2; never upscale small diagrams beyond their natural size.
    natural_width = width_px / 2 / 96
    width = min(PAGE_WIDTH_IN, natural_width * 1.05)
    height = width * height_px / width_px
    if height > PAGE_HEIGHT_IN:
        height = PAGE_HEIGHT_IN
        width = height * width_px / height_px
    paragraph = document.add_paragraph()
    paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    paragraph.paragraph_format.keep_with_next = True
    paragraph.add_run().add_picture(path, width=Inches(width))
    caption_paragraph = document.add_paragraph()
    caption_paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = caption_paragraph.add_run(caption)
    run.italic = True
    run.font.size = Pt(9)
    run.font.color.rgb = MUTED


def restart_numbering(document: Document) -> int:
    """A new numbering instance of the List Number style, starting at 1."""
    style = document.styles["List Number"]
    num_id_element = style.element.pPr.find(qn("w:numPr")).find(qn("w:numId"))
    base_num_id = num_id_element.get(qn("w:val"))
    numbering = document.part.numbering_part.element
    abstract_id = None
    for num in numbering.findall(qn("w:num")):
        if num.get(qn("w:numId")) == base_num_id:
            abstract_id = num.find(qn("w:abstractNumId")).get(qn("w:val"))
    existing = [int(num.get(qn("w:numId"))) for num in numbering.findall(qn("w:num"))]
    new_id = max(existing) + 1
    num = OxmlElement("w:num")
    num.set(qn("w:numId"), str(new_id))
    abstract = OxmlElement("w:abstractNumId")
    abstract.set(qn("w:val"), str(abstract_id))
    num.append(abstract)
    override = OxmlElement("w:lvlOverride")
    override.set(qn("w:ilvl"), "0")
    start = OxmlElement("w:startOverride")
    start.set(qn("w:val"), "1")
    override.append(start)
    num.append(override)
    numbering.append(num)
    return new_id


def apply_numbering(paragraph, num_id: int) -> None:
    properties = paragraph._element.get_or_add_pPr()
    num_pr = OxmlElement("w:numPr")
    level = OxmlElement("w:ilvl")
    level.set(qn("w:val"), "0")
    number = OxmlElement("w:numId")
    number.set(qn("w:val"), str(num_id))
    num_pr.append(level)
    num_pr.append(number)
    properties.append(num_pr)


def set_table_geometry(table, widths: list[float]) -> None:
    """Fixed layout with explicit column widths and cell padding.

    LibreOffice ignores per-cell widths unless the table grid carries them,
    so write the grid, the table width and a fixed layout.
    """
    properties = table._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    properties.append(layout)
    width = OxmlElement("w:tblW")
    width.set(qn("w:w"), str(int(sum(widths) * 1440)))
    width.set(qn("w:type"), "dxa")
    for existing in properties.findall(qn("w:tblW")):
        properties.remove(existing)
    properties.append(width)
    margins = OxmlElement("w:tblCellMar")
    for side, value in (("top", 40), ("bottom", 40), ("left", 80), ("right", 80)):
        margin = OxmlElement(f"w:{side}")
        margin.set(qn("w:w"), str(value))
        margin.set(qn("w:type"), "dxa")
        margins.append(margin)
    properties.append(margins)
    grid = table._tbl.tblGrid
    for index, column in enumerate(grid.findall(qn("w:gridCol"))):
        if index < len(widths):
            column.set(qn("w:w"), str(int(widths[index] * 1440)))


def add_table(document: Document, rows: list[list[str]], dense: bool) -> None:
    columns = max(len(row) for row in rows)
    table = document.add_table(rows=0, cols=columns)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    widths = column_widths(rows)
    set_table_geometry(table, widths)
    size = Pt(7.5 if dense else 9)
    for row_index, cells in enumerate(rows):
        row = table.add_row()
        no_split(row)
        if row_index == 0:
            repeat_header(row)
        for column in range(columns):
            cell = row.cells[column]
            cell.width = Inches(widths[column])
            text = cells[column] if column < len(cells) else ""
            paragraph = cell.paragraphs[0]
            paragraph.paragraph_format.space_after = Pt(0)
            paragraph.paragraph_format.line_spacing = 1.0
            if row_index == 0:
                shade(cell, HEADER_FILL)
                run = paragraph.add_run(strip_inline(text))
                run.bold = True
                run.font.size = size
            else:
                add_inline(paragraph, text, size=size)
    document.add_paragraph().paragraph_format.space_after = Pt(2)


def render(blocks_by_file: list[tuple[str, list[Block]]], diagrams: str, version: str, date: str, commit: str, pages: dict[int, int] | None, output: str) -> list[Heading]:
    document = Document()
    section = document.sections[0]
    section.page_width = Inches(8.5)
    section.page_height = Inches(11)
    section.left_margin = section.right_margin = Inches(1)
    section.top_margin = Inches(0.9)
    section.bottom_margin = Inches(0.9)
    setup_styles(document)
    set_footer(section, version)
    title_page(document, version, date, commit)

    headings = [Heading(block.level, block.text) for _, blocks in blocks_by_file for block in blocks if block.kind == "heading" and block.level <= 2]
    toc(document, headings, pages)

    first = True
    list_num_id: int | None = None
    for name, blocks in blocks_by_file:
        dense = name.startswith(("A-", "B-", "C-", "D-"))
        for block in blocks:
            # A top-level numbered list restarts at 1 after any other block;
            # nested bullets inside it keep the count going.
            if block.kind == "number" and block.level == 0 and list_num_id is None:
                list_num_id = restart_numbering(document)
            elif block.kind in ("para", "code") and block.level > 0:
                pass
            elif block.kind not in ("number", "bullet") or (block.kind == "bullet" and block.level == 0):
                list_num_id = None
            if block.kind == "heading":
                if block.level == 1 and not first:
                    document.add_page_break()
                first = False
                document.add_paragraph(strip_inline(block.text), style=f"Heading {block.level}")
            elif block.kind == "para":
                paragraph = document.add_paragraph()
                if block.level > 0:
                    paragraph.paragraph_format.left_indent = Inches(0.25)
                add_inline(paragraph, block.text)
            elif block.kind in ("bullet", "number"):
                style = "List Bullet" if block.kind == "bullet" else "List Number"
                if block.level > 0:
                    style += f" {block.level + 1}"
                paragraph = document.add_paragraph(style=style)
                paragraph.paragraph_format.space_after = Pt(2)
                if block.kind == "number" and block.level == 0 and list_num_id is not None:
                    apply_numbering(paragraph, list_num_id)
                add_inline(paragraph, block.text)
            elif block.kind == "note":
                paragraph = document.add_paragraph()
                paragraph.paragraph_format.left_indent = Inches(0.2)
                shade_paragraph(paragraph, "EEF3F8")
                add_inline(paragraph, block.text, size=Pt(9.5), color=RGBColor(0x2B, 0x3A, 0x4A))
            elif block.kind == "code":
                paragraph = document.add_paragraph()
                shade_paragraph(paragraph, CODE_FILL)
                paragraph.paragraph_format.left_indent = Inches(0.1)
                lines = block.text.split("\n")
                for line_index, line in enumerate(lines):
                    run = paragraph.add_run(line)
                    run.font.name = "Menlo"
                    run._element.rPr.rFonts.set(qn("w:eastAsia"), "Menlo")
                    run.font.size = Pt(8)
                    if line_index < len(lines) - 1:
                        run.add_break(WD_BREAK.LINE)
            elif block.kind == "table":
                add_table(document, block.rows, dense)
            elif block.kind == "image":
                image_path = os.path.join(diagrams, os.path.basename(block.path))
                if os.path.exists(image_path):
                    add_image(document, image_path, block.text)
                else:
                    print(f"warning: missing diagram {image_path}", file=sys.stderr)
            elif block.kind == "pagebreak":
                document.add_page_break()
    document.save(output)
    return headings


def normalize(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", text.lower())


def heading_pages(pdf_path: str, headings: list[Heading]) -> dict[int, int]:
    from pypdf import PdfReader

    reader = PdfReader(pdf_path)
    raw_texts = [page.extract_text() or "" for page in reader.pages]
    page_texts = [normalize(text) for text in raw_texts]
    # Skip the title page and the contents pages (recognised by their dot
    # leaders), then start at the first heading.
    start = 1
    for number, text in enumerate(raw_texts[:20]):
        if text.count("....") >= 5:
            start = number + 1
    while start < len(page_texts) and normalize(strip_inline(headings[0].text))[:30] not in page_texts[start]:
        start += 1
    pages: dict[int, int] = {}
    cursor = start
    for index, heading in enumerate(headings):
        key = normalize(strip_inline(heading.text))[:40]
        for number in range(cursor, len(page_texts)):
            if key and key in page_texts[number]:
                pages[index] = number + 1
                cursor = number
                break
    return pages


def convert(soffice: str, docx_path: str, out_dir: str) -> str:
    subprocess.run([soffice, "--headless", "--convert-to", "pdf", "--outdir", out_dir, docx_path], check=True, stdout=subprocess.DEVNULL)
    return os.path.join(out_dir, os.path.splitext(os.path.basename(docx_path))[0] + ".pdf")


def git(*args: str) -> str:
    try:
        return subprocess.run(["git", *args], check=True, capture_output=True, text=True).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--diagrams", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--soffice", default="")
    parser.add_argument("--version", default="")
    options = parser.parse_args()

    files = sorted(name for name in os.listdir(options.source) if re.match(r"^(\d{2}[a-z]?|[A-D])-.*\.md$", name))
    # Chapter 5's generated ER section (05b) follows chapter 5.
    blocks_by_file = [(name, parse(open(os.path.join(options.source, name), encoding="utf-8").read())) for name in files]

    date = dt.date.today().isoformat()
    commit = git("rev-parse", "--short", "HEAD") or "unknown"
    version = options.version or f"1.0 ({date})"
    os.makedirs(options.out, exist_ok=True)
    output = os.path.join(options.out, f"{TITLE}.docx")

    headings = render(blocks_by_file, options.diagrams, version, date, commit, None, output)
    if options.soffice and os.path.exists(options.soffice):
        with tempfile.TemporaryDirectory() as scratch:
            first_pass = convert(options.soffice, output, scratch)
            pages = heading_pages(first_pass, headings)
        missing = [headings[index].text for index in range(len(headings)) if index not in pages]
        if missing:
            print(f"warning: no page found for {len(missing)} heading(s): {missing[:5]}", file=sys.stderr)
        render(blocks_by_file, options.diagrams, version, date, commit, pages, output)
        convert(options.soffice, output, options.out)
    print(f"wrote {output}")


if __name__ == "__main__":
    main()
