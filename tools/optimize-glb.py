"""Shrinks the embedded textures of a GLB so the single-file page stays light.

Reads a .glb, resizes every embedded image to a max edge, re-encodes it as JPEG
(or keeps PNG when the image has alpha), rebuilds the binary chunk with correct
offsets, and writes a new .glb. Geometry is untouched.

    python tools/optimize-glb.py assets/terrain.glb assets/terrain-2k.glb --max 2048 --quality 88
"""
import argparse
import io
import json
import struct
from pathlib import Path

from PIL import Image


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b'glTF':
        raise SystemExit('not a GLB: ' + str(path))
    version, total = struct.unpack('<II', data[4:12])
    if version != 2:
        raise SystemExit('unsupported glTF version ' + str(version))
    offset, chunks = 12, {}
    while offset < total:
        length, kind = struct.unpack('<II', data[offset:offset + 8])
        chunks[kind] = data[offset + 8:offset + 8 + length]
        offset += 8 + length
    return json.loads(chunks[0x4E4F534A].decode('utf-8')), chunks.get(0x004E4942, b'')


def write_glb(path, gltf, binary):
    json_bytes = json.dumps(gltf, separators=(',', ':')).encode('utf-8')
    json_bytes += b' ' * ((4 - len(json_bytes) % 4) % 4)
    bin_bytes = binary + b'\x00' * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, 'wb') as out:
        out.write(struct.pack('<III', 0x46546C67, 2, total))
        out.write(struct.pack('<II', len(json_bytes), 0x4E4F534A)); out.write(json_bytes)
        out.write(struct.pack('<II', len(bin_bytes), 0x004E4942)); out.write(bin_bytes)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source')
    parser.add_argument('target')
    parser.add_argument('--max', type=int, default=2048, help='max texture edge in pixels')
    parser.add_argument('--quality', type=int, default=88, help='JPEG quality')
    args = parser.parse_args()

    gltf, binary = read_glb(args.source)
    views = gltf['bufferViews']
    image_views = {img['bufferView']: img for img in gltf.get('images', []) if 'bufferView' in img}

    replaced = {}
    total_before = total_after = 0
    for index, image in image_views.items():
        view = views[index]
        start = view.get('byteOffset', 0)
        raw = binary[start:start + view['byteLength']]
        total_before += len(raw)
        pic = Image.open(io.BytesIO(raw))
        has_alpha = pic.mode in ('RGBA', 'LA') and pic.getextrema()[-1][0] < 255
        scale = args.max / max(pic.size)
        if scale < 1:
            pic = pic.resize((max(1, round(pic.width * scale)), max(1, round(pic.height * scale))), Image.LANCZOS)
        buffer = io.BytesIO()
        if has_alpha:
            pic.save(buffer, format='PNG', optimize=True)
            image['mimeType'] = 'image/png'
        else:
            pic.convert('RGB').save(buffer, format='JPEG', quality=args.quality, optimize=True, progressive=True)
            image['mimeType'] = 'image/jpeg'
        payload = buffer.getvalue()
        total_after += len(payload)
        replaced[index] = payload
        print('  view %d: %s %s -> %s %s (%d -> %d bytes)' % (
            index, pic.width, pic.height, pic.width, pic.height, len(raw), len(payload)))

    # Rebuild the binary chunk, walking bufferViews in order with 4-byte alignment.
    out = bytearray()
    for index, view in enumerate(views):
        payload = replaced.get(index)
        if payload is None:
            start = view.get('byteOffset', 0)
            payload = binary[start:start + view['byteLength']]
        out += b'\x00' * ((4 - len(out) % 4) % 4)
        view['byteOffset'] = len(out)
        view['byteLength'] = len(payload)
        out += payload
    gltf['buffers'] = [{'byteLength': len(out)}]
    write_glb(args.target, gltf, bytes(out))
    src, dst = Path(args.source), Path(args.target)
    print('[OK] %s (%.1f MB) -> %s (%.1f MB); textures %.1f MB -> %.1f MB' % (
        src.name, src.stat().st_size / 1048576, dst.name, dst.stat().st_size / 1048576,
        total_before / 1048576, total_after / 1048576))


if __name__ == '__main__':
    main()
