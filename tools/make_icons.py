"""產生 App 圖示：星空背景中央一台像素飛碟。

用法：python3 tools/make_icons.py（需要 Pillow）
輸出：icons/apple-touch-icon.png、icon-192.png、icon-512.png、icon-maskable-512.png
"""
import math
import random
from PIL import Image, ImageChops, ImageDraw, ImageFilter

S = 1024

# 像素飛碟：G 玻璃罩、W 反光、S 銀色機身、T 深色底、Y 燈
UFO = [
    '....GGGGG....',
    '...GGWGGGG...',
    '.TSSSSSSSSST.',
    'SSYSSSYSSSYSS',
    '.TTTTTTTTTTT.',
    '...TT...TT...',
]
COL = {
    'G': (150, 220, 255), 'W': (255, 255, 255), 'S': (214, 218, 230),
    'T': (140, 146, 168), 'Y': (255, 214, 10),
}


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * max(0, min(1, t))) for i in range(3))


def background():
    img = Image.new('RGB', (S, S))
    px = img.load()
    top, mid, bottom = (74, 46, 196), (40, 22, 110), (14, 10, 38)
    cx, cy = S * 0.5, S * 0.42
    for y in range(S):
        for x in range(S):
            t = min(1, math.hypot(x - cx, y - cy) / (S * 0.78))
            px[x, y] = lerp(top, mid, t / 0.5) if t < 0.5 else lerp(mid, bottom, (t - 0.5) / 0.5)
    return img


def cells(draw, rows, ox, oy, u, fill=None):
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != '.':
                x, y = ox + c * u, oy + r * u
                draw.rectangle([round(x), round(y), round(x + u) - 1, round(y + u) - 1], fill=fill or COL[ch])


def render(scale=1.0):
    img = background()
    grid = S / 32  # 星星對齊的像素格

    # 像素星星：小方塊＋幾顆十字閃光
    rnd = random.Random(11)
    d = ImageDraw.Draw(img)
    for _ in range(30):
        x, y = rnd.randrange(0, 32) * grid, rnd.randrange(0, 32) * grid
        if abs(x - S / 2) < S * 0.38 * scale and abs(y - S * 0.5) < S * 0.18 * scale:
            continue  # 飛碟周圍留乾淨
        a = rnd.choice([120, 170, 230])
        d.rectangle([x, y, x + grid / 2 - 1, y + grid / 2 - 1], fill=(a, a - 10, min(255, a + 30)))
    for cx, cy in [(5, 6), (26, 5), (27, 25), (5, 26)]:
        x, y = cx * grid, cy * grid
        for dx, dy in [(0, 0), (-1, 0), (1, 0), (0, -1), (0, 1)]:
            h = grid / 2
            d.rectangle([x + dx * h, y + dy * h, x + dx * h + h - 1, y + dy * h + h - 1], fill=(255, 236, 160))

    # 飛碟：置中放大，佔畫面寬約 7 成
    u = S * 0.72 * scale / len(UFO[0])
    w, h = len(UFO[0]) * u, len(UFO) * u
    ox, oy = (S - w) / 2, (S - h) / 2 + S * 0.01

    # 背後的光暈（濾色疊加）
    glow = Image.new('RGB', (S, S), (0, 0, 0))
    cells(ImageDraw.Draw(glow), UFO, ox, oy, u, fill=(120, 100, 200))
    img = ImageChops.screen(img, glow.filter(ImageFilter.GaussianBlur(60 * scale)))
    # 燈的光
    lights = Image.new('RGB', (S, S), (0, 0, 0))
    cells(ImageDraw.Draw(lights), [r.replace('G', '.').replace('W', '.').replace('S', '.').replace('T', '.') for r in UFO], ox, oy, u,
          fill=(255, 170, 40))
    img = ImageChops.screen(img, lights.filter(ImageFilter.GaussianBlur(30 * scale)))

    # 陰影讓飛碟浮起來
    shadow = Image.new('L', (S, S), 0)
    cells(ImageDraw.Draw(shadow), UFO, ox + u * 0.35, oy + u * 0.45, u, fill=150)
    img = Image.composite(Image.new('RGB', (S, S), (10, 6, 30)), img, shadow)

    cells(ImageDraw.Draw(img), UFO, ox, oy, u)
    return img


if __name__ == '__main__':
    full = render(1.0)
    for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
        full.resize((size, size), Image.LANCZOS).save(f'icons/{name}', optimize=True)
    # Android 的 maskable 圖示會被裁成圓形，內容縮小一點留安全邊
    render(0.8).resize((512, 512), Image.LANCZOS).save('icons/icon-maskable-512.png', optimize=True)
    print('ok')
