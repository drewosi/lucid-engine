#!/usr/bin/env python3
"""Generate favicon.svg, favicon.png, apple-touch-icon.png at the repo root.

Renders one static frame of the landing-page field engine (index.html):
a Fibonacci point-sphere with an accent equatorial ring, at the same
rotY=0.8 / tilt=0.35 pose used for the reduced-motion still. Point count
and dot sizes are scaled up for legibility at tab-icon sizes.

No dependencies beyond the standard library.
"""

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ---- geometry (mirrors index.html field engine) ----
ROT_Y = 0.8
TILT = 0.35
FOV = 3.2
BODY_COUNT = 240          # 1440 on the hero; fewer + larger reads better tiny
RING_COUNT = 30

# icon layout (64-unit viewbox)
SIZE = 64
CX = CY = 32.0
R = 26.0

# palette (Lucid Engine tokens)
DARK_PT = (232, 230, 221)   # --ink (dark mode)
DARK_ACC = (255, 92, 10)    # --accent (dark mode)
LIGHT_PT = (17, 17, 16)
LIGHT_ACC = (255, 79, 0)
PAPER = (10, 11, 13)        # --paper


def build_points():
    pts = []
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(BODY_COUNT):
        y = 1 - (i / (BODY_COUNT - 1)) * 2
        r = math.sqrt(max(0.0, 1 - y * y))
        th = golden * i
        pts.append((math.cos(th) * r, y, math.sin(th) * r, False))
    for i in range(RING_COUNT):
        phi = (i / RING_COUNT) * math.pi * 2
        pts.append((math.sin(phi), math.cos(phi), 0.0, True))
    return pts


def project(pts):
    """Returns draw list [(px, py, size, alpha, accent)], body pass first."""
    sy, cy = math.sin(ROT_Y), math.cos(ROT_Y)
    st, ct = math.sin(TILT), math.cos(TILT)
    out = []
    for accent_pass in (False, True):
        for x, y, z, a in pts:
            if a != accent_pass:
                continue
            x1 = x * cy + z * sy
            z1 = -x * sy + z * cy
            y1 = y * ct - z1 * st
            z2 = y * st + z1 * ct
            s = FOV / (FOV - z2)
            px = CX + x1 * R * s
            py = CY + y1 * R * s
            t = (z2 + 1) / 2
            if a:
                size, alpha = 2.2 + 1.6 * t, 0.50 + 0.50 * t
            else:
                size, alpha = 1.3 + 1.5 * t, 0.20 + 0.65 * t
            out.append((px, py, size, min(1.0, alpha), a))
    return out


def write_svg(dots, path):
    rects = []
    for px, py, size, alpha, accent in dots:
        rects.append(
            '<rect class="%s" x="%.1f" y="%.1f" width="%.1f" height="%.1f" fill-opacity="%.2f"/>'
            % ('a' if accent else 'p', px - size / 2, py - size / 2, size, size, alpha)
        )
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
        '<style>.p{fill:#111110}.a{fill:#FF4F00}'
        '@media(prefers-color-scheme:dark){.p{fill:#E8E6DD}.a{fill:#FF5C0A}}</style>'
        + ''.join(rects) + '</svg>\n'
    )
    path.write_text(svg)


# ---- minimal PNG rasterizer/encoder ----

def rasterize(px_size, rounded, ss=8):
    """Render dots on a --paper background at px_size; rounded corners optional.
    Returns rows of RGBA bytes."""
    scale = px_size / SIZE
    grid = px_size * ss
    # premultiplied float buffer
    buf = [[0.0, 0.0, 0.0, 0.0] for _ in range(grid * grid)]

    corner = px_size * 0.21 * ss if rounded else 0.0
    br, bg, bb = (c / 255 for c in PAPER)
    for j in range(grid):
        for i in range(grid):
            if corner:
                x, y = i + 0.5, j + 0.5
                cx = min(max(x, corner), grid - corner)
                cyy = min(max(y, corner), grid - corner)
                if (x - cx) ** 2 + (y - cyy) ** 2 > corner * corner:
                    continue
            cell = buf[j * grid + i]
            cell[0], cell[1], cell[2], cell[3] = br, bg, bb, 1.0

    for px, py, size, alpha, accent in project(build_points()):
        cr, cg, cb = ((c / 255) for c in (DARK_ACC if accent else DARK_PT))
        x0 = (px - size / 2) * scale * ss
        y0 = (py - size / 2) * scale * ss
        x1 = x0 + size * scale * ss
        y1 = y0 + size * scale * ss
        for j in range(max(0, int(y0)), min(grid, int(y1) + 1)):
            if not (y0 <= j + 0.5 < y1):
                continue
            for i in range(max(0, int(x0)), min(grid, int(x1) + 1)):
                if not (x0 <= i + 0.5 < x1):
                    continue
                cell = buf[j * grid + i]
                inv = 1 - alpha
                cell[0] = cr * alpha + cell[0] * inv
                cell[1] = cg * alpha + cell[1] * inv
                cell[2] = cb * alpha + cell[2] * inv
                cell[3] = alpha + cell[3] * inv

    rows = []
    n = ss * ss
    for j in range(px_size):
        row = bytearray()
        for i in range(px_size):
            r = g = b = a = 0.0
            for sj in range(ss):
                base = (j * ss + sj) * grid + i * ss
                for si in range(ss):
                    cell = buf[base + si]
                    r += cell[0]; g += cell[1]; b += cell[2]; a += cell[3]
            r, g, b, a = r / n, g / n, b / n, a / n
            if a > 0:
                r, g, b = r / a, g / a, b / a
            row += bytes(min(255, round(v * 255)) for v in (r, g, b, a))
        rows.append(bytes(row))
    return rows


def write_png(rows, path):
    w, h = len(rows[0]) // 4, len(rows)

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data)))

    raw = b''.join(b'\x00' + r for r in rows)
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    path.write_bytes(png)


if __name__ == '__main__':
    dots = project(build_points())
    write_svg(dots, ROOT / 'favicon.svg')
    write_png(rasterize(64, rounded=True), ROOT / 'favicon.png')
    write_png(rasterize(180, rounded=False), ROOT / 'apple-touch-icon.png')
    print('wrote favicon.svg, favicon.png, apple-touch-icon.png')
