#!/usr/bin/env python3
"""Bounded stdio smoke: multiple binary frames, real dependency discovery, EOF."""
import json
import struct
import subprocess
import sys

host = sys.argv[1]
command = [sys.executable, host] if host.endswith('.py') else [host]
messages = [
    {'command': 'ping'},
    # Include CR/LF, UTF-8, and a frame length containing byte 0x0a. This catches
    # Windows CRT text-mode translation on both sides of the native protocol.
    {'command': 'ping', 'padding': '\r\n雪' + 'x' * 215},
    {'command': 'check_dependencies'},
]
frames = b''
for message in messages:
    payload = json.dumps(message, ensure_ascii=False).encode('utf-8')
    if message.get('padding'):
        while len(payload) % 256 != 10:
            message['padding'] += 'x'
            payload = json.dumps(message, ensure_ascii=False).encode('utf-8')
    frames += struct.pack('<I', len(payload)) + payload
process = subprocess.run(command, input=frames, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
if process.returncode:
    raise SystemExit(process.stderr.decode('utf-8', errors='replace'))
responses = []
offset = 0
for message in messages:
    if len(process.stdout) - offset < 4:
        raise SystemExit('Native host returned incomplete header')
    size = struct.unpack('<I', process.stdout[offset:offset + 4])[0]
    offset += 4
    if not 0 < size <= 1_000_000 or len(process.stdout) - offset < size:
        raise SystemExit('Invalid or truncated response')
    response = json.loads(process.stdout[offset:offset + size].decode('utf-8'))
    offset += size
    if not response.get('ok'):
        raise SystemExit(f'probe failed: {response}')
    if message['command'] == 'ping' and response.get('status') != 'pong':
        raise SystemExit(f'ping failed: {response}')
    if message['command'] == 'check_dependencies' and response.get('status') != 'ready':
        raise SystemExit(f'dependencies unavailable: {response}')
    responses.append(response)
if offset != len(process.stdout):
    raise SystemExit('Unexpected unframed stdout')
print(json.dumps({'ping': responses[0], 'binary_ping': responses[1], 'dependencies': responses[2]}, ensure_ascii=False))
