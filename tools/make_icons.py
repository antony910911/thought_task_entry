"""產生 App 圖示：星空、飛碟光束把 Blip「beam up」。

用法：python3 tools/make_icons.py（需要 Pillow）
輸出：icons/apple-touch-icon.png、icon-192.png、icon-512.png、icon-maskable-512.png
"""
import math
import random
from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 1024          # 先畫大圖再縮小，邊緣才漂亮
U = 32            # 一個像素格 = 32px（整張 32×32 格）

# Blip（與 js/aliens.js 相同的 16×16 圖）：睜眼、微笑、腮紅、雙手舉高
BLIP = [
    '...A........A...',
    '....B......B....',
    '.....B....B.....',
    '....BBBBBBBB....',
    '...BLLBBBBBBB...',
    '..BLBBBBBBBBBB..',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '.BBBBBBBBBBBBBB.',
    '..BBBBBBBBBBBB..',
    '...DBBBBBBBBD...',
    '.....DBBBBD.....',
    '....BBBBBBBB....',
    '....BBLLLLBB....',
    '.....DD..DD.....',
    '....DDD..DDD....',
]
EYE = [(6, 4, 'E'), (6, 5, 'W'), (6, 6, 'E'), (7, 3, 'E'), (7, 4, 'E'), (7, 5, 'E'), (7, 6, 'E'), (8, 4, 'E'), (8, 5, 'E')]
MOUTH = [(9, 6), (9, 9), (10, 7), (10, 8)]
ARMS_UP = [(12, 3), (11, 2), (10, 1), (12, 12), (11, 13), (10, 14)]
UFO = [
    '....GGGGG....',
    '...GGWGGGG...',
    '.TSSSSSSSSST.',
    'SSYSSSYSSSYSS',
    '.TTTTTTTTTTT.',
    '...TT...TT...',
]

COL = {
    'B': (52, 199, 89), 'D': (30, 128, 58), 'L': (150, 232, 170), 'A': (255, 214, 10),
    'E': (24, 18, 48), 'W': (255, 255, 255), 'M': (24, 18, 48), 'P': (255, 140, 175),
    'G': (150, 220, 255), 'S': (214, 218, 230), 'T': (140, 146, 168), 'Y': (255, 214, 10),
}


def blip_grid():
    g = [list(r) for r in BLIP]
    for r, c, ch in EYE:
        g[r][c] = ch
        g[r][15 - c] = ch
    for r, c in MOUTH:
        g[r][c] = 'M'
    g[8][2] = g[8][13] = 'P'
    for r, c in [(12, 3), (13, 3), (12, 12), (13, 12)]:
        g[r][c] = 'B'
    for r, c in ARMS_UP:
        g[r][c] = 'B'
    return ["".join(r) for r in g]


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background():
    img = Image.new('RGB', (S, S))
    px = img.load()
    top, mid, bottom = (74, 46, 196), (40, 22, 110), (14, 10, 38)
    cx, cy = S * 0.5, S * 0.18
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx, (y - cy) * 0.9) / (S * 1.05)
            t = min(1, d)
            px[x, y] = lerp(top, mid, t / 0.55) if t < 0.55 else lerp(mid, bottom, (t - 0.55) / 0.45)
    return img


def draw_cells(draw, rows, ox, oy, unit, colors, shadow=None):
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch == '.':
                continue
            x, y = ox + c * unit, oy + r * unit
            draw.rectangle([x, y, x + unit - 1, y + unit - 1], fill=shadow or colors[ch])


def render(scale=1.0):
    img = background().convert('RGBA')
    u = U * scale
    off = (S - S * scale) / 2  # 置中（maskable 版會縮小留邊）

    # 星星：小方塊與十字閃光
    rnd = random.Random(11)
    stars = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(stars)
    for _ in range(26):
        x = rnd.randrange(0, 32) * U
        y = rnd.randrange(0, 32) * U
        if 9 * U < x < 23 * U:
            continue  # 光束區留乾淨
        a = rnd.choice([110, 160, 220])
        s = U // 2
        sd.rectangle([x, y, x + s, y + s], fill=(235, 230, 255, a))
    for x, y in [(4.5, 7), (26.5, 11), (6, 24), (27, 25.5)]:
        x, y = x * U, y * U
        for dx, dy in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]:
            sd.rectangle([x + dx * U / 2, y + dy * U / 2, x + dx * U / 2 + U / 2 - 1, y + dy * U / 2 + U / 2 - 1], fill=(255, 236, 160, 230))
    img = Image.alpha_composite(img, stars)

    ufo_w = len(UFO[0]) * u
    ufo_x = off + (S * scale - ufo_w) / 2
    ufo_y = off + 2.2 * u
    beam_top = ufo_y + 5 * u
    blip_w = 16 * u
    blip_x = off + (S * scale - blip_w) / 2
    blip_y = off + 12.5 * u

    # 光束：用「濾色」疊加，看起來像真的在發光
    beam = Image.new('RGB', (S, S), (0, 0, 0))
    bd = ImageDraw.Draw(beam)
    steps = 80
    for i in range(steps):
        t = i / steps
        y0 = beam_top + (S - beam_top) * t
        y1 = beam_top + (S - beam_top) * (t + 1 / steps) + 1
        half = (3.0 + 8.8 * t) * u
        k = (1 - t) ** 1.3 * 0.75 + 0.12
        bd.rectangle([S / 2 - half, y0, S / 2 + half, y1], fill=(int(255 * k), int(232 * k), int(150 * k)))
    beam = beam.filter(ImageFilter.GaussianBlur(16 * scale))
    img = ImageChops.screen(img.convert('RGB'), beam).convert('RGBA')

    # 光束裡往上飄的光點
    sparks = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    spd = ImageDraw.Draw(sparks)
    for x, y in [(11.5, 11), (20, 9.5), (10, 26), (21.5, 22), (13, 30), (19, 29)]:
        x, y = off + x * u, off + y * u
        spd.rectangle([x, y, x + u / 2, y + u / 2], fill=(255, 245, 200, 230))
    img = Image.alpha_composite(img, sparks)

    # Blip 的發光外框與陰影，讓角色從背景跳出來
    grid = blip_grid()
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    draw_cells(ImageDraw.Draw(glow), grid, blip_x, blip_y, u, COL, shadow=(150, 140, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(26 * scale))
    img = ImageChops.screen(img.convert('RGB'), glow).convert('RGBA')
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    draw_cells(ImageDraw.Draw(shadow), grid, blip_x + u * 0.35, blip_y + u * 0.45, u, COL, shadow=(10, 6, 30, 150))
    img = Image.alpha_composite(img, shadow)

    d = ImageDraw.Draw(img)
    draw_cells(d, grid, blip_x, blip_y, u, COL)
    draw_cells(d, UFO, ufo_x, ufo_y, u, COL)
    return img.convert('RGB')


if __name__ == '__main__':
    full = render(1.0)
    for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
        full.resize((size, size), Image.LANCZOS).save(f'icons/{name}', optimize=True)
    # Android 的 maskable 圖示會被裁成圓形，內容縮小一點留安全邊
    render(0.8).resize((512, 512), Image.LANCZOS).save('icons/icon-maskable-512.png', optimize=True)
    print('ok')
