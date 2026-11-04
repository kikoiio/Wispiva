#!/usr/bin/env python3
"""Leave one pause-menu exit on the vendored Luanti 5.10.0 client.

The pause menu is built in the client binary, not in a mod. In this product
both "Exit to Menu" and "Exit to OS" close the window, and the watcher then
stops the world. This script removes the menu button's formspec emission and
moves the remaining process-quit button into that row. The Chinese catalog
shows that button as 退出. The button id stays btn_exit_os.

The sites are instruction offsets in
luanti 5.10.0+dfsg-5+deb13u1build0.26.04.1. A different build is left untouched.
"""

import hashlib
import struct
import sys
from pathlib import Path

# File offset equals the virtual address: the executable LOAD segment has
# p_offset == p_vaddr. Menu-button emission is the straight-line block that
# ends immediately before the OS-button block.
MENU_START = 0x2270DA
MENU_END = 0x2271B8
OS_YPOS = 0x2271D3
MENU_HEAD = bytes.fromhex("4c8bbdd8fdffffba0e000000")
OS_HEAD = bytes.fromhex("4c8bbdd8fdffffba0e000000")
# movsd xmm0, [rbp-0x238]  — the row below the menu button.
OS_YPOS_OLD = bytes.fromhex("f20f1085c8fdffff")
# movsd xmm0, [rbp-0x240]  — the menu button's own row.
OS_YPOS_NEW = bytes.fromhex("f20f1085c0fdffff")
MSGID = b"Exit to OS"
OLD_LABEL = "退出至操作系统".encode()
NEW_LABEL = "退出".encode()


def fail(message):
    print(f"pause menu: {message}", file=sys.stderr)
    raise SystemExit(1)


def patch_client(path):
    if path.is_symlink():
        fail(f"{path} is a symlink")
    data = bytearray(path.read_bytes())
    if MENU_END > len(data) or OS_YPOS + len(OS_YPOS_NEW) > len(data):
        fail("client is smaller than the 5.10.0 pause-menu sites")
    menu = bytes(data[MENU_START:MENU_END])
    ypos = bytes(data[OS_YPOS:OS_YPOS + len(OS_YPOS_OLD)])
    os_head = bytes(data[MENU_END:MENU_END + len(OS_HEAD)])
    already = menu == b"\x90" * (MENU_END - MENU_START) and ypos == OS_YPOS_NEW
    original = (
        menu[: len(MENU_HEAD)] == MENU_HEAD
        and os_head == OS_HEAD
        and ypos == OS_YPOS_OLD
    )
    if already:
        state = "already"
    elif original:
        data[MENU_START:MENU_END] = b"\x90" * (MENU_END - MENU_START)
        data[OS_YPOS:OS_YPOS + len(OS_YPOS_NEW)] = OS_YPOS_NEW
        path.write_bytes(data)
        state = "patched"
    else:
        fail("client bytes do not match luanti 5.10.0+dfsg-5+deb13u1build0.26.04.1")
    if os_head != OS_HEAD and state == "already":
        # The OS button must still begin at the instruction after the gap.
        if bytes(data[MENU_END:MENU_END + len(OS_HEAD)]) != OS_HEAD:
            fail("OS-button instruction moved")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    return state, digest


def patch_catalog(path):
    if path.is_symlink():
        fail(f"{path} is a symlink")
    data = bytearray(path.read_bytes())
    if len(data) < 28:
        fail("catalog is too small")
    magic, _rev, count, orig_off, trans_off, _hash_size, _hash_off = struct.unpack_from(
        "<7I", data, 0
    )
    if magic != 0x950412DE:
        fail("catalog is not a GNU mo file")
    found = None
    for index in range(count):
        orig_len, orig_at = struct.unpack_from("<II", data, orig_off + 8 * index)
        trans_len, trans_at = struct.unpack_from("<II", data, trans_off + 8 * index)
        if data[orig_at:orig_at + orig_len] == MSGID:
            found = (index, trans_len, trans_at)
            break
    if found is None:
        fail("catalog has no Exit to OS entry")
    index, trans_len, trans_at = found
    current = bytes(data[trans_at:trans_at + trans_len])
    if current == NEW_LABEL:
        return "already"
    if current != OLD_LABEL:
        fail("Exit to OS translation is neither 退出 nor 退出至操作系统")
    if trans_at + len(OLD_LABEL) + 1 > len(data) or data[trans_at + trans_len] != 0:
        fail("Exit to OS translation is not NUL-terminated in place")
    data[trans_at:trans_at + len(NEW_LABEL)] = NEW_LABEL
    data[trans_at + len(NEW_LABEL)] = 0
    struct.pack_into("<I", data, trans_off + 8 * index, len(NEW_LABEL))
    path.write_bytes(data)
    return "patched"


def main():
    if len(sys.argv) != 3:
        fail("usage: pause_menu_exit.py CLIENT CATALOG")
    client = Path(sys.argv[1])
    catalog = Path(sys.argv[2])
    client_state, digest = patch_client(client)
    catalog_state = patch_catalog(catalog)
    print(
        f"pause menu exit=one client={client_state} catalog={catalog_state} sha256={digest}"
    )


if __name__ == "__main__":
    main()
