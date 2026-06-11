"""Google Sheets-backed queue consumer for Drive events.

This module polls a configured Google Sheets spreadsheet (sheet name: 'queue')
for rows with status 'pending' and forwards each row as a POST to the
internal `/api/drive-webhook` endpoint so existing Drive-processing logic
is reused. Designed to be enabled via `ENABLE_SHEETS_QUEUE` env var.

To use:
- Create a Zapier zap that appends rows to the sheet with columns:
  event_id,drive_id,event_type,metadata_json,timestamp,status
- Set `ENABLE_SHEETS_QUEUE=True` and `SHEETS_QUEUE_SPREADSHEET_ID` in .env
- Ensure service-account creds are available via the GOOGLE_* env vars
  already used by the Drive integration.
"""
from __future__ import annotations
import os
import json
import logging
import threading
import time
from datetime import datetime
from typing import Dict, Any

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build


DEFAULT_POLL_INTERVAL = int(os.getenv('SHEETS_QUEUE_POLL_SECONDS', '60'))


def start_sheets_queue_worker(service_account_info: Dict[str, Any], spreadsheet_id: str,
                              sheet_name: str = 'queue', poll_interval: int = DEFAULT_POLL_INTERVAL,
                              local_webhook_url: str | None = None):
    """Start a background thread that polls the spreadsheet and forwards rows.

    - service_account_info: dict constructed similarly to `service_account_info` in server.py
    - spreadsheet_id: ID of the Google Sheet to poll
    - sheet_name: name of the sheet tab that acts as the queue (default: 'queue')
    - poll_interval: seconds between polls
    - local_webhook_url: full URL to POST events to (defaults to http://localhost:5000/api/drive-webhook)
    """
    if not spreadsheet_id:
        logging.info('[SheetsQueue] No spreadsheet_id configured; not starting Sheets queue worker.')
        return
    if not service_account_info:
        logging.info('[SheetsQueue] No service account info provided; not starting Sheets queue worker.')
        return

    webhook_url = local_webhook_url or (os.getenv('LOCAL_INTERNAL_URL') or 'http://localhost:5000').rstrip('/') + '/api/drive-webhook'

    try:
        creds = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=['https://www.googleapis.com/auth/spreadsheets']
        )
        sheets_service = build('sheets', 'v4', credentials=creds)
    except Exception as e:
        logging.error(f"[SheetsQueue] Failed to create Sheets client: {e}")
        return

    stop_event = threading.Event()

    def poll_once():
        try:
            range_name = f"{sheet_name}!A2:F"
            logging.debug(f"[SheetsQueue] Reading range {range_name} from spreadsheet {spreadsheet_id}")
            result = sheets_service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_name).execute()
            values = result.get('values', [])
            if not values:
                logging.debug('[SheetsQueue] No rows found')
                return

            # rows: event_id, drive_id, event_type, metadata_json, timestamp, status
            for idx, row in enumerate(values, start=2):
                try:
                    cols = list(row) + [''] * (6 - len(row))
                    event_id, drive_id, event_type, metadata_json, ts, status = cols[:6]
                    status = (status or '').strip().lower()
                    if status != 'pending':
                        continue

                    payload = {
                        'event_id': event_id,
                        'drive_id': drive_id,
                        'event_type': event_type,
                        'metadata': json.loads(metadata_json) if metadata_json else {},
                        'timestamp': ts
                    }

                    logging.info(f"[SheetsQueue] Forwarding queued event {event_id} -> {webhook_url}")
                    try:
                        resp = requests.post(webhook_url, json=payload, timeout=15)
                        if resp.status_code == 200:
                            # mark row as done
                            update_range = f"{sheet_name}!F{idx}"
                            sheets_service.spreadsheets().values().update(
                                spreadsheetId=spreadsheet_id,
                                range=update_range,
                                valueInputOption='RAW',
                                body={'values': [['done']]}
                            ).execute()
                            logging.info(f"[SheetsQueue] Marked event {event_id} done (row {idx})")
                        else:
                            logging.warning(f"[SheetsQueue] Webhook POST failed for event {event_id}: {resp.status_code} {resp.text}")
                    except Exception as e:
                        logging.warning(f"[SheetsQueue] Exception posting event {event_id}: {e}")

                except Exception as e:
                    logging.exception(f"[SheetsQueue] Error processing row {idx}: {e}")

        except Exception as e:
            logging.exception(f"[SheetsQueue] Poll error: {e}")

    def worker():
        logging.info(f"[SheetsQueue] Started worker polling {spreadsheet_id} every {poll_interval}s -> {webhook_url}")
        while not stop_event.is_set():
            poll_once()
            # Sleep with early exit
            for _ in range(int(poll_interval)):
                if stop_event.is_set():
                    break
                time.sleep(1)
        logging.info('[SheetsQueue] Worker stopping')

    t = threading.Thread(target=worker, daemon=True, name='sheets-queue-worker')
    t.start()

    # Return a stopper function so the caller can shut it down in tests or on teardown
    def stop():
        stop_event.set()
        t.join(timeout=5)

    return stop
