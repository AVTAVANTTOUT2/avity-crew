"""POSIX terminal exercise for the real CLI subprocess; stdout is one JSON report."""
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

mode, node, cli, project = sys.argv[1:]
pid, fd = pty.fork()
if pid == 0:
    os.chdir(project)
    os.environ['TERM'] = 'xterm-256color'
    os.execv(node, [node, cli] + ([] if mode == 'wizard' else ['attach', '--run', 'run:test']))
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 100, 0, 0))
deadline = time.monotonic() + 12
output = bytearray()
attached = 'Message → '.encode()
form = 'Lancer la session'.encode()
typed_at = None
sent = False
quit_at = None
timed_out = False
wizard_sent = False
while True:
    if time.monotonic() > deadline:
        timed_out = True
        os.kill(pid, signal.SIGKILL)
        break
    ready, _, _ = select.select([fd], [], [], 0.05)
    if ready:
        try:
            chunk = os.read(fd, 65536)
            if not chunk:
                break
            output.extend(chunk)
        except OSError:
            break
    if mode == 'wizard' and form in output and not wizard_sent:
        # Bracketed paste keeps the pasted newline inside the objective draft.
        os.write(fd, '\x1b[200~Nouvel objectif é🧪\rDeuxième ligne\x1b[201~\rCritère observable'.encode())
        os.write(fd, b'\r' * 7)
        wizard_sent = True
        output.clear()
    if mode == 'wizard' and wizard_sent and attached in output and not sent:
        os.write(fd, b'q\r')
        sent = True
    if mode != 'wizard' and attached in output and typed_at is None:
        if mode == 'interrupt':
            os.write(fd, b'\x03')
            sent = True
            typed_at = time.monotonic()
        else:
            os.write(fd, 'brouillon é🧪'.encode())
            typed_at = time.monotonic()
    if mode == 'typing' and typed_at and not sent and time.monotonic() - typed_at > 0.8:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 9, 18, 0, 0))
        os.kill(pid, signal.SIGWINCH)
        os.write(fd, b'\r')
        sent = True
        quit_at = time.monotonic() + 0.7
    if quit_at and time.monotonic() > quit_at:
        os.write(fd, b'q\r')
        quit_at = None
_, status = os.waitpid(pid, 0)
os.close(fd)
print(json.dumps({'code': os.waitstatus_to_exitcode(status), 'timed_out': timed_out, 'output': output.decode('utf-8', errors='replace')}))
