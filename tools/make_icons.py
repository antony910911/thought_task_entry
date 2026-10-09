"""產生 App 圖示：紫色漸層背景上一台發光的飛碟。

用法：python3 tools/make_icons.py（需要 Pillow）
輸出：icons/apple-touch-icon.png、icon-192.png、icon-512.png、icon-maskable-512.png
"""
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SS = 2048  # 先用兩倍大小畫，再縮小做反鋸齒


def gradient(size, stops, vertical=True):
    """多段線性漸層。stops = [(位置0~1, (r,g,b)), ...]"""
    w, h = size
    n = h if vertical else w
    line = Image.new('RGB', (1, n) if vertical else (n, 1))
    px = line.load()
    for i in range(n):
        t = i / max(1, n - 1)
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if p0 <= t <= p1:
                k = (t - p0) / (p1 - p0 or 1)
                c = tuple(int(c0[j] + (c1[j] - c0[j]) * k) for j in range(3))
                px[(0, i) if vertical else (i, 0)] = c
                break
    return line.resize((w, h))


def shape_mask(size, draw_fn, blur=0):
    m = Image.new('L', size, 0)
    draw_fn(ImageDraw.Draw(m))
    return m.filter(ImageFilter.GaussianBlur(blur)) if blur else m


def paste_gradient(img, box, stops, draw_fn, blur=0, vertical=True):
    """在 box 範圍內，用 draw_fn 畫出的形狀當遮罩貼上漸層"""
    x0, y0, x1, y1 = [int(v) for v in box]
    g = gradient((x1 - x0, y1 - y0), stops, vertical)
    layer = Image.new('RGB', img.size)
    layer.paste(g, (x0, y0))
    img.paste(layer, (0, 0), shape_mask(img.size, draw_fn, blur))


def glow(img, draw_fn, color, blur):
    layer = Image.new('RGB', img.size, (0, 0, 0))
    m = shape_mask(img.size, draw_fn, blur)
    layer.paste(Image.new('RGB', img.size, color), (0, 0), m)
    return ImageChops.screen(img, layer)


