# 咖啡沖煮模擬館：器具 3D 模型（黏土／低多邊形風）
# 全部以程式建模，輸出 ① models/brewers.glb（網頁 three.js 用）② img/gear/<draw>.webp（圖鑑靜態圖）③ blender/sheet.png（總覽檢查圖）
#   blender -b --factory-startup -P blender/brewers.py -- --export --render --sheet
#   參數：--only cone,chemex  只處理指定器具；--pct 100  圖鑑圖解析度百分比
#
# 慣例：建模單位為公分，寫入頂點時乘 S 轉成公尺。Blender Z 向上（glTF 匯出時轉成 Y 向上）。
# 每個器具是一個根空物件 B_<draw>，子物件以自訂屬性標記用途（匯出成 glTF extras）：
#   role=fill   會依沖煮狀態裁切高度的填充體（液體、粉層）；key、profile（[[r, y], ...] 公尺，內輪廓）
#   role=anchor 定位點（drip 滴落點、kettle 手沖壺擺放點）
#   role=glass / role=flame / role=crust  網頁端特殊材質或動畫
import bpy, bmesh, json, math, os, sys

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
arg = lambda k, d=None: ARGS[ARGS.index('--' + k) + 1] if '--' + k in ARGS else d
flag = lambda k: '--' + k in ARGS
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
ONLY = [x for x in (arg('only', '') or '').split(',') if x]
PCT = int(arg('pct', '100'))
S = 0.01
SEG = 40

# ───────── 色票（黏土粉彩） ─────────
PAL = {
    'ceramic':  ((0.93, 0.62, 0.55), 0.62, 0.0),   # 珊瑚粉陶瓷（V60）
    'cream':    ((0.96, 0.92, 0.84), 0.70, 0.0),
    'mint':     ((0.62, 0.82, 0.74), 0.65, 0.0),   # 手沖壺
    'mint_dk':  ((0.36, 0.55, 0.50), 0.65, 0.0),
    'wood':     ((0.72, 0.48, 0.30), 0.75, 0.0),
    'wood_lt':  ((0.86, 0.68, 0.48), 0.80, 0.0),
    'leather':  ((0.45, 0.28, 0.18), 0.70, 0.0),
    'metal':    ((0.70, 0.72, 0.76), 0.40, 0.6),
    'metal_dk': ((0.38, 0.40, 0.44), 0.45, 0.6),
    'paper':    ((0.93, 0.89, 0.80), 0.90, 0.0),
    'cloth':    ((0.92, 0.88, 0.80), 0.95, 0.0),
    'ground':   ((0.42, 0.26, 0.16), 0.95, 0.0),
    'liquid':   ((0.45, 0.24, 0.11), 0.25, 0.0),
    'water':    ((0.56, 0.78, 0.88), 0.20, 0.0),
    'glass':    ((0.86, 0.95, 0.96), 0.08, 0.0),
    'flame':    ((1.00, 0.62, 0.22), 0.50, 0.0),
    'counter':  ((0.74, 0.55, 0.40), 0.85, 0.0),
    'rubber':   ((0.30, 0.30, 0.32), 0.80, 0.0),
}
ALPHA = {'glass': 0.22, 'liquid': 0.9, 'water': 0.75}

srgb2lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def material(name):
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    col, rough, metal = PAL[name]
    col = tuple(srgb2lin(c) for c in col)  # 色票是 sRGB，Blender 節點吃線性值
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if name in ALPHA:
        b.inputs['Alpha'].default_value = ALPHA[name]
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    if name == 'glass':
        b.inputs['IOR'].default_value = 1.2
    if name == 'flame':
        b.inputs['Emission Color'].default_value = (*col, 1)
        b.inputs['Emission Strength'].default_value = 6.0
    m.diffuse_color = (*col, ALPHA.get(name, 1))
    return m

