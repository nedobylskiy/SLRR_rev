"""Read-only PE32/PE32+ metadata and debug-directory inspection; does not execute binaries."""
from pathlib import Path
import argparse
import hashlib
import json
import struct


def inspect(path):
    data = Path(path).read_bytes()
    u16 = lambda o: struct.unpack_from('<H', data, o)[0]
    u32 = lambda o: struct.unpack_from('<I', data, o)[0]
    if data[:2] != b'MZ':
        raise ValueError('Not MZ')
    pe = u32(60)
    if data[pe:pe+4] != b'PE\0\0':
        raise ValueError('Not PE')
    count, optsize = u16(pe+6), u16(pe+20)
    opt = pe+24
    magic = u16(opt)
    if magic not in (0x10b, 0x20b):
        raise ValueError('Unknown optional header')
    base = u32(opt+28) if magic == 0x10b else struct.unpack_from('<Q', data, opt+24)[0]
    sections = []
    for i in range(count):
        offset = opt+optsize+i*40
        vs, va, rs, raw = struct.unpack_from('<IIII', data, offset+8)
        sections.append(dict(name=data[offset:offset+8].split(b'\0')[0].decode('ascii'), rva=va, virtualSize=vs, rawSize=rs, rawOffset=raw))

    def rva_offset(rva):
        for sec in sections:
            if sec['rva'] <= rva < sec['rva'] + sec['rawSize']:
                return sec['rawOffset'] + rva-sec['rva']
        if rva < u32(opt+60):
            return rva
        raise ValueError(f'RVA outside raw sections: {rva:#x}')

    def cstr(offset):
        end = data.find(b'\0', offset, offset+4096)
        return data[offset:end if end >= 0 else offset+4096].decode('ascii', errors='replace')

    directories = opt + (96 if magic == 0x10b else 112)
    debug_rva, debug_size = struct.unpack_from('<II', data, directories+6*8)
    debug = []
    for i in range(debug_size//28 if debug_rva else 0):
        off = rva_offset(debug_rva)+i*28
        kind, size, address, raw = struct.unpack_from('<IIII', data, off+12)
        entry = dict(type=kind, size=size, rva=address, rawOffset=raw)
        blob = data[raw:raw+size]
        if kind == 2:
            entry['signature'] = blob[:4].decode('ascii', errors='replace')
            if blob[:4] == b'RSDS':
                entry['pdb'] = blob[24:].split(b'\0')[0].decode('ascii', errors='replace')
            elif blob[:4] == b'NB10':
                entry['pdb'] = blob[16:].split(b'\0')[0].decode('ascii', errors='replace')
        debug.append(entry)
    exports = []
    export_rva, export_size = struct.unpack_from('<II', data, directories)
    if export_rva:
        off = rva_offset(export_rva)
        ordinal_base, function_count, name_count, functions, names, ordinals = struct.unpack_from('<IIIIII', data, off+16)
        for i in range(name_count):
            name = cstr(rva_offset(u32(rva_offset(names)+i*4)))
            ordinal = u16(rva_offset(ordinals)+i*2)
            address = u32(rva_offset(functions)+ordinal*4)
            exports.append(dict(name=name, ordinal=ordinal_base+ordinal, rva=address))
    evidence = {}
    for term in [b'runDLL', b'runMethod', b'libcall.dll', b'callFunction', b'getAngvel', b'getAngVel', b'getAngvel', b'httpRequest']:
        offsets, start = [], 0
        while (start := data.find(term+b'\0', start)) >= 0:
            offsets.append(start)
            start += len(term)+1
        if offsets:
            evidence[term.decode()] = offsets
    return dict(file=Path(path).name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(), machine=hex(u16(pe+4)), timestamp=u32(pe+8),
                coffSymbolTable=u32(pe+12), coffSymbolCount=u32(pe+16), imageBase=hex(base), sections=sections, debug=debug, exports=exports, stringEvidence=evidence)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('paths', nargs='+')
    parser.add_argument('--output')
    args = parser.parse_args()
    result = [inspect(p) for p in args.paths]
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text+'\n', encoding='utf-8')
    else:
        print(text)
