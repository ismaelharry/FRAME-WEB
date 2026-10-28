"""Genera los archivos de marca de FRAME a partir del logotipo original.

Símbolo: corchetes concéntricos, vectorizado con las medidas exactas del logotipo original de FRAME.
Texto: «FRAME» + «ESTUDIO DE CONTENIDO / Y COWORKING», convertido a trazos para que no dependa de fuentes.

Uso:  python3 scripts/brand/build-brand.py
Requiere: fontTools + brotli (pip install fonttools brotli).
Salida: public/brand/*.svg y public/js/model/brand-symbol.mjs (geometría para la maqueta 3D).
"""
import json
import os
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FONT = os.path.join(ROOT, 'public', 'fonts', 'archivo-wdth.woff2')
OUT = os.path.join(ROOT, 'public', 'brand')
INK, PAPER = '#141312', '#F3EFE7'

# --------------------------------------------------------------- símbolo
# Cuadrícula de 682 × 682 medida sobre el logotipo original (ficha de datos de FRAME).
# Rectángulos [x0, y0, x1, y1] en negro.
S = 682
RECTS = [
    [0, 0, 315, 49], [367, 0, 682, 49], [0, 49, 56, 316], [262, 49, 315, 85], [627, 49, 682, 316],
    [74, 66, 262, 85], [367, 66, 608, 85], [74, 85, 95, 316], [587, 85, 608, 316],
    [123, 111, 315, 141], [367, 111, 559, 141], [123, 141, 155, 571], [527, 141, 559, 571],
    [0, 366, 56, 682], [74, 366, 95, 611], [587, 366, 608, 611], [627, 366, 682, 682],
    [155, 541, 315, 571], [367, 541, 527, 571], [95, 596, 315, 611], [367, 596, 587, 611],
    [211, 611, 315, 682], [56, 626, 211, 682], [367, 626, 627, 682],
]


def symbol_path(ox=0.0, oy=0.0, k=1.0):
    f = lambda v: f'{v:.2f}'.rstrip('0').rstrip('.')
    return ''.join(f'M{f(ox + a * k)} {f(oy + b * k)}H{f(ox + c * k)}V{f(oy + d * k)}H{f(ox + a * k)}Z' for a, b, c, d in RECTS)


# ----------------------------------------------------------------- texto
_cache = {}


def font(wdth, wght):
    key = (wdth, wght)
    if key not in _cache:
        _cache[key] = instantiateVariableFont(TTFont(FONT), {'wdth': wdth, 'wght': wght})
    return _cache[key]


def text_path(text, wdth, wght, cap_px, tracking_em, ox, oy_cap_top):
    """Devuelve (path, ancho) del texto con la altura de mayúsculas cap_px, empezando en ox y con la línea de mayúsculas en oy_cap_top."""
    f = font(wdth, wght)
    gs, cmap, upm = f.getGlyphSet(), f.getBestCmap(), f['head'].unitsPerEm
    cap = f['OS/2'].sCapHeight or 700
    k = cap_px / cap
    x = 0.0
    cmds = []
    names = [cmap[ord(ch)] for ch in text]
    # Ancho real: desde el primer trazo hasta el final del último glifo (sin sangría lateral).
    bp = BoundsPen(gs); gs[names[0]].draw(bp); lsb = bp.bounds[0] if bp.bounds else 0
    for i, n in enumerate(names):
        g = gs[n]
        pen = SVGPathPen(gs, ntos=lambda v: f'{v:.2f}'.rstrip('0').rstrip('.'))
        g.draw(TransformPen(pen, (k, 0, 0, -k, ox + (x - lsb) * k, oy_cap_top + cap * k)))
        cmds.append(pen.getCommands())
        x += g.width + (tracking_em * upm if i < len(names) - 1 else 0)
    last = gs[names[-1]]; bp = BoundsPen(gs); last.draw(bp)
    rsb = last.width - bp.bounds[2] if bp.bounds else 0
    return ' '.join(cmds), (x - lsb - rsb) * k


# Proporciones medidas en la versión «Clásico» del logotipo (símbolo = 1).
WORD = dict(wdth=125, wght=600)
TAG = dict(wdth=112, wght=420)
WORD_CAP, WORD_TOP = 0.385 * S, 0.156 * S
TAG_CAP, TAG_L1, TAG_L2 = 0.115 * S, 0.70 * S, 0.885 * S
GAP = 0.30 * S
WORD_RATIO = 7.24          # ancho de «FRAME» / altura de mayúsculas
TAG_RATIO = 0.93           # ancho de «ESTUDIO DE CONTENIDO» / ancho de «FRAME»


def fit_tracking(text, spec, cap, target):
    lo, hi = -0.05, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        _, w = text_path(text, spec['wdth'], spec['wght'], cap, mid, 0, 0)
        lo, hi = (mid, hi) if w < target else (lo, mid)
    return (lo + hi) / 2


word_track = fit_tracking('FRAME', WORD, WORD_CAP, WORD_CAP * WORD_RATIO)
_, word_w = text_path('FRAME', WORD['wdth'], WORD['wght'], WORD_CAP, word_track, 0, 0)
tag_track = fit_tracking('ESTUDIO DE CONTENIDO', TAG, TAG_CAP, word_w * TAG_RATIO)