# ───────── 幾何工具 ─────────
def chaikin(pts, it=2, keep_ends=True):
    """把折線圓角化（黏土感）；端點固定。"""
    for _ in range(it):
        out = [pts[0]] if keep_ends else []
        for a, b in zip(pts, pts[1:]):
            out += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]), (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        if keep_ends: out.append(pts[-1])
        pts = out
    return pts

def link(obj, parent):
    bpy.context.scene.collection.objects.link(obj)
    if parent: obj.parent = parent
    return obj

def mesh_obj(name, verts, faces, mat, parent, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([(x * S, y * S, z * S) for x, y, z in verts], [], faces)
    me.validate()
    if smooth: me.shade_smooth()
    me.materials.append(material(mat))
    return link(bpy.data.objects.new(name, me), parent)

def lathe(name, prof, mat, parent, seg=SEG, round_=2, closed=False, smooth=True):
    """繞 Z 軸旋轉輪廓 [(r, z), ...]（公分）。r=0 的端點收成極點；closed=True 時首尾相接（中空管壁）。"""
    if round_: prof = chaikin(prof, round_, keep_ends=not closed)
    verts, faces, rings = [], [], []
    for r, z in prof:
        if r <= 1e-6:
            verts.append((0, 0, z)); rings.append([len(verts) - 1] * seg)
        else:
            idx = []
            for i in range(seg):
                a = 2 * math.pi * i / seg
                verts.append((r * math.cos(a), r * math.sin(a), z)); idx.append(len(verts) - 1)
            rings.append(idx)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed else [])
    for A, B in pairs:
        for i in range(seg):
            j = (i + 1) % seg
            q = [A[i], A[j], B[j], B[i]]
            q = [v for k, v in enumerate(q) if v not in q[:k]]
            if len(q) >= 3: faces.append(q)
    return mesh_obj(name, verts, faces, mat, parent, smooth)

def tube(name, path, rad, mat, parent, seg=14, round_=2):
    """沿 3D 折線掃出圓管（把手、鵝頸、支架）。"""
    if round_:
        for _ in range(round_):
            out = [path[0]]
            for a, b in zip(path, path[1:]):
                out += [tuple(0.75 * p + 0.25 * q for p, q in zip(a, b)), tuple(0.25 * p + 0.75 * q for p, q in zip(a, b))]
            out.append(path[-1]); path = out
    import mathutils
    V = [mathutils.Vector(p) for p in path]
    verts, faces = [], []
    prev_n = None
    for k, p in enumerate(V):
        t = (V[min(k + 1, len(V) - 1)] - V[max(k - 1, 0)]).normalized()
        n = (prev_n - t * prev_n.dot(t)).normalized() if prev_n else t.orthogonal().normalized()
        prev_n = n
        b = t.cross(n)
        for i in range(seg):
            a = 2 * math.pi * i / seg
            verts.append(tuple(p + rad * (math.cos(a) * n + math.sin(a) * b)))
    for k in range(len(V) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([k * seg + i, k * seg + j, (k + 1) * seg + j, (k + 1) * seg + i])
    # 端蓋
    for k in (0, len(V) - 1):
        verts.append(tuple(V[k])); c = len(verts) - 1
        for i in range(seg):
            j = (i + 1) % seg
            faces.append([c, k * seg + j, k * seg + i] if k == 0 else [c, k * seg + i, k * seg + j])
    return mesh_obj(name, verts, faces, mat, parent)

def sphere(name, c, r, mat, parent, seg=24):
    prof = [(r * math.sin(math.pi * i / 12), -r * math.cos(math.pi * i / 12)) for i in range(13)]
    o = lathe(name, prof, mat, parent, seg=seg, round_=0)
    o.location = tuple(x * S for x in c)
    return o

def empty(name, loc, parent, **props):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.02
    e.location = tuple(x * S for x in loc)
    for k, v in props.items(): e[k] = v
    return link(e, parent)

def root(name):
    return empty(name, (0, 0, 0), None)

def interp(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / max(1e-9, z1 - z0)
    return prof[-1][0] if z > prof[-1][1] else prof[0][0]

def fill(name, key, inner, mat, parent, inset=0.12):
    """填充體：內輪廓（z 遞增，[(r, z)]）往內縮一點、封底封頂成實心。網頁端用裁切平面控制高度。"""
    prof = [(max(0.0, r - inset), z) for r, z in inner]
    solid = [(0, prof[0][1])] + prof + [(0, prof[-1][1])]
    o = lathe(name, solid, mat, parent, round_=0)
    o['role'] = 'fill'; o['key'] = key
    o['profile'] = json.dumps([[round(r * S, 5), round(z * S, 5)] for r, z in prof])
    return o

def cut(prof, z):
    """把內輪廓截到高度 z（圖鑑靜態圖用）。"""
    out = [p for p in prof if p[1] < z]
    return out + [(interp(prof, z), z)]

# ───────── 共用道具 ─────────
def counter():
    R = root('P_counter')
    lathe('counter_top', [(0, -1.8), (15, -1.8), (15.5, -0.9), (15, 0), (0, 0)], 'counter', R, seg=56)
    return R

def kettle():
    """細口手沖壺：原點在壺底中心，鵝頸朝 -X。"""
    R = root('P_kettle')
    lathe('kettle_body', [(0, 0), (5.4, 0), (6.0, 2.5), (5.9, 7), (4.6, 10.5), (3.2, 11.2), (0, 11.2)], 'mint', R)
    lathe('kettle_lid', [(0, 11.0), (3.4, 11.0), (3.0, 11.9), (0, 12.1)], 'cream', R)
    sphere('kettle_knob', (0, 0, 12.6), 0.9, 'mint_dk', R)
    tube('kettle_neck', [(-4.6, 0, 2.2), (-7.5, 0, 3.5), (-10.5, 0, 9.0), (-12.2, 0, 11.6), (-13.8, 0, 11.0), (-14.6, 0, 10.0)], 0.55, 'mint', R)
    tube('kettle_handle', [(5.6, 0, 9.6), (9.0, 0, 9.4), (9.6, 0, 5.5), (8.4, 0, 2.2), (5.8, 0, 1.8)], 0.75, 'wood', R)
    empty('kettle_tip', (-14.7, 0, 9.8), R, role='anchor', key='tip')
    return R

def server(R, z0=0, scale=1.0):
    """玻璃分享壺（Hario 風），回傳 (內輪廓, 壺口高度)。"""
    s = scale
    outer = [(0, z0), (4.6 * s, z0), (5.6 * s, z0 + 2.5 * s), (5.7 * s, z0 + 6 * s), (4.9 * s, z0 + 10 * s), (4.6 * s, z0 + 11.5 * s)]
    inner = [(4.25 * s, z0 + 0.55), (5.25 * s, z0 + 2.7 * s), (5.35 * s, z0 + 6 * s), (4.55 * s, z0 + 10 * s), (4.25 * s, z0 + 11.4 * s)]
    g = lathe('srv_glass', outer + list(reversed(inner)) + [(0, z0 + 0.55)], 'glass', R)
    g['role'] = 'glass'
    tube('srv_handle', [(-5.4 * s, 0, z0 + 9.5 * s), (-8.4 * s, 0, z0 + 9 * s), (-8.6 * s, 0, z0 + 5 * s), (-5.6 * s, 0, z0 + 3.5 * s)], 0.55, 'glass', R)['role'] = 'glass'
    return [(0.0, z0 + 0.55)] + inner, z0 + 11.5 * s

# ───────── 器具 ─────────
def build_cone(static=False):
    R = root('B_cone')
    cup_in, top = server(R)
    fill('cone_cup', 'cup', [(r, z) for r, z in cup_in[1:] if z <= top - 2], 'liquid', R)
    z0 = top
    # V60：底盤＋圓錐杯身＋側把手
    lathe('cone_plate', [(1.4, z0), (5.6, z0), (5.9, z0 + 0.35), (5.6, z0 + 0.7), (1.4, z0 + 0.7)], 'ceramic', R, closed=True, round_=1)
    outer = [(1.6, z0 + 0.4), (6.1, z0 + 8.6), (6.5, z0 + 9.0)]
    inner = [(6.1, z0 + 9.1), (5.7, z0 + 8.6), (1.0, z0 + 0.9)]
    lathe('cone_body', outer + inner, 'ceramic', R, closed=True)
    lathe('cone_foot', [(1.2, z0 + 0.1), (2.7, z0 + 0.1), (2.5, z0 + 1.9), (1.2, z0 + 1.9)], 'ceramic', R, closed=True, round_=1)
    tube('cone_handle', [(-5.2, 0, z0 + 7.0), (-8.4, 0, z0 + 6.6), (-8.6, 0, z0 + 3.6), (-5.0, 0, z0 + 2.2), (-2.9, 0, z0 + 2.4)], 0.75, 'ceramic', R)
    # 濾紙（略高出杯緣）＋粉層＋液體
    pin = [(0.9, z0 + 1.0), (5.55, z0 + 8.9), (5.9, z0 + 9.6)]
    lathe('cone_paper', [(0.6, z0 + 0.95)] + pin[1:] + [(5.75, z0 + 9.6), (5.4, z0 + 8.95), (0.45, z0 + 1.1)], 'paper', R, closed=True, round_=1)
    cone_in = [(0.7, z0 + 1.15), (5.35, z0 + 9.0)]
    fill('cone_bed', 'bed', cone_in, 'ground', R, inset=0.05)
    fill('cone_liq', 'up', cone_in, 'liquid', R, inset=0.1)
    empty('cone_drip', (0, 0, z0 + 0.2), R, role='anchor', key='drip')
    empty('cone_kettle', (17.0, 0, z0 + 13.5), R, role='anchor', key='kettle')
    return R

def build_chemex(static=False):
    R = root('B_chemex')
    W = 10.5  # 腰部高度
    outer = [(0, 0), (6.2, 0), (6.7, 1.2), (6.4, 4.5), (2.4, W - 0.5), (2.1, W + 0.5), (6.9, W + 12.5), (7.2, W + 13.1)]
    inner = [(6.8, W + 13.2), (6.6, W + 12.6), (1.7, W + 0.55), (2.0, W - 0.5), (6.05, 4.5), (6.3, 1.2), (5.8, 0.5), (0, 0.5)]
    lathe('chemex_glass', outer + inner, 'glass', R)['role'] = 'glass'
    # 木頭腰箍＋皮繩＋木珠
    lathe('chemex_collar', [(4.1, W - 2.6), (2.55, W - 0.5), (2.25, W + 0.5), (3.17, W + 2.8), (3.9, W + 2.8), (3.0, W + 0.5), (3.3, W - 0.5), (4.8, W - 2.6)], 'wood', R, closed=True)
    lathe('chemex_tie', [(3.25, W - 0.75), (3.75, W - 0.6), (3.75, W - 0.25), (3.25, W - 0.15)], 'leather', R, closed=True, round_=1)
    sphere('chemex_bead', (0, -4.0, W - 1.4), 0.75, 'wood_lt', R)
    tube('chemex_cord', [(0, -3.6, W - 0.4), (0.4, -4.1, W - 0.9), (0, -4.1, W - 2.6)], 0.16, 'leather', R, seg=8)
    # 厚濾紙（高出杯口）
    lathe('chemex_paper', [(1.5, W + 0.8), (6.4, W + 12.4), (6.6, W + 14.4), (6.35, W + 14.4), (6.2, W + 12.5), (1.25, W + 1.0)], 'paper', R, closed=True, round_=1)
    funnel = [(1.3, W + 1.2), (6.05, W + 12.5)]
    fill('chemex_bed', 'bed', funnel, 'ground', R, inset=0.05)
    fill('chemex_liq', 'up', funnel, 'liquid', R, inset=0.1)
    fill('chemex_cup', 'cup', [(5.8, 0.5), (6.3, 1.2), (6.05, 4.5), (3.4, W - 2.6)], 'liquid', R)
    empty('chemex_drip', (0, 0, W + 0.4), R, role='anchor', key='drip')
    empty('chemex_kettle', (17.0, 0, W + 18.0), R, role='anchor', key='kettle')
    return R

def build_siphon(static=False):
    R = root('B_siphon')
    # 底座＋酒精燈＋火焰
    lathe('sy_base', [(0, 0), (7.5, 0), (7.8, 0.6), (7.4, 1.3), (0, 1.3)], 'metal_dk', R)
    lathe('sy_lamp', [(0, 1.3), (3.2, 1.3), (3.6, 2.6), (3.0, 4.2), (1.0, 4.6), (0, 4.6)], 'glass', R)['role'] = 'glass'
    lathe('sy_lamp_fuel', [(0, 1.5), (2.9, 1.5), (3.2, 2.6), (2.9, 3.1), (0, 3.1)], 'water', R)
    lathe('sy_wick', [(0, 4.4), (0.7, 4.4), (0.7, 5.3), (0, 5.4)], 'metal', R)
    f = lathe('sy_flame', [(0, 5.3), (0.8, 5.55), (0.95, 6.1), (0.5, 6.8), (0, 7.4)], 'flame', R, seg=20)
    f['role'] = 'flame'
    # 支架：直桿＋夾環
    tube('sy_rod', [(-7.0, 0, 1.0), (-7.0, 0, 32)], 0.45, 'metal', R, round_=0)
    C, Rg = 13.0, 5.6
    U = C + Rg + 1.2
    lathe('sy_clamp', [(4.7, U + 6.6), (5.2, U + 6.6), (5.2, U + 7.6), (4.7, U + 7.6)], 'metal', R, closed=True, round_=1)
    tube('sy_arm', [(-7.0, 0, U + 7.1), (-5.1, 0, U + 7.1)], 0.4, 'metal', R, round_=0)
    lathe('sy_ring', [(5.6, C - 0.35), (6.2, C - 0.35), (6.2, C + 0.35), (5.6, C + 0.35)], 'metal', R, closed=True, round_=1)
    tube('sy_ring_arm', [(-7.0, 0, C), (-6.1, 0, C)], 0.35, 'metal', R, round_=0)
    # 下壺（球）
    gl = [(Rg * math.sin(math.pi * i / 16), C - Rg * math.cos(math.pi * i / 16)) for i in range(0, 15)]
    glo = gl + [(1.7, C + Rg + 0.6), (1.8, C + Rg + 2.4)]
    gli = [(1.4, C + Rg + 2.4), (1.35, C + Rg + 0.6)] + [(max(0.0, r - 0.35), z + (0.35 if i == 0 else 0)) for i, (r, z) in reversed(list(enumerate(gl)))][:-1] + [(0, C - Rg + 0.35)]
    lathe('sy_lower', glo + gli, 'glass', R, round_=1)['role'] = 'glass'
    Ri = Rg - 0.45
    zs = [C - Ri + 0.05 + (2 * Ri * 0.93) * i / 15 for i in range(16)]
    fill('sy_low', 'low', [(math.sqrt(max(0.0, Ri * Ri - (z - C) ** 2)), z) for z in zs], 'water', R, inset=0.0)
    # 上座：長管＋碗身＋膠圈
    up_out = [(0.55, C - Rg + 1.6), (0.55, U + 1.0), (1.3, U + 1.6), (4.2, U + 4.0), (4.6, U + 6.0), (4.6, U + 13.5), (4.85, U + 14.0)]
    up_in = [(4.3, U + 14.0), (4.25, U + 13.5), (4.25, U + 6.0), (3.85, U + 4.1), (1.1, U + 1.95), (0.35, U + 1.2), (0.35, C - Rg + 1.6)]
    lathe('sy_upper', up_out + up_in, 'glass', R, closed=True, round_=1)['role'] = 'glass'
    lathe('sy_gasket', [(0.6, C + Rg + 0.3), (1.35, C + Rg + 0.3), (1.35, C + Rg + 1.6), (0.6, C + Rg + 1.6)], 'rubber', R, closed=True, round_=1)
    lathe('sy_filter', [(0, U + 2.25), (1.4, U + 2.25), (1.4, U + 2.55), (0, U + 2.55)], 'cloth', R, round_=1)
    fill('sy_up', 'up', [(1.2, U + 2.6), (3.85, U + 4.4), (4.1, U + 6.0), (4.1, U + 13.0)], 'liquid', R, inset=0.0)
    cr = lathe('sy_crust', [(0, 0), (1, 0), (1, 1.0), (0, 1.0)], 'ground', R, round_=0)
    cr['role'] = 'crust'
    return R

BUILD = {'cone': build_cone, 'chemex': build_chemex, 'siphon': build_siphon}

# 圖鑑靜態圖的狀態（和 draw.js staticState 對應）：各填充體的高度比例
STATIC = {
    'cone':   {'cup': 0.55, 'bed': 0.42, 'up': 0.62},
    'chemex': {'cup': 0.55, 'bed': 0.36, 'up': 0.6},
    'siphon': {'up': 0.85, 'low': 0.12},
}

# ───────── 場景 ─────────
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def apply_static(R, draw):
    """把填充體換成截短的靜態版本（只給算圖用，不影響匯出）。"""
    st = STATIC[draw]
    surf = {}
    for o in list(R.children):
        if o.get('role') != 'fill': continue
        name, key, mat = o.name, o['key'], o.material_slots[0].material.name
        prof = [(r / S, z / S) for r, z in json.loads(o['profile'])]
        z0, z1 = prof[0][1], prof[-1][1]
        k = st.get(key, 0)
        if key == 'up' and 'bed' in st:  # 有粉層時，液面從粉層表面往上算
            z0 = z0 + (z1 - z0) * st['bed']
            k = k * 0.55
        z = z0 + (z1 - z0) * k
        bpy.data.objects.remove(o)
        if k <= 0: continue
        p = [q for q in cut(prof, z) if q[1] > z0 + 1e-3]
        p = [(interp(prof, z0), z0)] + p
        lathe(name + '_s', [(0, z0)] + p + [(0, z)], mat, R, round_=0)
        surf[key] = (z, interp(prof, z))
    for o in R.children:
        if o.get('role') == 'crust' and 'up' in surf:
            z, r = surf['up']
            o.location = (0, 0, (z - 0.9) * S); o.scale = (r, r, 1.0)
    return R

def setup_render(pct):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 640
    sc.render.resolution_percentage = pct
    try: sc.eevee.taa_render_samples = 64
    except Exception: pass
    try: sc.view_settings.view_transform = 'Standard'
    except Exception: pass
    w = bpy.data.worlds.new('W'); sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.95, 0.9, 0.84, 1); bg.inputs['Strength'].default_value = 0.45
    def light(name, kind, loc, rot, energy, size, col=(1, 0.96, 0.9)):
        L = bpy.data.lights.new(name, kind); L.energy = energy; L.color = col
        if kind == 'AREA': L.size = size
        o = bpy.data.objects.new(name, L); o.location = loc; o.rotation_euler = rot
        sc.collection.objects.link(o)
    light('key', 'AREA', (-0.45, -0.55, 0.75), (math.radians(45), 0, math.radians(-38)), 32, 0.6)
    light('fill', 'AREA', (0.6, -0.3, 0.35), (math.radians(70), 0, math.radians(60)), 14, 0.8, (0.9, 0.95, 1))
    light('rim', 'AREA', (0.1, 0.6, 0.6), (math.radians(-50), 0, math.radians(170)), 30, 0.4)
    cam = bpy.data.cameras.new('cam'); cam.lens = 70
    co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
    return co

def frame_camera(co, objs, az=-32, el=24):
    import mathutils
    pts = []
    for o in objs:
        if o.type == 'MESH':
            pts += [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    rad = (hi - lo).length / 2
    d = rad / math.tan(math.atan(18 / co.data.lens) ) * 1.02
    a, e = math.radians(az), math.radians(el)
    co.location = c + mathutils.Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e))) * d
    co.rotation_euler = (c - co.location).to_track_quat('-Z', 'Y').to_euler()

