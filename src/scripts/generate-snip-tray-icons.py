"""
Rasterise lucide's `ImageUpscale` into the Snipping Tool tray assets.

    cd <repo root> && python src/scripts/generate-snip-tray-icons.py

Run it when the tray mark changes, and commit the three PNGs it writes — the
build does not generate them. Paths are relative to the REPO ROOT, not to src/.

Geometry is copied verbatim from
node_modules/lucide-react/dist/esm/icons/image-upscale.mjs so the menu-bar mark
and the in-app page icon are literally the same drawing.

Strokes are rendered by distance field + 8x8 supersampling rather than by
plotting rectangles: this icon is mostly arcs and a diagonal, and at 16px an
aliased diagonal is the difference between a mark and a smudge.
"""
import math
import struct
import zlib

# ── primitives (24-unit lucide grid) ────────────────────────────────────

def seg(x0, y0, x1, y1):
    return ('seg', x0, y0, x1, y1)


def arc(cx, cy, r, a0, a1):
    """Angles in degrees, screen coords (y down), swept a0 -> a1 increasing."""
    return ('arc', cx, cy, r, math.radians(a0), math.radians(a1))


def dist_seg(px, py, x0, y0, x1, y1):
    dx, dy = x1 - x0, y1 - y0
    L2 = dx * dx + dy * dy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * dx + (py - y0) * dy) / L2))
    return math.hypot(px - (x0 + t * dx), py - (y0 + t * dy))


def dist_arc(px, py, cx, cy, r, a0, a1):
    ang = math.atan2(py - cy, px - cx)
    # normalise into [a0, a0+2pi)
    span = a1 - a0
    rel = (ang - a0) % (2 * math.pi)
    if 0 <= rel <= span:
        return abs(math.hypot(px - cx, py - cy) - r)
    e0 = (cx + r * math.cos(a0), cy + r * math.sin(a0))
    e1 = (cx + r * math.cos(a1), cy + r * math.sin(a1))
    return min(math.hypot(px - e0[0], py - e0[1]), math.hypot(px - e1[0], py - e1[1]))


def dist(px, py, prim):
    if prim[0] == 'seg':
        return dist_seg(px, py, *prim[1:])
    return dist_arc(px, py, *prim[1:])


def image_upscale_prims():
    p = []
    # "M16 3h5v5"  — top-right corner bracket
    p += [seg(16, 3, 21, 3), seg(21, 3, 21, 8)]
    # "M17 21h2a2 2 0 0 0 2-2" — bottom-right rounded corner
    p += [seg(17, 21, 19, 21), arc(19, 19, 2, 0, 90)]
    # "M21 12v3" — right edge dash
    p += [seg(21, 12, 21, 15)]
    # "m21 3-5 5" — the diagonal arrow body
    p += [seg(21, 3, 16, 8)]
    # "M3 7V5a2 2 0 0 1 2-2" — top-left rounded corner
    p += [seg(3, 7, 3, 5), arc(5, 5, 2, 180, 270)]
    # "M9 3h3" — top edge dash
    p += [seg(9, 3, 12, 3)]
    # "m5 21 4.144-4.144a1.21 1.21 0 0 1 1.712 0L13 19" — the "mountain" inside
    # the frame. The 1.21r cap between the two strokes is ~1px at this size, so
    # it is joined as a segment rather than an arc.
    p += [seg(5, 21, 9.144, 16.856), seg(9.144, 16.856, 10.856, 16.856), seg(10.856, 16.856, 13, 19)]
    # rect x=3 y=11 w=10 h=10 rx=1 — the image frame
    x0, y0, x1, y1, r = 3, 11, 13, 21, 1
    p += [
        seg(x0 + r, y0, x1 - r, y0), seg(x1, y0 + r, x1, y1 - r),
        seg(x1 - r, y1, x0 + r, y1), seg(x0, y1 - r, x0, y0 + r),
        arc(x1 - r, y0 + r, r, 270, 360), arc(x1 - r, y1 - r, r, 0, 90),
        arc(x0 + r, y1 - r, r, 90, 180), arc(x0 + r, y0 + r, r, 180, 270),
    ]
    return p


# ── raster ──────────────────────────────────────────────────────────────

SS = 8  # supersamples per axis


def render(size, rgb, stroke_units=2.0, min_stroke_px=1.5):
    f = size / 24.0
    hw = max(stroke_units * f, min_stroke_px) / 2.0
    prims = image_upscale_prims()
    px = [[(0, 0, 0, 0)] * size for _ in range(size)]

    for y in range(size):
        for x in range(size):
            hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    # sample point back in 24-unit space
                    gx = (x + (sx + 0.5) / SS) / f
                    gy = (y + (sy + 0.5) / SS) / f
                    d = min(dist(gx, gy, p) for p in prims)
                    if d * f <= hw:
                        hits += 1
            if hits:
                a = round(255 * hits / (SS * SS))
                px[y][x] = (rgb[0], rgb[1], rgb[2], a)
    return px


def write_png(path, px):
    h = len(px)
    w = len(px[0])
    raw = b''.join(
        b'\x00' + bytes(v for x in range(w) for v in px[y][x]) for y in range(h)
    )

    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    data = (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 9))
        + chunk(b'IEND', b'')
    )
    open(path, 'wb').write(data)
    import os
    print(f'  {path}  {w}x{h}  {os.path.getsize(path)} bytes')


def preview(px):
    ramp = ' .:-=+*#@'
    for row in px:
        print('    ' + ''.join(ramp[min(len(ramp) - 1, p[3] * len(ramp) // 256)] for p in row))


d = 'electron/public/tray'
print('\nmacOS template (black + alpha; the OS re-tints it):')
a16 = render(16, (0, 0, 0))
write_png(f'{d}/snipTemplate.png', a16)
write_png(f'{d}/snipTemplate@2x.png', render(32, (0, 0, 0)))
print('\nWindows (white — the taskbar draws it as-is):')
write_png(f'{d}/snip-win.png', render(32, (255, 255, 255)))

print('\n  16px preview (what the menu bar actually gets):')
preview(a16)