def svg(w, h, body, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" width="{w:.0f}" height="{h:.0f}" role="img" aria-label="{label}">'
            f'<title>{label}</title>{body}</svg>\n')


LABEL = 'FRAME · Estudio de contenido y coworking'


def lockup_horizontal(ink):
    tx = S + GAP
    p1, w1 = text_path('FRAME', WORD['wdth'], WORD['wght'], WORD_CAP, word_track, tx, WORD_TOP)
    p2, w2 = text_path('ESTUDIO DE CONTENIDO', TAG['wdth'], TAG['wght'], TAG_CAP, tag_track, tx + 4, TAG_L1)
    p3, w3 = text_path('Y COWORKING', TAG['wdth'], TAG['wght'], TAG_CAP, tag_track, tx + 4, TAG_L2)
    w = tx + max(w1, w2 + 4, w3 + 4)
    return svg(w, S, f'<path fill="{ink}" d="{symbol_path()}{p1}{p2}{p3}"/>', LABEL)


def lockup_compact(ink):
    """Símbolo + «FRAME» (para tamaños pequeños, donde el lema no se leería)."""
    cap = 0.46 * S
    tx = S + 0.27 * S
    p1, w1 = text_path('FRAME', WORD['wdth'], WORD['wght'], cap, word_track, tx, (S - cap) / 2)
    return svg(tx + w1, S, f'<path fill="{ink}" d="{symbol_path()}{p1}"/>', 'FRAME')


def lockup_vertical(ink):
    cap = 0.40 * S
    p_tmp, w1 = text_path('FRAME', WORD['wdth'], WORD['wght'], cap, word_track, 0, 0)
    tcap = cap * TAG_CAP / WORD_CAP
    _, w2 = text_path('ESTUDIO DE CONTENIDO', TAG['wdth'], TAG['wght'], tcap, tag_track, 0, 0)
    _, w3 = text_path('Y COWORKING', TAG['wdth'], TAG['wght'], tcap, tag_track, 0, 0)
    W = max(w1, w2, S)
    y_word = S + 0.30 * S
    y_t1 = y_word + cap + 0.26 * S
    y_t2 = y_t1 + tcap * 1.6
    sym = symbol_path((W - S) / 2, 0)
    p1, _ = text_path('FRAME', WORD['wdth'], WORD['wght'], cap, word_track, (W - w1) / 2, y_word)
    p2, _ = text_path('ESTUDIO DE CONTENIDO', TAG['wdth'], TAG['wght'], tcap, tag_track, (W - w2) / 2, y_t1)
    p3, _ = text_path('Y COWORKING', TAG['wdth'], TAG['wght'], tcap, tag_track, (W - w3) / 2, y_t2)
    return svg(W, y_t2 + tcap, f'<path fill="{ink}" d="{sym}{p1}{p2}{p3}"/>', LABEL)


def symbol_svg(ink, pad=0):
    return svg(S + 2 * pad, S + 2 * pad, f'<path fill="{ink}" d="{symbol_path(pad, pad)}"/>', 'FRAME')


files = {
    'frame-logo-dark.svg': lockup_horizontal(INK),
    'frame-logo-light.svg': lockup_horizontal(PAPER),
    'frame-logo-compact-dark.svg': lockup_compact(INK),
    'frame-logo-compact-light.svg': lockup_compact(PAPER),
    'frame-logo-vertical-dark.svg': lockup_vertical(INK),
    'frame-logo-vertical-light.svg': lockup_vertical(PAPER),
    'frame-symbol-dark.svg': symbol_svg(INK),
    'frame-symbol-light.svg': symbol_svg(PAPER),
    # Favicon: símbolo claro sobre fondo carbón con margen.
    'favicon.svg': (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {S + 180} {S + 180}">'
                    f'<rect width="{S + 180}" height="{S + 180}" rx="170" fill="{INK}"/>'
                    f'<path fill="{PAPER}" d="{symbol_path(90, 90)}"/></svg>\n'),
}
os.makedirs(OUT, exist_ok=True)
for name, content in files.items():
    with open(os.path.join(OUT, name), 'w') as fh:
        fh.write(content)

with open(os.path.join(ROOT, 'public', 'js', 'model', 'brand-symbol.mjs'), 'w') as fh:
    fh.write('// Generado por scripts/brand/build-brand.py: geometría del símbolo de FRAME (cuadrícula 590 × 590).\n')
    fh.write(f'export const SYMBOL_SIZE = {S};\n')
    fh.write(f'export const SYMBOL_RECTS = {json.dumps(RECTS)};\n')
    import re
    ar = {}
    for key, name in (('horizontal', 'frame-logo-dark.svg'), ('compact', 'frame-logo-compact-dark.svg'), ('vertical', 'frame-logo-vertical-dark.svg')):
        w, h = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', files[name]).groups())
        ar[key] = round(w / h, 4)
    fh.write(f'export const LOGO_ASPECT = {json.dumps(ar)};\n')

print('tracking FRAME', round(word_track, 4), 'lema', round(tag_track, 4))
for name in files:
    print(name)