def render(scale=1.0):
    S = SS
    img = gradient((S, S), [(0, (34, 22, 92)), (0.55, (76, 40, 170)), (1, (150, 66, 214))])

    def P(x, y):  # 以中心為準縮放（maskable 版本會縮小留邊）
        return (S / 2 + (x - 0.5) * S * scale, S / 2 + (y - 0.5) * S * scale)

    def box(x0, y0, x1, y1):
        a, b = P(x0, y0)
        c, d = P(x1, y1)
        return [a, b, c, d]

    # 背後的柔光
    img = glow(img, lambda d: d.ellipse(box(0.12, 0.12, 0.88, 0.75), fill=255), (70, 40, 120), S * 0.09)

    # 星星：四角閃光
    def sparkle(d, cx, cy, r):
        x, y = P(cx, cy)
        r *= S * scale
        d.polygon([(x, y - r), (x + r * 0.22, y - r * 0.22), (x + r, y), (x + r * 0.22, y + r * 0.22),
                   (x, y + r), (x - r * 0.22, y + r * 0.22), (x - r, y), (x - r * 0.22, y - r * 0.22)], fill=255)

    stars = [(0.2, 0.2, 0.035), (0.82, 0.16, 0.025), (0.86, 0.62, 0.03), (0.14, 0.7, 0.022), (0.7, 0.86, 0.018)]
    img = glow(img, lambda d: [sparkle(d, *s) for s in stars], (255, 255, 255), 0)
    img = glow(img, lambda d: [sparkle(d, *s) for s in stars], (180, 160, 255), S * 0.008)
    dots = [(0.32, 0.12), (0.62, 0.09), (0.92, 0.36), (0.08, 0.45), (0.3, 0.9), (0.9, 0.9)]
    img = glow(img, lambda d: [d.ellipse(box(x - 0.006, y - 0.006, x + 0.006, y + 0.006), fill=255) for x, y in dots], (230, 220, 255), 0)

    # 光束：從飛碟底部往下擴散的暖光
    def beam_shape(d):
        d.polygon([P(0.40, 0.56), P(0.60, 0.56), P(0.80, 1.05), P(0.20, 1.05)], fill=255)

    beam = Image.new('RGB', (S, S), (0, 0, 0))
    beam.paste(gradient((S, S), [(0, (0, 0, 0)), (0.5, (0, 0, 0)), (0.56, (255, 214, 120)), (1, (70, 40, 60))]), (0, 0),
               shape_mask((S, S), beam_shape, S * 0.03))
    img = ImageChops.screen(img, beam)

    # 飛碟陰影（讓飛碟浮起來）
    shadow = Image.new('RGB', (S, S), (0, 0, 0))
    m = shape_mask((S, S), lambda d: d.ellipse(box(0.16, 0.47, 0.84, 0.62), fill=255), S * 0.025)
    img = Image.composite(Image.new('RGB', (S, S), (16, 8, 40)), img, m.point(lambda v: int(v * 0.55)))

    # 玻璃罩
    paste_gradient(img, box(0.33, 0.25, 0.67, 0.48), [(0, (210, 244, 255)), (1, (92, 176, 245))],
                   lambda d: d.chord(box(0.33, 0.25, 0.67, 0.61), 180, 360, fill=255))
    # 玻璃罩反光
    hl = shape_mask((S, S), lambda d: d.chord(box(0.37, 0.28, 0.52, 0.45), 190, 300, fill=255), S * 0.004)
    img = Image.composite(Image.new('RGB', (S, S), (255, 255, 255)), img, hl.point(lambda v: int(v * 0.75)))

    # 機身底部（深色的下半圈）
    paste_gradient(img, box(0.14, 0.42, 0.86, 0.60), [(0, (120, 126, 158)), (1, (58, 60, 92))],
                   lambda d: d.ellipse(box(0.14, 0.42, 0.86, 0.60), fill=255))
    # 機身上半（亮銀色）
    paste_gradient(img, box(0.14, 0.40, 0.86, 0.54), [(0, (255, 255, 255)), (0.6, (214, 218, 234)), (1, (168, 174, 200))],
                   lambda d: d.ellipse(box(0.14, 0.40, 0.86, 0.54), fill=255))
    # 機身亮線
    img = glow(img, lambda d: d.arc(box(0.2, 0.415, 0.8, 0.5), 200, 340, fill=255, width=int(S * 0.006 * scale)),
               (255, 255, 255), S * 0.002)

    # 一圈燈
    lights = [0.24, 0.37, 0.5, 0.63, 0.76]
    ys = [0.535, 0.558, 0.565, 0.558, 0.535]
    for x, y in zip(lights, ys):
        img = glow(img, lambda d, x=x, y=y: d.ellipse(box(x - 0.04, y - 0.03, x + 0.04, y + 0.03), fill=255), (255, 170, 40), S * 0.018)
        paste_gradient(img, box(x - 0.024, y - 0.02, x + 0.024, y + 0.02), [(0, (255, 248, 200)), (1, (255, 196, 30))],
                       lambda d, x=x, y=y: d.ellipse(box(x - 0.024, y - 0.02, x + 0.024, y + 0.02), fill=255))
    # 天線
    d = ImageDraw.Draw(img)
    d.line([P(0.5, 0.25), P(0.5, 0.19)], fill=(150, 156, 190), width=int(S * 0.012 * scale))
    img = glow(img, lambda d: d.ellipse(box(0.475, 0.155, 0.525, 0.205), fill=255), (255, 120, 170), S * 0.02)
    paste_gradient(img, box(0.482, 0.162, 0.518, 0.198), [(0, (255, 200, 225)), (1, (255, 90, 150))],
                   lambda d: d.ellipse(box(0.482, 0.162, 0.518, 0.198), fill=255))

    return img.resize((S // 2, S // 2), Image.LANCZOS)


if __name__ == '__main__':
    full = render(1.0)
    for size, name in [(180, 'apple-touch-icon.png'), (192, 'icon-192.png'), (512, 'icon-512.png')]:
        full.resize((size, size), Image.LANCZOS).save(f'icons/{name}', optimize=True)
    # Android 的 maskable 圖示會被裁成圓形，內容縮小一點留安全邊
    render(0.8).resize((512, 512), Image.LANCZOS).save('icons/icon-maskable-512.png', optimize=True)
    print('ok')