def descendants(o):
    out = [o]
    for c in o.children: out += descendants(c)
    return out

def render_gallery(draws):
    out_dir = os.path.join(ROOT, 'img', 'gear'); os.makedirs(out_dir, exist_ok=True)
    files = []
    for d in draws:
        reset()
        co = setup_render(PCT)
        R = BUILD[d](static=True)
        apply_static(R, d)
        ct = counter(); ct.scale = (0.66, 0.66, 1)  # 圖鑑只放一塊小底座，不放手沖壺
        bpy.context.view_layer.update()
        frame_camera(co, descendants(R) + descendants(ct))
        sc = bpy.context.scene
        sc.render.image_settings.file_format = 'WEBP'
        sc.render.image_settings.color_mode = 'RGBA'
        sc.render.image_settings.quality = 82
        sc.render.filepath = os.path.join(out_dir, d + '.webp')
        bpy.ops.render.render(write_still=True)
        files.append(sc.render.filepath)
        print('RENDER', sc.render.filepath, os.path.getsize(sc.render.filepath))
    return files

def export_glb(draws):
    reset()
    counter(); kettle()
    for d in draws: BUILD[d]()
    path = os.path.join(ROOT, 'models', 'brewers.glb'); os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_extras=True, export_yup=True,
                              use_selection=False, export_cameras=False, export_lights=False, export_apply=True)
    print('EXPORT', path, os.path.getsize(path))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, 'blender', 'brewers.blend'))

