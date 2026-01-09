#!/usr/bin/env python3
# compare_drive_vs_db.py
# Usage:
#   python compare_drive_vs_db.py --base-url https://dev-swc-backend-1v2c.onrender.com --folder-id FOLDER_ID --out missing.csv
# If your endpoints require an admin header, pass --admin-username USERNAME

import argparse
import csv
import requests
import sys

def fetch_all_drive_ids(base_url, folder_id, headers=None, page_size=200):
    drive_ids = []
    page = 1
    while True:
        url = f"{base_url.rstrip('/')}/api/list-pdfs/{folder_id}"
        params = {'page': page, 'page_size': page_size}
        r = requests.get(url, params=params, headers=headers, timeout=30)
        r.raise_for_status()
        js = r.json()
        if not isinstance(js, dict) or 'pdfs' not in js:
            raise RuntimeError(f"Unexpected response from {url}: {js}")
        pdfs = js.get('pdfs', [])
        for p in pdfs:
            drive_ids.append({'id': p.get('id'), 'title': p.get('title'), 'createdTime': p.get('createdTime'), 'modifiedTime': p.get('modifiedTime')})
        if not js.get('has_more', False):
            break
        page += 1
    return drive_ids

def fetch_all_db_books(base_url, headers=None):
    url = f"{base_url.rstrip('/')}/api/all-books"
    r = requests.get(url, headers=headers, timeout=30)
    r.raise_for_status()
    js = r.json()
    # API returns { "success": True, "books": [...] } per server.py
    books = js.get('books') if isinstance(js, dict) and 'books' in js else js
    if books is None:
        raise RuntimeError(f"Unexpected /api/all-books response: {js}")
    # Normalize into list of dicts with drive_id, title, etc.
    normalized = []
    for b in books:
        normalized.append({
            'db_id': b.get('id'),
            'drive_id': b.get('drive_id'),
            'title': b.get('title'),
            'external_story_id': b.get('external_story_id'),
            'created_at': b.get('created_at'),
            'updated_at': b.get('updated_at')
        })
    return normalized

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--base-url', required=True, help='Base URL for backend (e.g. https://dev-swc-backend-1v2c.onrender.com)')
    p.add_argument('--folder-id', required=True, help='Google Drive folder id to list PDFs from')
    p.add_argument('--admin-username', required=False, help='Optional admin username to send as X-Admin-Username header')
    p.add_argument('--out', required=False, help='Optional CSV path to write missing rows (DB but not Drive)')
    args = p.parse_args()

    headers = {}
    if args.admin_username:
        headers['X-Admin-Username'] = args.admin_username

    print("Fetching Drive PDF list (this may take a while for large folders)...")
    drive_items = fetch_all_drive_ids(args.base_url, args.folder_id, headers=headers)
    drive_id_set = set(item['id'] for item in drive_items if item.get('id'))
    print(f"Drive: found {len(drive_id_set)} PDF files in Drive folder {args.folder_id}")

    print("Fetching DB book list...")
    books = fetch_all_db_books(args.base_url, headers=headers)
    db_drive_map = { b['drive_id']: b for b in books if b.get('drive_id') }
    db_drive_set = set(db_drive_map.keys())
    print(f"DB: found {len(db_drive_set)} books with a drive_id")

    missing_in_drive = sorted(db_drive_set - drive_id_set)
    only_in_drive = sorted(drive_id_set - db_drive_set)

    print("=== Summary ===")
    print(f"Books in DB but NOT in Drive (missing/deleted): {len(missing_in_drive)}")
    print(f"Files in Drive but NOT in DB (new/untracked): {len(only_in_drive)}")
    print("")

    if missing_in_drive:
        print("Missing (DB -> Drive):")
        for did in missing_in_drive:
            info = db_drive_map.get(did, {})
            title = info.get('title') or '<no title>'
            print(f"- {did} | {title}")
    else:
        print("No DB books missing from Drive.")

    print("")
    if only_in_drive:
        print("Drive-only (Drive -> DB):")
        # Map drive ids to titles from drive_items
        drive_map = {d['id']: d for d in drive_items}
        for did in only_in_drive:
            info = drive_map.get(did, {})
            title = info.get('title') or '<no title>'
            print(f"- {did} | {title}")
    else:
        print("No Drive-only PDFs.")

    if args.out and missing_in_drive:
        with open(args.out, 'w', newline='', encoding='utf-8') as fh:
            writer = csv.writer(fh)
            writer.writerow(['drive_id', 'db_id', 'title', 'external_story_id', 'created_at', 'updated_at'])
            for did in missing_in_drive:
                info = db_drive_map.get(did, {})
                writer.writerow([did, info.get('db_id'), info.get('title'), info.get('external_story_id'), info.get('created_at'), info.get('updated_at')])
        print(f"Wrote missing list to {args.out}")

if __name__ == '__main__':
    main()