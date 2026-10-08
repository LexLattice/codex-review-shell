#!/usr/bin/env python3
"""Run one command in a pseudo-terminal for Direct (Linux and WSL).

Usage: pty-helper.py <rows> <cols> -- <command> [args...]

stdout carries the terminal's output. stdin carries frames: one type byte, a
4-byte big-endian length, then the payload. The same protocol is spoken by
the Windows job runner's ConPTY mode (windows-job-runner.cs).
  'd'  bytes typed into the terminal
  'r'  resize: rows, cols (2-byte big-endian each)
  'k'  signal name (e.g. SIGINT), sent to the command's process group
When stdin ends (the host is gone), the command is hung up (SIGHUP) and
then killed. The exit code is the command's, or 128 + signal.

Run it inside the sandbox (bubblewrap or the PID-namespace launcher) so the
terminal is allocated inside it too.
"""

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios

MAX_FRAME_BYTES = 1 << 20


def set_size(fd, rows, cols):
    rows = max(1, min(int(rows), 1000))
    cols = max(1, min(int(cols), 1000))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def write_all(fd, data):
    view = memoryview(data)
    while view:
        try:
            written = os.write(fd, view)
        except OSError as error:
            if error.errno == errno.EINTR:
                continue
            raise
        view = view[written:]


def signal_group(pid, sig):
    try:
        os.killpg(pid, sig)
    except ProcessLookupError:
        pass


def main(argv):
    if len(argv) < 5 or argv[3] != "--":
        sys.stderr.write("direct-pty-helper: usage: pty-helper.py <rows> <cols> -- <command> [args...]\n")
        return 125
    rows, cols, command = int(argv[1]), int(argv[2]), argv[4:]
    pid, master = pty.fork()
    if pid == 0:
        try:
            os.execvp(command[0], command)
        except OSError as error:
            sys.stderr.write("direct-pty-helper: cannot run %s: %s\n" % (command[0], error.strerror))
        os._exit(127)
    set_size(master, rows, cols)
    stdin_open = True
    pending = b""
    while True:
        watched = [master] + ([0] if stdin_open else [])
        try:
            ready, _, _ = select.select(watched, [], [])
        except InterruptedError:
            continue
        if master in ready:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break  # the command and everything on the terminal exited
                raise
            if not data:
                break
            try:
                write_all(1, data)
            except OSError:
                signal_group(pid, signal.SIGKILL)  # nobody is reading anymore
                break
        if stdin_open and 0 in ready:
            chunk = os.read(0, 65536)
            if not chunk:
                stdin_open = False
                signal_group(pid, signal.SIGHUP)
                continue
            pending += chunk
            while len(pending) >= 5:
                kind = pending[0:1]
                (length,) = struct.unpack(">I", pending[1:5])
                if length > MAX_FRAME_BYTES:
                    signal_group(pid, signal.SIGKILL)
                    return 125
                if len(pending) < 5 + length:
                    break
                payload, pending = pending[5:5 + length], pending[5 + length:]
                if kind == b"d":
                    write_all(master, payload)
                elif kind == b"r" and length == 4:
                    frame_rows, frame_cols = struct.unpack(">HH", payload)
                    set_size(master, frame_rows, frame_cols)  # the kernel sends SIGWINCH
                elif kind == b"k":
                    name = payload.decode("ascii", "replace")
                    sig = getattr(signal, name, None)
                    if isinstance(sig, signal.Signals):
                        signal_group(pid, sig)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
