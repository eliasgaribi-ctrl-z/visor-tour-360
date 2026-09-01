#!/usr/bin/env python3
"""
Genera panorámicas equirectangulares SINTÉTICAS para probar el visor 360.

No pretenden ser bonitas: pretenden ser VERIFICABLES. Traen rejilla de 15°,
horizonte marcado y las letras N / E / S / O en su yaw correcto, así que de un
vistazo se sabe si la cámara está bien conectada:

    · al arrancar (yaw 0) debe verse la N centrada,
    · empujar el joystick a la DERECHA debe traer la E,
    · empujarlo a la IZQUIERDA debe traer la O,
    · media vuelta debe caer en la S.

Convención de la imagen (la misma que usa PanoSphere):
    x = W · (yaw/360 + 0.5)      yaw 0 al centro, creciendo a la derecha
    y = H · (90 - pitch) / 180   pitch +90 arriba, -90 abajo

Uso:  python3 tools/make_test_panoramas.py [carpeta_de_salida]
"""

import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 4096, 2048
FONT_DIR = Path("/usr/share/fonts/truetype/dejavu")


def font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont:
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    path = FONT_DIR / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size)


def x_of(yaw: float) -> float:
    return W * ((yaw / 360.0) + 0.5)


def y_of(pitch: float) -> float:
    return H * (90.0 - pitch) / 180.0


def mix(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def make(name: str, hue: float, out: Path) -> Path:
    # Paleta derivada del hue, en un rango que se ve como interior fotografiado.
    import colorsys

    def hsv(s, v):
        r, g, b = colorsys.hsv_to_rgb(hue, s, v)
        return (round(r * 255), round(g * 255), round(b * 255))

    ceiling = hsv(0.05, 0.92)
    wall_top = hsv(0.10, 0.80)
    wall_bottom = hsv(0.16, 0.62)
    floor_near = hsv(0.30, 0.28)
    accent = hsv(0.55, 0.95)

    img = Image.new("RGB", (W, H), wall_top)
    draw = ImageDraw.Draw(img)

    # --- Degradado vertical: techo claro → muro → piso oscuro -----------------
    for y in range(H):
        pitch = 90.0 - (y / H) * 180.0
        if pitch > 35:
            t = (pitch - 35) / 55.0
            color = mix(wall_top, ceiling, t)
        elif pitch > -20:
            t = (35 - pitch) / 55.0
            color = mix(wall_top, wall_bottom, t)
        else:
            t = min(1.0, (-20 - pitch) / 70.0)
            color = mix(wall_bottom, floor_near, t)
        draw.line([(0, y), (W, y)], fill=color)

    # --- Paneles de muro cada 30°, para que se note el giro -------------------
    for i in range(0, 12, 2):
        yaw = -180 + i * 30
        box = (int(x_of(yaw)), int(y_of(35)), int(x_of(yaw + 30)), int(y_of(-20)))
        panel = img.crop(box)
        shade = Image.new("RGB", panel.size, (0, 0, 0))
        img.paste(Image.blend(panel, shade, 0.07), box[:2])

    # --- Rejilla de 15° -------------------------------------------------------
    grid = (255, 255, 255)
    for yaw in range(-180, 181, 15):
        major = yaw % 90 == 0
        x = x_of(yaw)
        draw.line([(x, 0), (x, H)], fill=mix(wall_bottom, grid, 0.5 if major else 0.18),
                  width=6 if major else 2)
    for pitch in range(-75, 76, 15):
        y = y_of(pitch)
        major = pitch == 0
        draw.line([(0, y), (W, y)], fill=mix(wall_bottom, grid, 0.6 if major else 0.18),
                  width=8 if major else 2)

    # --- Etiquetas de grados sobre el horizonte -------------------------------
    small = font(46, bold=False)
    for yaw in range(-180, 180, 30):
        draw.text((x_of(yaw) + 12, y_of(0) + 14), f"{yaw}°", font=small, fill=(255, 255, 255))

    # --- Cardinales: N al frente, E a la derecha, O a la izquierda, S atrás ---
    big = font(320)
    sub = font(64)
    cardinals = [(0, "N", "FRENTE"), (90, "E", "DERECHA"), (180, "S", "ATRÁS"), (-90, "O", "IZQUIERDA")]
    for yaw, letter, caption in cardinals:
        for x in {x_of(yaw), x_of(yaw + 360), x_of(yaw - 360)}:
            if -W * 0.2 < x < W * 1.2:
                draw.text((x, y_of(22)), letter, font=big, fill=accent, anchor="mm",
                          stroke_width=10, stroke_fill=(0, 0, 0))
                draw.text((x, y_of(2)), caption, font=sub, fill=(255, 255, 255), anchor="mm",
                          stroke_width=6, stroke_fill=(0, 0, 0))

    # --- Nombre de la habitación (arriba y abajo, para checar el pitch) -------
    title = font(150)
    draw.text((x_of(0), y_of(62)), name.upper(), font=title, fill=(255, 255, 255), anchor="mm",
              stroke_width=8, stroke_fill=(0, 0, 0))
    draw.text((x_of(0), y_of(-62)), f"PISO · {name.upper()}", font=sub, fill=(255, 255, 255),
              anchor="mm", stroke_width=6, stroke_fill=(0, 0, 0))

    # --- Marcas de polo: si la esfera está mal, aquí se ve el remolino --------
    for pitch, text in ((88, "▲ CENIT"), (-88, "▼ NADIR")):
        draw.text((x_of(0), y_of(pitch)), text, font=sub, fill=(255, 255, 255), anchor="mm",
                  stroke_width=6, stroke_fill=(0, 0, 0))

    # --- Costura: la columna de yaw ±180 debe ser invisible en el visor -------
    draw.line([(0, 0), (0, H)], fill=accent, width=4)
    draw.line([(W - 4, 0), (W - 4, H)], fill=accent, width=4)

    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "JPEG", quality=82, optimize=True, progressive=True)
    return out


def main() -> None:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "public/panoramas")
    rooms = [("Sala", 0.08), ("Cocina", 0.45), ("Recámara", 0.72)]
    slugs = ["sala", "cocina", "recamara"]
    for (name, hue), slug in zip(rooms, slugs):
        path = make(name, hue, target / f"{slug}.jpg")
        print(f"  {path}  ({path.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