def contact_sheet(files):
    """把圖鑑圖拼成一張總覽，方便檢查。"""
    import numpy as np
    imgs = [bpy.data.images.load(f) for f in files]
    w, h = imgs[0].size
    tiles = []
    for im in imgs:
        a = np.empty(w * h * 4, dtype=np.float32); im.pixels.foreach_get(a)
        a = a.reshape(h, w, 4)
        bg = np.array([0.86, 0.82, 0.76], dtype=np.float32)  # 鋪底色，透明處看得出邊界
        a[..., :3] = a[..., :3] * a[..., 3:4] + bg * (1 - a[..., 3:4]); a[..., 3] = 1
        tiles.append(a)
    px = np.concatenate(tiles, axis=1)
    sheet = bpy.data.images.new('sheet', w * len(imgs), h, alpha=True)
    sheet.pixels.foreach_set(px.ravel())
    sheet.filepath_raw = os.path.join(ROOT, 'blender', 'sheet.png'); sheet.file_format = 'PNG'; sheet.save()
    print('SHEET', sheet.filepath_raw)

if __name__ == '__main__':
    draws = ONLY or list(BUILD)
    files = []
    if flag('render'): files = render_gallery(draws)
    if flag('export'): export_glb(draws)
    if flag('sheet') and files: contact_sheet(files)
