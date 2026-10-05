#!/usr/bin/env python3
import json
import struct
import subprocess
import sys

host = sys.argv[1]
process = subprocess.Popen([host], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

def exchange(message):
    payload = json.dumps(message).encode('utf-8')
    process.stdin.write(struct.pack('<I', len(payload)) + payload)
    process.stdin.flush()
    header = process.stdout.read(4)
    if len(header) != 4:
        raise RuntimeError(process.stderr.read().decode('utf-8', errors='replace') or 'Native host returned no frame')
    size = struct.unpack('<I', header)[0]
    return json.loads(process.stdout.read(size).decode('utf-8'))

ping = exchange({'command': 'ping'})
dependencies = exchange({'command': 'check_dependencies'})
process.stdin.close()
process.wait(timeout=10)

if not ping.get('ok') or ping.get('status') != 'pong':
    raise SystemExit(f'ping failed: {ping}')
if not dependencies.get('ok'):
    raise SystemExit(f'dependencies unavailable: {dependencies}')
print(json.dumps({'ping': ping, 'dependencies': dependencies}, ensure_ascii=False))
