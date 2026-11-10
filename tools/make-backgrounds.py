"""Sample background images for MeloFi, drawn from code (so they are ours to give away: CC0).
   python tools/make-backgrounds.py      -> renderer/assets/bg/*.jpg  (1920x1080)
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 1920, 1080
OUT = os.path.join(os.path.dirname(__file__), '..', 'renderer', 'assets', 'bg')
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)


def vgrad(stops):
    """vertical gradient from [(pos 0..1, (r,g,b)), ...]"""
    y = np.linspace(0, 1, H)[:, None]
    img = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        xs = [p for p, _ in stops]
        ys = [col[c] for _, col in stops]
        img[:, :, c] = np.interp(y, xs, ys)
    return img


def fbm(w, h, octaves=6, seed=0):
    """fractal value noise in 0..1"""
    r = np.random.default_rng(seed)
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = 2 ** (o + 2)
        g = r.random((n + 1, n + 1)).astype(np.float32)
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, np.float32) / 255 * amp
        tot += amp
        amp *= 0.5
    return out / tot


def ridge(seed, base, amp, freq):
    r = np.random.default_rng(seed)
    x = np.arange(W)
    y = np.full(W, base, np.float32)
    for k in range(1, 7):
        y += amp / k * np.sin(x * freq * k * (0.7 + r.random() * 0.6) + r.random() * 6.28)
    return y


def fill_below(img, ys, col, soft=0.0):
    yy = np.arange(H)[:, None]
    mask = (yy >= ys[None, :]).astype(np.float32)
    if soft:
        m = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(soft))
        mask = np.asarray(m, np.float32) / 255
    for c in range(3):
        img[:, :, c] = img[:, :, c] * (1 - mask) + col[c] * mask


def stars(img, n, top=1.0, seed=1):
    r = np.random.default_rng(seed)
    for _ in range(n):
        x, y = int(r.random() * W), int(r.random() * H * top)
        b = 120 + r.random() * 135
        s = 1 if r.random() < 0.9 else 2
        img[y:y + s, x:x + s] = np.maximum(img[y:y + s, x:x + s], b)


def save(img, name):
    img = np.clip(img, 0, 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(OUT, name + '.jpg'), quality=88, optimize=True, progressive=True)
    print(name)


# 1. dusk over mountains
img = vgrad([(0, (18, 22, 58)), (0.45, (92, 60, 110)), (0.7, (230, 130, 90)), (1, (250, 190, 120))])
stars(img, 260, 0.35, 3)
for i, (base, amp, col) in enumerate([(560, 70, (70, 50, 90)), (650, 60, (48, 36, 70)), (760, 50, (30, 24, 48)), (880, 40, (18, 14, 30))]):
    fill_below(img, ridge(10 + i, base, amp, 0.004 + i * 0.002), col, soft=1.2)
save(img, 'dusk-mountains')

# 2. city at night
img = vgrad([(0, (8, 8, 26)), (0.6, (38, 22, 62)), (1, (90, 40, 80))])
stars(img, 180, 0.4, 5)
d = ImageDraw.Draw(Image.new('L', (1, 1)))
moon = np.asarray(Image.new('L', (W, H)), np.float32)
m = Image.new('L', (W, H)); md = ImageDraw.Draw(m); md.ellipse((1450, 140, 1570, 260), fill=255)
m = np.asarray(m.filter(ImageFilter.GaussianBlur(1.5)), np.float32) / 255
glow = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(60)), np.float32) / 255
for c, v in enumerate((245, 238, 220)):
    img[:, :, c] = img[:, :, c] * (1 - m) + v * m + glow * 60
r = np.random.default_rng(9)
city = Image.new('RGB', (W, H), (0, 0, 0)); cm = Image.new('L', (W, H), 0)
cd, mm = ImageDraw.Draw(city), ImageDraw.Draw(cm)
for layer, (top, col) in enumerate([(520, (34, 26, 56)), (620, (20, 16, 36))]):
    x = 0
    while x < W:
        bw = int(40 + r.random() * 120); bh = int(top + r.random() * 260 - layer * 40)
        cd.rectangle((x, bh, x + bw, H), fill=col); mm.rectangle((x, bh, x + bw, H), fill=255)
        for wy in range(bh + 14, H - 10, 22):
            for wx in range(x + 8, x + bw - 8, 16):
                if r.random() < 0.28 - layer * 0.05:
                    cd.rectangle((wx, wy, wx + 6, wy + 9), fill=(255, 214, 140) if r.random() < 0.8 else (170, 210, 255))
        x += bw + int(r.random() * 6)
ci = np.asarray(city, np.float32); cmm = np.asarray(cm, np.float32)[:, :, None] / 255
img = img * (1 - cmm) + ci * cmm
save(img, 'night-city')

# 3. nebula
n1, n2 = fbm(W, H, 7, 21), fbm(W, H, 7, 22)
img = np.zeros((H, W, 3), np.float32)
neb = np.clip((n1 - 0.45) * 2.6, 0, 1) ** 1.6
neb2 = np.clip((n2 - 0.5) * 2.8, 0, 1) ** 1.8
for c, (a, b) in enumerate(((120, 40), (60, 160), (200, 200))):
    img[:, :, c] = 6 + neb * a + neb2 * b
stars(img, 1400, 1.0, 8)
save(img, 'nebula')

# 4. misty forest
img = vgrad([(0, (150, 175, 170)), (0.5, (110, 140, 135)), (1, (40, 60, 58))])
r = np.random.default_rng(31)
for layer in range(5):
    lay = Image.new('L', (W, H), 0); ld = ImageDraw.Draw(lay)
    base = 430 + layer * 120
    x = -40
    while x < W + 40:
        h = 160 + r.random() * 200 + layer * 30; w = 40 + r.random() * 50
        ld.polygon([(x, base + 80), (x + w / 2, base - h), (x + w, base + 80)], fill=255)
        x += w * (0.45 + r.random() * 0.3)
    ld.rectangle((0, base + 60, W, H), fill=255)
    mk = np.asarray(lay.filter(ImageFilter.GaussianBlur(4 - layer * 0.6)), np.float32)[:, :, None] / 255
    tone = np.array([90 - layer * 17, 118 - layer * 21, 112 - layer * 20], np.float32)
    img = img * (1 - mk) + tone * mk
    mist = vgrad([(0, (0, 0, 0)), (base / H, (0, 0, 0)), (min(1, (base + 140) / H), (40, 46, 45)), (1, (0, 0, 0))])
    img = img + mist * 0.35
save(img, 'misty-forest')

# 5. sunset sea
img = vgrad([(0, (30, 40, 90)), (0.38, (210, 110, 120)), (0.5, (255, 190, 120)), (0.5001, (40, 50, 90)), (1, (10, 14, 34))])
sun = Image.new('L', (W, H)); sd = ImageDraw.Draw(sun); sd.ellipse((W / 2 - 70, 470, W / 2 + 70, 610), fill=255)
s = np.asarray(sun, np.float32) / 255; s[540:, :] = 0
sg = np.asarray(Image.fromarray((s * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(40)), np.float32) / 255
for c, v in enumerate((255, 225, 170)):
    img[:, :, c] = img[:, :, c] * (1 - s) + v * s + sg * 90
r = np.random.default_rng(41)
for y in range(545, H, 3):
    k = (y - 540) / (H - 540)
    for _ in range(int(14 * (1 - k * 0.6))):
        w = int((30 + r.random() * 120) * (1 - k * 0.5)); x = int(W / 2 + r.normal(0, 60 + k * 220))
        img[y:y + 2, max(0, x - w // 2):min(W, x + w // 2)] += np.array([120, 80, 40]) * (1 - k) * 0.8
save(img, 'sunset-sea')
