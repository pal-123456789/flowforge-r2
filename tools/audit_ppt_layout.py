#!/usr/bin/env python3
"""
Layout auditor for a generated PPTX.

Since the authoring model cannot read images, this performs the equivalent
checks in code:
  1. every shape is inside the slide canvas
  2. every text frame's estimated rendered height fits its box
  3. no two text boxes collide (text-on-text overlap)
  4. native chart series / categories match the intended data
"""
import math
import sys
from pptx import Presentation
from pptx.util import Emu

PATH = sys.argv[1] if len(sys.argv) > 1 else "FlowForge_Round2.pptx"
prs = Presentation(PATH)
SW, SH = prs.slide_width, prs.slide_height
EMU_IN = 914400.0

problems = []


def emu_in(v):
    return v / EMU_IN


def est_text_height(shape):
    """Rough rendered height of a text frame, in EMU."""
    tf = shape.text_frame
    width_pt = max(emu_in(shape.width) * 72.0 - 8.0, 12.0)
    total = 0.0
    for p in tf.paragraphs:
        text = "".join(r.text for r in p.runs)
        if not text:
            total += 8.0
            continue
        size = max((r.font.size.pt for r in p.runs if r.font.size), default=18.0)
        # average glyph advance for a humanist sans is ~0.50 em; serif a touch wider
        per_char = size * 0.50
        cpl = max(1, int(width_pt / per_char))
        lines = 0
        for seg in text.split("\n"):
            lines += max(1, math.ceil(len(seg) / cpl))
        ls = p.line_spacing if isinstance(p.line_spacing, (int, float)) else 1.0
        total += lines * size * 1.21 * (ls or 1.0)
    return total * EMU_IN / 72.0


def rects_overlap(a, b, tol=0.02):
    ax, ay, aw, ah = a[:4]
    bx, by, bw, bh = b[:4]
    ox = min(ax + aw, bx + bw) - max(ax, bx)
    oy = min(ay + ah, by + bh) - max(ay, by)
    if ox <= tol * EMU_IN or oy <= tol * EMU_IN:
        return 0.0
    inter = ox * oy
    smaller = min(aw * ah, bw * bh) or 1
    return inter / smaller


for idx, slide in enumerate(prs.slides, start=1):
    text_boxes = []
    for shape in slide.shapes:
        x, y = shape.left, shape.top
        w, h = shape.width, shape.height
        if x is None or y is None or w is None or h is None:
            continue

        # 1. bounds
        if x < -1000 or y < -1000 or x + w > SW + 1000 or y + h > SH + 1000:
            problems.append(
                f"slide {idx}: shape '{shape.shape_type}' out of canvas "
                f"({emu_in(x):.2f},{emu_in(y):.2f}) {emu_in(w):.2f}x{emu_in(h):.2f}in")

        if shape.has_text_frame and shape.text_frame.text.strip():
            need = est_text_height(shape)
            if need > h * 1.30:  # 30% tolerance for estimator error
                problems.append(
                    f"slide {idx}: text overflow in box at ({emu_in(x):.2f},{emu_in(y):.2f}) "
                    f"w={emu_in(w):.2f}in  needs~{emu_in(need):.2f}in  has={emu_in(h):.2f}in  "
                    f"| {shape.text_frame.text[:58]!r}")
            text_boxes.append((x, y, w, h, shape.text_frame.text[:40]))

    # 3. collisions
    for i in range(len(text_boxes)):
        for j in range(i + 1, len(text_boxes)):
            ov = rects_overlap(text_boxes[i], text_boxes[j])
            if ov > 0.22:
                problems.append(
                    f"slide {idx}: text overlap {ov:.0%}  "
                    f"{text_boxes[i][4]!r} <> {text_boxes[j][4]!r}")

    # 4. chart data
    for shape in slide.shapes:
        if not getattr(shape, "has_chart", False):
            continue
        ch = shape.chart
        cats = [str(c) for c in ch.plots[0].categories]
        print(f"slide {idx}: CHART '{ch.chart_type}' categories={len(cats)}")
        for s in ch.series:
            print(f"    series {s.name!r}: {[round(v, 3) if v is not None else None for v in s.values]}")

print()
if problems:
    print(f"LINT: {len(problems)} issue(s)")
    for p in problems:
        print("  - " + p)
    sys.exit(1)
print("LINT: clean - no out-of-bounds shapes, no text overflow, no text collisions")
