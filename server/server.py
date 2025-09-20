# =========================
# 1. Imports
# =========================
# --- Standard Library Imports ---
import os
import io
import gc
import re
import uuid
import time
import json
import base64
import hashlib
import logging
import tempfile
import threading
import datetime
from collections import deque
import traceback
import concurrent.futures
import shutil
import random
import logging.handlers

# --- Third-Party Imports ---
import fitz  # PyMuPDF
import psutil
import requests
import tracemalloc
from PIL import Image
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from flask import (
    Flask, jsonify, send_file, redirect, send_from_directory,
    make_response, request, after_this_request
)
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS, cross_origin
from flask_mail import Mail, Message
from sqlalchemy import desc, func, text
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.oauth2 import service_account
import dateutil.parser

# --- Project Imports ---
try:
    # For production (when run as a package)
    from .drive_webhook import setup_drive_webhook
except ImportError:
    # For local testing (when run as a script)
    from drive_webhook import setup_drive_webhook

# =========================
# 2. Environment & App Setup
# =========================
# --- Load environment variables ---
load_dotenv()
# --- Flask app creation ---
app = Flask(__name__)
# --- CORS, SQLAlchemy, Mail, and other extension initializations ---
# --- App config variables (database URI, mail config, etc.) ---
app.config['SQLALCHEMY_DATABASE_URI'] = (
    f"postgresql://{os.getenv('DB_USER')}:{os.getenv('DB_PASSWORD')}"
    f"@{os.getenv('DB_HOST')}:{os.getenv('DB_PORT')}/{os.getenv('DB_NAME')}"
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER')
app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587))
app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'True') == 'True'
app.config['MAIL_USERNAME'] = os.getenv('MAIL_USERNAME')
app.config['MAIL_PASSWORD'] = os.getenv('MAIL_PASSWORD')
db = SQLAlchemy(app)
CORS(app, origins=[
    "http://localhost:5173",
    "http://localhost:5000",
    "https://storyweavechronicles.onrender.com",
    "https://swcflaskbackend.onrender.com"
], supports_credentials=True, allow_headers="*", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
mail = Mail(app)

service_account_info = {
    "type": "service_account",
    "project_id": os.getenv("GOOGLE_PROJECT_ID"),
    "private_key_id": os.getenv("GOOGLE_PRIVATE_KEY_ID"),
    "private_key": os.getenv("GOOGLE_PRIVATE_KEY").replace('\\n', '\n'),
    "client_email": os.getenv("GOOGLE_CLIENT_EMAIL"),
    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
    "auth_uri": os.getenv("GOOGLE_AUTH_URI"),
    "token_uri": os.getenv("GOOGLE_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("GOOGLE_AUTH_CERT_URI"),
    "client_x509_cert_url": os.getenv("GOOGLE_CLIENT_X509_CERT_URL"),
}

# =========================
# 3. Logging Setup
# =========================
# --- Logging formatter, file/console handlers, log file path ---

#logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

# Log to both console and logs.txt
LOG_FILE_PATH = os.path.join(os.path.dirname(__file__), 'logs.txt')
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
root_logger.addHandler(console_handler)

# File handler
file_handler = logging.handlers.RotatingFileHandler(LOG_FILE_PATH, maxBytes=5*1024*1024, backupCount=2, encoding='utf-8')
file_handler.setFormatter(log_formatter)
root_logger.addHandler(file_handler)
# --- uncomment logging and delete above variables when done ---

# =========================
# 4. Global Constants & Paths
# =========================
# --- Paths for covers, atlas, etc. ---
# --- Any global constants (e.g., MAX_COVERS) ---

# --- Cover Atlas Management ---
COVERS_DIR = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'covers')
ATLAS_PATH = os.path.join(COVERS_DIR, 'atlas.json')
MAX_COVERS = 30

# Google Drive API scope
SCOPES = [os.getenv('SCOPES', 'https://www.googleapis.com/auth/drive.readonly')]

# Credential storage
TOKEN_FILE = 'server/token.json'
# Session heartbeat tracking
session_last_seen = {}  # session_id: last_seen_timestamp
SESSION_TIMEOUT = 60  # seconds

cleanup_covers_lock = threading.Lock()  # Add this near your other locks

atlas_initialized = False

# --- Fair Queuing for Cover Requests ---
cover_request_queue = deque()  # Each entry: file_id (str)
cover_queue_lock = threading.Lock()

# --- Fair Queuing for Text Requests ---
text_request_queue = deque()  # Each entry: {session_id, file_id, page_num, timestamp}
text_queue_lock = threading.Lock()
text_queue_active = None  # Currently processing: {session_id, file_id, page_num, timestamp}
text_queue_last_cleanup = 0
# =========================
# 5. Database Models
# =========================
# --- SQLAlchemy models: Book, User, Vote, Comment, Webhook ---

# --- SQLAlchemy Book Model ---
class Book(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    drive_id = db.Column(db.String(128), unique=True, nullable=False)  # Google Drive file ID
    title = db.Column(db.String(256), nullable=False)
    external_story_id = db.Column(db.String(128), nullable=True)  # e.g. 'goodreads 2504839'
    version_history = db.Column(db.Text, nullable=True)  # JSON string of version info
    created_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC), onupdate=lambda: datetime.datetime.now(datetime.UTC))

    # Relationships
    comments = db.relationship('Comment', backref='book', lazy=True, foreign_keys='Comment.book_id')
    votes = db.relationship('Vote', backref='book', lazy=True, foreign_keys='Vote.book_id')

# --- SQLAlchemy User Model ---
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=False, nullable=True)
    password = db.Column(db.String(120), nullable=True)
    bookmarks = db.Column(db.Text, nullable=True)  # JSON string
    secondary_emails = db.Column(db.Text, nullable=True)  # JSON string
    background_color = db.Column(db.String(16), nullable=True)
    text_color = db.Column(db.String(16), nullable=True)
    font = db.Column(db.String(64), nullable=True)
    timezone = db.Column(db.String(64), nullable=True)
    notification_prefs = db.Column(db.Text, nullable=True)  # JSON string
    notification_history = db.Column(db.Text, nullable=True)  # JSON string
    comments_page_size = db.Column(db.Integer, default=10)  # per-user comments page size
    is_admin = db.Column(db.Boolean, default=False)  # admin privileges
    banned = db.Column(db.Boolean, default=False)  # user ban status

# --- SQLAlchemy Voting Model ---
class Vote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    book_id = db.Column(db.String(128), db.ForeignKey('book.drive_id'), nullable=False)
    value = db.Column(db.Integer, nullable=False)  # 1-5 stars
    timestamp = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

# --- SQLAlchemy Comment Model ---
class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    book_id = db.Column(db.String(128), db.ForeignKey('book.drive_id'), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    parent_id = db.Column(db.Integer, nullable=True)  # null for top-level
    text = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))
    edited = db.Column(db.Boolean, default=False)
    upvotes = db.Column(db.Integer, default=0)
    downvotes = db.Column(db.Integer, default=0)
    deleted = db.Column(db.Boolean, default=False)  # for moderation
    background_color = db.Column(db.String(16), nullable=True)
    text_color = db.Column(db.String(16), nullable=True)

# --- SQLAlchemy Webhook Model ---
class Webhook(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.String(128), unique=True, nullable=False)
    expiration = db.Column(db.BigInteger, nullable=True)  # ms since epoch
    registered_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

# =========================
# 6. Initialization Code
# =========================
# --- Table creation, service account info dict, other global initializations ---
# Create tables if not exist
with app.app_context():
    db.create_all()

tracemalloc.start()

# =========================
# 7. Utility Functions
# =========================
# --- Atlas & Cover Management ---
def get_cover_url(file_id):
    """
    Returns the public URL for a cover image, using FRONTEND_BASE_URL from .env.
    """
    base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5173')
    return f"{base_url}/covers/{file_id}.jpg"

def load_atlas():
    if not os.path.exists(ATLAS_PATH):
        return {}
    for attempt in range(3):
        try:
            with open(ATLAS_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('covers', {})
        except Exception as e:
            logging.error(f"[Atlas] Failed to load atlas.json (attempt {attempt+1}): {e}")
            time.sleep(0.05)
    return {}

def save_atlas(covers_map):
    try:
        # Write to a temp file first, then atomically replace atlas.json
        dir_name = os.path.dirname(ATLAS_PATH)
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=dir_name, delete=False) as tf:
            json.dump({'covers': covers_map}, tf, indent=2)
            tempname = tf.name
        shutil.move(tempname, ATLAS_PATH)
        logging.info(f"[Atlas][save] Atlas saved with {len(covers_map)} entries: {list(covers_map.keys())}")
    except Exception as e:
        logging.error(f"[Atlas] Failed to save atlas.json: {e}")

def cleanup_unused_covers(valid_ids, needed_ids):
    covers_map = load_atlas()
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [cleanup_unused_covers] Covers folder BEFORE: {covers_dir_files}")
    # Build set of actual cover IDs on disk
    disk_cover_ids = set()
    for fname in covers_dir_files:
        if fname.endswith('.jpg'):
            disk_cover_ids.add(fname[:-4])
    logging.info(f"[Atlas][cleanup_unused_covers] Disk cover IDs: {disk_cover_ids}")
    if not cleanup_covers_lock.acquire(blocking=False):
        logging.warning("[Atlas][cleanup_unused_covers] Cleanup already running, skipping duplicate call.")
        return []
    try:
        removed = []
        valid_ids = set(str(i).strip() for i in valid_ids) if valid_ids else set()
        needed_ids = set(str(i).strip() for i in needed_ids) if needed_ids else set()
        logging.info(f"[Atlas][cleanup_unused_covers] Incoming valid_ids: {valid_ids}")
        logging.info(f"[Atlas][cleanup_unused_covers] Incoming needed_ids: {needed_ids}")
        # Only remove covers that are not needed
        to_remove = disk_cover_ids - needed_ids
        logging.info(f"[Atlas][cleanup_unused_covers] Covers to remove (not needed): {to_remove}")
        for book_id in to_remove:
            cover_path = os.path.join(COVERS_DIR, f"{book_id}.jpg")
            try:
                logging.info(f"[DIAGNOSTIC][DELETE] Attempting to delete cover file: {cover_path} (book_id={book_id})")
                if os.path.exists(cover_path):
                    os.remove(cover_path)
                    removed.append(book_id)
                    logging.info(f"[DIAGNOSTIC][DELETE] Deleted unused cover: {cover_path}")
                else:
                    logging.warning(f"[DIAGNOSTIC][DELETE] Tried to delete missing cover file: {cover_path}")
            except Exception as e:
                logging.error(f"[DIAGNOSTIC][DELETE] Error deleting cover file {cover_path}: {e}")
        # Update atlas: keep only valid and needed covers
        covers_map = {bid: fname for bid, fname in covers_map.items() if bid in valid_ids and bid in needed_ids}
        save_atlas(covers_map)
        covers_dir_files_after = os.listdir(COVERS_DIR)
        logging.info(f"[DIAGNOSTIC][COVERS] [cleanup_unused_covers] Covers folder AFTER: {covers_dir_files_after}")
        logging.info(f"[Atlas][cleanup_unused_covers] Final covers_map after deletion: {covers_map}")
        logging.info(f"[Atlas] Cleaned up unused covers: {removed}")
    finally:
        cleanup_covers_lock.release()
    
def get_landing_page_book_ids():
    """
    Return a list of book IDs for the landing page (carousel + top voted).
    """
    # Top 20 newest (by created_at)
    newest_books = Book.query.order_by(desc(Book.created_at)).limit(20).all()
    newest_ids = [b.drive_id for b in newest_books if b.drive_id]

    # Top 10 voted (by total votes)
    voted_books = (
        Book.query
        .outerjoin(Vote, Book.drive_id == Vote.book_id)
        .group_by(
            Book.id,
            Book.drive_id,
            Book.title,
            Book.external_story_id,
            Book.version_history,
            Book.created_at,
            Book.updated_at
        )
        .order_by(func.count(Vote.id).desc())
        .limit(10)
        .all()
    )
    voted_ids = [b.drive_id for b in voted_books if b.drive_id]

    # Combine and deduplicate, preserve order: newest first, then voted
    combined_ids = []
    seen = set()
    for id_ in newest_ids + voted_ids:
        if id_ and id_ not in seen:
            combined_ids.append(id_)
            seen.add(id_)
    return combined_ids[:MAX_COVERS]

def extract_cover_image_from_pdf(book_id):
    """
    Extract cover image for a given book_id from its PDF in Google Drive.
    Returns PIL Image or None.
    Ensures image is not closed/deleted before caller saves/maps it.
    """
    import gc
    import psutil
    import tracemalloc

    process = psutil.Process()
    MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
    MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))

    for _ in range(3):
        gc.collect()
    mem_start = process.memory_info().rss / (1024 * 1024)
    cpu_start = process.cpu_percent(interval=0.1)
    logging.info(f"[extract_cover_image_from_pdf] GC BEFORE: book_id={book_id}, RAM={mem_start:.2f} MB, CPU={cpu_start:.2f}%")

    img = None
    doc = None
    page = None
    pix = None
    try:
        service = get_drive_service()
        book = Book.query.filter_by(drive_id=book_id).first()
        if not book:
            logging.warning(f"[extract_cover_image_from_pdf] Book not found: {book_id}")
            mem_none = process.memory_info().rss / (1024 * 1024)
            cpu_none = process.cpu_percent(interval=0.1)
            logging.info(f"[extract_cover_image_from_pdf] NO BOOK: book_id={book_id}, RAM={mem_none:.2f} MB, CPU={cpu_none:.2f}%")
            for _ in range(3):
                gc.collect()
            return None

        request_drive = service.files().get_media(fileId=book.drive_id)
        pdf_bytes = request_drive.execute()
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        page = doc.load_page(0)

        # Preferred: render first page as image
        try:
            pix = page.get_pixmap(matrix=fitz.Matrix(1, 1))
            img_bytes = pix.tobytes()
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            img.thumbnail((80, 120))
            mem_page = process.memory_info().rss / (1024 * 1024)
            cpu_page = process.cpu_percent(interval=0.1)
            logging.info(f"[extract_cover_image_from_pdf] PAGE IMAGE: book_id={book_id}, RAM={mem_page:.2f} MB, CPU={cpu_page:.2f}%")
            if mem_page > MEMORY_LOW_THRESHOLD_MB:
                logging.warning(f"[extract_cover_image_from_pdf] WARNING: RAM {mem_page:.2f} MB exceeds LOW threshold {MEMORY_LOW_THRESHOLD_MB} MB!")
            if mem_page > MEMORY_HIGH_THRESHOLD_MB:
                logging.error(f"[extract_cover_image_from_pdf] ERROR: RAM {mem_page:.2f} MB exceeds HIGH threshold {MEMORY_HIGH_THRESHOLD_MB} MB!")
            logging.info(f"[extract_cover_image_from_pdf] Extraction succeeded for book_id={book_id}")
            # Do NOT cleanup img here; caller will save and close it!
            # Clean up other objects
            if pix is not None and hasattr(pix, 'close'):
                pix.close()
            if page is not None and hasattr(page, 'close'):
                page.close()
            if doc is not None and hasattr(doc, 'close'):
                doc.close()
            for _ in range(3):
                gc.collect()
            return img
        except Exception as e:
            logging.error(f"[extract_cover_image_from_pdf] Page render failed for {book_id}: {e}")

        # Fallback: try to extract first embedded image
        images = page.get_images(full=True)
        if images:
            xref = images[0][0]
            try:
                pix = fitz.Pixmap(doc, xref)
                img_bytes = pix.tobytes("ppm")
                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
                img.thumbnail((80, 120))
                mem_img = process.memory_info().rss / (1024 * 1024)
                cpu_img = process.cpu_percent(interval=0.1)
                logging.info(f"[extract_cover_image_from_pdf] FALLBACK EMBEDDED IMAGE: book_id={book_id}, RAM={mem_img:.2f} MB, CPU={cpu_img:.2f}%")
                if mem_img > MEMORY_LOW_THRESHOLD_MB:
                    logging.warning(f"[extract_cover_image_from_pdf] WARNING: RAM {mem_img:.2f} MB exceeds LOW threshold {MEMORY_LOW_THRESHOLD_MB} MB!")
                if mem_img > MEMORY_HIGH_THRESHOLD_MB:
                    logging.error(f"[extract_cover_image_from_pdf] ERROR: RAM {mem_img:.2f} MB exceeds HIGH threshold {MEMORY_HIGH_THRESHOLD_MB} MB!")
                logging.info(f"[extract_cover_image_from_pdf] Fallback extraction succeeded for book_id={book_id}")
                # Do NOT cleanup img here; caller will save and close it!
                # Clean up other objects
                if pix is not None and hasattr(pix, 'close'):
                    pix.close()
                if page is not None and hasattr(page, 'close'):
                    page.close()
                if doc is not None and hasattr(doc, 'close'):
                    doc.close()
                for _ in range(3):
                    gc.collect()
                return img
            except Exception as e:
                logging.error(f"[extract_cover_image_from_pdf] Embedded image extraction failed for {book_id}: {e}")

        logging.info(f"[extract_cover_image_from_pdf] Extraction failed for book_id={book_id}")
        # Clean up objects
        if pix is not None and hasattr(pix, 'close'):
            pix.close()
        if page is not None and hasattr(page, 'close'):
            page.close()
        if doc is not None and hasattr(doc, 'close'):
            doc.close()
        for _ in range(3):
            gc.collect()
        return None

    except Exception as e:
        logging.error(f"[extract_cover_image_from_pdf] Failed for {book_id}: {e}")
        mem_err = process.memory_info().rss / (1024 * 1024)
        cpu_err = process.cpu_percent(interval=0.1)
        logging.info(f"[extract_cover_image_from_pdf] ERROR: book_id={book_id}, RAM={mem_err:.2f} MB, CPU={cpu_err:.2f}%")
        if 'tracemalloc' in globals() and hasattr(tracemalloc, 'is_tracing') and tracemalloc.is_tracing():
            logging.info(tracemalloc.take_snapshot().statistics('filename'))
        else:
            logging.info("[extract_cover_image_from_pdf] tracemalloc is not tracing; skipping snapshot.")
        # Clean up objects
        if pix is not None and hasattr(pix, 'close'):
            pix.close()
        if page is not None and hasattr(page, 'close'):
            page.close()
        if doc is not None and hasattr(doc, 'close'):
            doc.close()
        for _ in range(3):
            gc.collect()
        return None
    finally:
        for _ in range(3):
            gc.collect()
        mem_final = process.memory_info().rss / (1024 * 1024)
        logging.info(f"[extract_cover_image_from_pdf] FINAL GC: book_id={book_id}, RAM={mem_final:.2f} MB")
        
def rebuild_cover_cache(book_ids=None):
    """
    Rebuild atlas and cache covers for provided book_ids (landing page), or fallback to DB if not provided.
    """
    if book_ids is None:
        book_ids = get_landing_page_book_ids()
        logging.info(f"[Atlas][rebuild_cover_cache] Starting rebuild for book_ids: {book_ids}")
    covers_map_before = load_atlas()
    covers_dir_files_before = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder BEFORE: {covers_dir_files_before}")
    logging.info(f"[Atlas][rebuild_cover_cache] covers_map BEFORE cleanup: {covers_map_before}")
    # Validate covers before cleanup
    valid_ids = set()
    for book_id in book_ids:
        filename = f"{book_id}.jpg"
        cover_path = os.path.join(COVERS_DIR, filename)
        logging.info(f"[Atlas][validate] Checking cover for {book_id}: {filename} (path: {cover_path})")
        if os.path.exists(cover_path):
            try:
                with Image.open(cover_path) as img:
                    img.verify()
                logging.info(f"[Atlas][validate] PIL verify succeeded for {book_id}: {filename} (path: {cover_path})")
            except Exception as e:
                logging.warning(f"[Atlas][validate] PIL verify failed for {book_id}: {filename} (path: {cover_path}) ({e})")
                logging.info(f"[Atlas][validate] {book_id}: File exists, but PIL verify failed. Still marking as valid.")
            valid_ids.add(book_id)
            logging.info(f"[Atlas][validate][final] {book_id}: Marked as valid (file exists at {cover_path})")
        else:
            logging.warning(f"[Atlas][validate] Cover missing for {book_id}: {filename} (path: {cover_path})")
            logging.error(f"[Atlas][validate][reason] {book_id}: File does not exist at path {cover_path}")
            logging.info(f"[Atlas][validate][final] {book_id}: Marked as invalid or missing.")
    # Safety: Only delete covers not in needed book_ids, and only if enough valid covers
    needed_ids = set(str(i).strip() for i in book_ids)
    valid_needed = valid_ids & needed_ids
    valid_ratio = len(valid_needed) / max(1, len(needed_ids))
    logging.info(f"[Atlas][rebuild_cover_cache] valid_needed={valid_needed}, valid_ratio={valid_ratio:.2f}")
    # Minimum book_ids check: skip deletion if too few
    if len(book_ids) < 20:
        logging.warning(f"[Atlas][rebuild_cover_cache] Skipping deletion: received only {len(book_ids)} book_ids (minimum required: 20). Possible partial/empty POST. Waiting for next request.")
    else:
        cleanup_unused_covers(valid_needed, needed_ids)
    covers_map_after_cleanup = load_atlas()
    covers_dir_files_after_cleanup = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder AFTER cleanup: {covers_dir_files_after_cleanup}")
    logging.info(f"[Atlas][rebuild_cover_cache] covers_map AFTER cleanup: {covers_map_after_cleanup}")
    # Now process missing/invalid covers
    missing = []
    for book_id in book_ids:
        logging.info(f"[Atlas][rebuild_cover_cache] Processing cover for book_id: {book_id}")
        filename = f"{book_id}.jpg"
        cover_path = os.path.join(COVERS_DIR, filename)
        logging.info(f"[Atlas][validate] Checking cover for {book_id}: {filename} (path: {cover_path})")
        if os.path.exists(cover_path):
            # Always mark as valid if file exists, regardless of PIL verification errors
            try:
                with Image.open(cover_path) as img:
                    img.verify()
                logging.info(f"[Atlas][validate] PIL verify succeeded for {book_id}: {filename} (path: {cover_path})")
            except Exception as e:
                logging.warning(f"[Atlas][validate] PIL verify failed for {book_id}: {filename} (path: {cover_path}) ({e})")
                logging.info(f"[Atlas][validate] {book_id}: File exists, but PIL verify failed. Still marking as valid.")
            logging.info(f"[Atlas][rebuild_cover_cache] Cover for {book_id} is valid and present (file exists at {cover_path}).")
            logging.info(f"[Atlas][validate][final] {book_id}: Marked as valid.")
        else:
            # Do NOT extract cover here; leave for frontend to request /pdf-cover
            logging.info(f"[Atlas][rebuild_cover_cache] Cover for {book_id} missing or invalid; skipping extraction (frontend will request /pdf-cover)")
            missing.append(book_id)
            logging.warning(f"[Atlas][validate] Cover missing for {book_id}: {filename} (path: {cover_path})")
            logging.error(f"[Atlas][validate][reason] {book_id}: File does not exist at path {cover_path}")
            logging.info(f"[Atlas][validate][final] {book_id}: Marked as invalid or missing.")
    covers_map_final = load_atlas()
    covers_dir_files_final = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder FINAL: {covers_dir_files_final}")
    logging.info(f"[Atlas][rebuild_cover_cache] covers_map FINAL: {covers_map_final}")
    logging.info(f"[Atlas][rebuild_cover_cache] Covers in cache after rebuild: {list(covers_map_final.keys())}")
    logging.info(f"[Atlas][rebuild_cover_cache] Rebuilt cover cache for {len(book_ids)} books.")

    # Enforce cache size limit
    covers_map = load_atlas()
    if len(covers_map) > MAX_COVERS:
        cover_files = [(bid, os.path.join(COVERS_DIR, fname)) for bid, fname in covers_map.items()]
        cover_files = [(bid, fname, os.path.getmtime(fname)) for bid, fname in cover_files if os.path.exists(fname)]
        cover_files.sort(key=lambda x: x[2])
        to_remove = cover_files[:-MAX_COVERS]
        for bid, fname, _ in to_remove:
            try:
                logging.info(f"[DIAGNOSTIC][DELETE] Attempting to delete cover file (cache limit): {fname} (book_id={bid})")
                if os.path.exists(fname):
                    os.remove(fname)
                    logging.info(f"[DIAGNOSTIC][DELETE] Deleted cover file (cache size limit): {fname}")
                else:
                    logging.warning(f"[DIAGNOSTIC][DELETE] Tried to delete missing cover file (cache size limit): {fname}")
            except Exception as e:
                logging.error(f"[DIAGNOSTIC][DELETE] Error deleting cover file (cache size limit) {fname}: {e}")
        # Remove from atlas
        covers_map = {bid: fname for bid, fname in covers_map.items() if bid not in [x[0] for x in to_remove]}
        save_atlas(covers_map)
        covers_dir_files_after_limit = os.listdir(COVERS_DIR)
        logging.info(f"[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder AFTER cache size limit: {covers_dir_files_after_limit}")

    # Return tuple: (success, missing_ids)
    if missing:
        logging.error(f"[Atlas][rebuild_cover_cache] Missing covers after rebuild: {missing}")
        return False, missing
    return True, []

def sync_atlas_with_covers():
    """
    Scan the covers folder and rebuild atlas.json to match the actual .jpg files on disk.
    """
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [sync_atlas_with_covers] Covers folder BEFORE: {covers_dir_files}")
    disk_covers = {fname.replace('.jpg', ''): fname for fname in covers_dir_files if fname.endswith('.jpg')}
    atlas = load_atlas()
    # Merge: keep atlas entries only for covers present on disk, add new disk covers
    merged = {}
    # Add/keep covers present on disk
    for book_id, fname in disk_covers.items():
        merged[book_id] = fname
    # Optionally, preserve extra atlas metadata (if any) for covers still present
    # Remove atlas entries for covers missing from disk
    save_atlas(merged)
    covers_dir_files_after = os.listdir(COVERS_DIR)
    logging.info(f"[DIAGNOSTIC][COVERS] [sync_atlas_with_covers] Covers folder AFTER: {covers_dir_files_after}")
    logging.info(f"[Atlas][sync] Additive sync: merged atlas.json with {len(merged)} covers from disk.")
    logging.info(f"[Atlas][sync] Disk covers: {list(disk_covers.keys())}")
    logging.info(f"[Atlas][sync] Atlas covers: {list(atlas.keys())}")
    logging.info(f"[Atlas][sync] Merged atlas: {list(merged.keys())}")
    return merged

#--- PDF/Image Utilities ---

def extract_story_id_from_pdf(file_content):
    """
    Given a PDF file (as bytes or BytesIO), extract the bottom-most line of text from page 1.
    Returns the story ID string, or None if not found.
    """
    doc = fitz.open(stream=file_content, filetype="pdf")
    page = doc.load_page(0)
    blocks = page.get_text("blocks")  # (x0, y0, x1, y1, text, block_no, block_type)
    # Filter out blocks with no text
    text_blocks = [b for b in blocks if b[4] and b[4].strip()]
    if not text_blocks:
        return None
    # Regex: site name, optional colon, separator (space, dash, underscore), then number (at least 4 digits)
    pattern = re.compile(r'\b([a-zA-Z0-9_]+):?[\s\-_](\d{4,})\b')
    for block in text_blocks:
        text = block[4].strip()
        match = pattern.search(text)
        if match:
            # Return the full matched string (site + separator + id)
            return match.group(0)
    return None

def downscale_image(img_bytes, size=(80, 120), format="JPEG", quality=70):
    """
    Downscale and compress image bytes.
    Returns BytesIO of the downscaled image.
    """
    img = Image.open(io.BytesIO(img_bytes))
    img = img.convert("RGB")
    img.thumbnail(size)
    out = io.BytesIO()
    img.save(out, format=format, quality=quality)
    out.seek(0)
    return out

#--- Queue Management ---

def cleanup_text_queue():
    try:
        now = time.time()
        to_remove = set()
        for entry in list(text_request_queue):
            sid = entry['session_id']
            if sid not in session_last_seen or now - session_last_seen[sid] > SESSION_TIMEOUT:
                to_remove.add(sid)
        before_len = len(text_request_queue)
        filtered = [e for e in text_request_queue if e['session_id'] not in to_remove]
        text_request_queue.clear()
        text_request_queue.extend(filtered)
        global text_queue_active
        if text_queue_active and text_queue_active['session_id'] in to_remove:
            text_queue_active = None
        # Only log if something was removed
        if to_remove:
            logging.info(f"[cleanup_text_queue] Removed {len(to_remove)} stale sessions from queue.")
    except Exception as e:
        logging.error(f"[cleanup_text_queue] Error: {e}")

def get_text_queue_status():
    acquired = text_queue_lock.acquire(timeout=5)
    if not acquired:
        logging.error("[get_text_queue_status] Could not acquire text_queue_lock after 5 seconds! Possible deadlock.")
        return {
            'active': None,
            'queue': [],
            'queue_length': 0,
            'sessions': []
        }
    try:
        return {
            'active': text_queue_active,
            'queue': list(text_request_queue),
            'queue_length': len(text_request_queue),
            'sessions': list(session_last_seen.keys()),
        }
    finally:
        text_queue_lock.release()

def heartbeat(session_id):
    """Update the last seen timestamp for a session. Used to track active sessions and clean up timed-out requests."""
    session_last_seen[session_id] = time.time()

def cleanup_cover_queue():
    with cover_queue_lock:
        cover_request_queue.clear()
    logging.info("[cleanup_cover_queue] Cover queue cleared.")

def get_queue_status():
    with cover_queue_lock:
        return {
            'active': cover_request_queue[0] if cover_request_queue else None,
            'queue': list(cover_request_queue),
            'queue_length': len(cover_request_queue)
        }

#--- Notification & Email ---

def send_notification_email(user, subject, body):
    if not user.email:
        logging.warning(f"User {user.id} has no email address. Skipping email send.")
        return False
    msg = Message(subject, sender=app.config['MAIL_USERNAME'], recipients=[user.email])
    msg.body = body
    try:
        mail.send(msg)
        logging.info(f"Sent email to {user.email} with subject '{subject}'")
        return True
    except Exception as e:
        logging.error(f"Failed to send email to {user.email}: {e}")
        return False
    
def send_scheduled_emails(subject, body, frequency='daily', batch_size=20, sleep_time=2):
    """
    Send scheduled emails to users in batches to minimize RAM usage.
    """
    with app.app_context():
        users = User.query.filter_by(banned=False).all()
        total = len(users)
        logging.info(f"Starting scheduled email rollout: {total} users, batch_size={batch_size}, sleep_time={sleep_time}s")
        for i in range(0, total, batch_size):
            batch = users[i:i+batch_size]
            for user in batch:
                # You can add per-user frequency/prefs check here
                send_notification_email(user, subject, body)
            logging.info(f"Sent batch {i//batch_size+1} ({i+1}-{min(i+batch_size,total)})")
            time.sleep(sleep_time)
        logging.info("Scheduled email rollout complete.")

def add_notification(user, type_, title, body, link=None):
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    history = json.loads(user.notification_history) if user.notification_history else []
    timestamp = int(datetime.datetime.now(datetime.UTC).timestamp() * 1000)
    notification = {
        'id': str(uuid.uuid4()),  # Always use a UUID for uniqueness
        'type': type_,
        'title': title,
        'body': body,
        'timestamp': timestamp,
        'read': False,
        'dismissed': False,
        'link': link
    }
    # Prevent duplicates: check for same type, title, body, and link in history
    if not any(
            n.get('type') == notification['type'] and
            n.get('title') == notification['title'] and
            n.get('body') == notification['body'] and
            n.get('link') == notification['link']
            for n in history
        ):
            history.append(notification)
            user.notification_history = json.dumps(history)
            db.session.commit()
            prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
            if prefs.get('emailFrequency', 'immediate') == 'immediate':
                send_notification_email(user, title, body)

def call_seed_drive_books():
    try:
        url = os.getenv('VITE_HOST_URL', 'http://localhost:5000') + '/api/seed-drive-books'
        response = requests.post(url)
        logging.info(f"Scheduled seed-drive-books response: {response.status_code} {response.text}")
    except Exception as e:
        logging.error(f"Error calling seed-drive-books endpoint: {e}")

# Start APScheduler for email notifications
def send_scheduled_emails(frequency):
        with app.app_context():
            users = User.query.all()
            for user in users:
                prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
                if prefs.get('emailFrequency', 'immediate') == frequency and user.email:
                    history = json.loads(user.notification_history) if user.notification_history else []
                    # Only send unread notifications for this period
                    unread = [n for n in history if not n.get('read')]
                    if unread:
                        subject = f"Your {frequency.capitalize()} Notification Summary"
                        body_lines = [
                            f"Hi {user.username or user.email},",
                            "",
                            f"Here are your recent notifications ({frequency}):",
                            ""
                        ]
                        for n in unread:
                            line = f"- [{n.get('type', 'Notification')}] {n.get('title', '')}: {n.get('body', '')}"
                            if n.get('timestamp'):
                                try:
                                    ts_val = n.get('timestamp')
                                    ts_str = datetime.datetime.fromtimestamp(ts_val / 1000).strftime('%Y-%m-%d %H:%M')
                                    line += f" (at {ts_str})"
                                except Exception:
                                    line += f" (at {n['timestamp']})"
                            if n.get('link'):
                                line += f" [View]({n['link']})"
                            body_lines.append(line)
                        body_lines.append("")
                        body_lines.append("Thank you for being part of StoryWeave Chronicles!")
                        body = "\n".join(body_lines)
                        send_notification_email(user, subject, body)
                        logging.info(f"Sent {len(unread)} notifications to {user.email} for {frequency} summary.")
                        # Optionally mark as read after sending
                        for n in history:
                            if not n.get('read'):
                                n['read'] = True
                        user.notification_history = json.dumps(history)
                        db.session.commit()

# --- Scheduled Job: Check for New Books and Notify Users ---
def check_and_notify_new_books():
    with app.app_context():
        try:
            # Set your Google Drive folder ID here (or load from env)
            folder_id = os.getenv('DRIVE_BOOKS_FOLDER_ID')
            if not folder_id:
                logging.warning('No DRIVE_BOOKS_FOLDER_ID set in environment.')
                return
            service = get_drive_service()
            query = f"'{folder_id}' in parents and mimeType='application/pdf'"
            results = service.files().list(q=query, fields="files(id, name, createdTime)").execute()
            files = results.get('files', [])
            known_ids = set(b.drive_id for b in Book.query.all())
            new_files = [f for f in files if f['id'] not in known_ids]
            logging.info(f"Scheduled check: {len(new_files)} new PDFs detected.")
            for f in new_files:
                # Download PDF to extract external_story_id
                try:
                    request = service.files().get_media(fileId=f['id'])
                    file_content = io.BytesIO(request.execute())
                    story_id = extract_story_id_from_pdf(file_content)
                except Exception:
                    story_id = None
                # Truncate external_story_id if too long
                if story_id and isinstance(story_id, str) and len(story_id) > 128:
                    story_id = ""
                # Add to DB
                try:
                    book = Book(
                        drive_id=f['id'],
                        title=f.get('name', 'Untitled'),
                        external_story_id=story_id,
                        version_history=json.dumps([{'created': f.get('createdTime')}])
                    )
                    db.session.add(book)
                    db.session.commit()
                except Exception as db_exc:
                    if "value too long for type character varying(128)" in str(db_exc):
                        book = Book(
                            drive_id=f['id'],
                            title=f.get('name', 'Untitled'),
                            external_story_id="",
                            version_history=json.dumps([{'created': f.get('createdTime')}])
                        )
                        db.session.add(book)
                        db.session.commit()
                    else:
                        logging.error(f"DB error adding new book: {db_exc}")
                        continue
                # Send notification to all users
                users = User.query.all()
                for user in users:
                    prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
                    if not prefs.get('muteAll', False) and prefs.get('newBooks', True):
                        body = f'A new book "{book.title}" is now available in the library.'
                        if book.external_story_id:
                            body += f' External ID: {book.external_story_id}'
                        add_notification(user, 'newBook', 'New Book Added!', body, link=f'/read/{book.drive_id}')
                logging.info(f"Notified users of new book: {book.title} ({book.drive_id})")
        except Exception as e:
            logging.error(f"Error in scheduled new book check: {e}")

#--- Drive/Google API ---

def get_drive_service():
    creds = None
    # Build credentials from .env
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    client_secret = os.getenv('GOOGLE_CLIENT_SECRET')
    token_uri = os.getenv('GOOGLE_TOKEN_URI')
    auth_uri = os.getenv('GOOGLE_AUTH_URI')
    auth_provider_x509_cert_url = os.getenv('GOOGLE_AUTH_CERT_URI')
    redirect_uris = [os.getenv('GOOGLE_REDIRECT_URI')]
    # Load token from file as before
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        creds = service_account.Credentials.from_service_account_info(
            service_account_info,
            scopes=SCOPES
        )
    return build('drive', 'v3', credentials=creds)

def setup_drive_webhook(folder_id, webhook_url):
    with app.app_context():
        webhook = Webhook.query.first()
        now_ms = int(datetime.datetime.now(datetime.UTC).timestamp() * 1000)
        # Only register if missing or expired
        if not webhook or not webhook.expiration or webhook.expiration < now_ms:
            channel_id = webhook.channel_id if webhook else 'storyweave-drive-channel'
            creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
            service = build('drive', 'v3', credentials=creds)
            body = {
                'id': channel_id,
                'type': 'web_hook',
                'address': webhook_url,
            }
            try:
                response = service.files().watch(fileId=folder_id, body=body).execute()
                expiration = int(response.get('expiration', now_ms + 24*60*60*1000))
                if webhook:
                    webhook.expiration = expiration
                    webhook.registered_at = datetime.datetime.now(datetime.UTC)
                else:
                    webhook = Webhook(channel_id=channel_id, expiration=expiration)
                    db.session.add(webhook)
                db.session.commit()
                logging.info(f"Webhook registered: {response}")
            except Exception as e:
                logging.error(f"Failed to register Google Drive webhook: {e}")
        else:
            logging.info(f"Existing webhook is still valid (expires at {webhook.expiration})")

#--- Admin/Memory ---

def cleanup_locals(locals_dict):
    # Helper to close/delete large objects
    for varname in ['doc', 'img_bytes', 'out', 'pix', 'page']:
        obj = locals_dict.get(varname)
        if obj is not None:
            try:
                if hasattr(obj, 'close'):
                    # Avoid double-closing file-like objects
                    if hasattr(obj, 'closed') and obj.closed:
                        logging.info(f"[cleanup_locals] Object already closed: {varname}")
                    else:
                        obj.close()
                        logging.info(f"[cleanup_locals] Closed object: {varname}")
            except Exception as e:
                logging.warning(f"[cleanup_locals] Error closing {varname}: {e}")
            try:
                del obj
                logging.info(f"[cleanup_locals] Deleted object: {varname}")
            except Exception as e:
                logging.warning(f"[cleanup_locals] Error deleting {varname}: {e}")
    # PIL image cleanup (if any)
    img = locals_dict.get('img')
    if img is not None:
        try:
            img.close()
            logging.info("[cleanup_locals] Closed PIL image: img")
        except Exception as e:
            logging.warning(f"[cleanup_locals] Error closing img: {e}")
        try:
            del img
            logging.info("[cleanup_locals] Deleted PIL image: img")
        except Exception as e:
            logging.warning(f"[cleanup_locals] Error deleting img: {e}")
    # Aggressive GC
    for _ in range(3):
        gc.collect()
    logging.info("[cleanup_locals] Finished cleanup and GC.")

def is_admin(username):
    user = User.query.filter_by(username=username).first()
    return user and user.is_admin

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

# =========================
# 8. App Hooks
# =========================
# --- @app.before_request hooks ---
@app.before_request
def check_atlas_init():
    global atlas_initialized
    if not atlas_initialized and request.path.startswith('/api/'):
        try:
            sync_atlas_with_covers()
            rebuild_cover_cache()
            atlas_initialized = True
        except Exception as e:
            logging.error(f"[Atlas] Error during first-load rebuild: {e}")

#--- apis ---

# === Authentication & User Management ===
# Update font and timezone for user
@app.route('/api/update-profile-settings', methods=['POST'])
def update_profile_settings():
    data = request.get_json()
    username = data.get('username')
    font = data.get('font')
    timezone = data.get('timezone')
    comments_page_size = data.get('comments_page_size')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if font is not None:
        user.font = font
    if timezone is not None:
        user.timezone = timezone
    if comments_page_size is not None:
        try:
            val = int(comments_page_size)
            if 1 <= val <= 20:
                user.comments_page_size = val
        except Exception:
            pass
    db.session.commit()
    return jsonify({'success': True, 'message': 'Profile settings updated.', 'font': user.font, 'timezone': user.timezone, 'comments_page_size': user.comments_page_size})

@app.route('/api/update-colors', methods=['POST'])
def update_colors():
    data = request.get_json(force=True)
    username = data.get('username')
    background_color = data.get('backgroundColor')
    text_color = data.get('textColor')
    # Validate required fields
    if not username or not background_color or not text_color:
        return jsonify({'success': False, 'message': 'Missing required fields.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    try:
        user.background_color = background_color
        user.text_color = text_color
        db.session.commit()
        # Efficiently update all comments by this user
        comments = Comment.query.filter_by(username=username).all()
        for comment in comments:
            comment.background_color = background_color
            comment.text_color = text_color
        db.session.commit()
        # Return all user fields needed for frontend sync
        return jsonify({
            'success': True,
            'message': 'Colors updated.',
            'backgroundColor': user.background_color,
            'textColor': user.text_color,
            'username': user.username,
            'email': user.email,
            'font': getattr(user, 'font', None),
            'timezone': getattr(user, 'timezone', None),
            'is_admin': getattr(user, 'is_admin', False),
            'bookmarks': getattr(user, 'bookmarks', []),
            'secondaryEmails': getattr(user, 'secondary_emails', []),
            'notificationPrefs': getattr(user, 'notification_prefs', None),
            'notificationHistory': getattr(user, 'notification_history', None)
        })
    except Exception as e:
        db.session.rollback()
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/export-account', methods=['POST'])
def export_account():
    data = request.get_json(force=True)
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404

    account = {
        'username': user.username,
        'email': user.email,
        'background_color': user.background_color,
        'text_color': user.text_color,
        'font': user.font,
        'timezone': user.timezone,
        'comments_page_size': user.comments_page_size,
        'secondary_emails': json.loads(user.secondary_emails) if user.secondary_emails else [],
        'bookmarks': json.loads(user.bookmarks) if user.bookmarks else [],
        'notification_prefs': json.loads(user.notification_prefs) if user.notification_prefs else {},
        'notification_history': json.loads(user.notification_history) if user.notification_history else [],
        # Optionally include votes and comments:
        'votes': [
            {
                'book_id': v.book_id,
                'value': v.value,
                'timestamp': v.timestamp.isoformat()
            } for v in Vote.query.filter_by(username=username).all()
        ],
        'comments': [
            {
                'book_id': c.book_id,
                'parent_id': c.parent_id,
                'text': c.text,
                'timestamp': c.timestamp.isoformat(),
                'edited': c.edited,
                'upvotes': c.upvotes,
                'downvotes': c.downvotes,
                'deleted': c.deleted,
                'background_color': c.background_color,
                'text_color': c.text_color
            } for c in Comment.query.filter_by(username=username).all()
        ]
    }
    return jsonify({'success': True, 'account': account})

@app.route('/api/import-account', methods=['POST'])
def import_account():
    data = request.get_json(force=True)
    username = data.get('username')
    account = data.get('account')
    user = User.query.filter_by(username=username).first()
    if not user or not account:
        return jsonify({'success': False, 'message': 'User not found or invalid data.'}), 400

    # Update basic fields
    user.email = account.get('email', user.email)
    user.background_color = account.get('background_color', user.background_color)
    user.text_color = account.get('text_color', user.text_color)
    user.font = account.get('font', user.font)
    user.timezone = account.get('timezone', user.timezone)
    user.comments_page_size = account.get('comments_page_size', user.comments_page_size)
    user.secondary_emails = json.dumps(account.get('secondary_emails', []))
    user.bookmarks = json.dumps(account.get('bookmarks', []))
    user.notification_prefs = json.dumps(account.get('notification_prefs', {}))
    user.notification_history = json.dumps(account.get('notification_history', []))

    db.session.commit()

    # Optionally merge votes and comments (skip duplicates)
    # Votes
    imported_votes = account.get('votes', [])
    for v in imported_votes:
        if not Vote.query.filter_by(username=username, book_id=v.get('book_id')).first():
            vote = Vote(
                username=username,
                book_id=v.get('book_id'),
                value=v.get('value', 1),
                timestamp=datetime.datetime.fromisoformat(v.get('timestamp')) if v.get('timestamp') else datetime.datetime.now(datetime.UTC)
            )
            db.session.add(vote)
    # Comments
    imported_comments = account.get('comments', [])
    for c in imported_comments:
        if not Comment.query.filter_by(username=username, book_id=c.get('book_id'), text=c.get('text')).first():
            comment = Comment(
                book_id=c.get('book_id'),
                username=username,
                parent_id=c.get('parent_id'),
                text=c.get('text'),
                timestamp=datetime.datetime.fromisoformat(c.get('timestamp')) if c.get('timestamp') else datetime.datetime.now(datetime.UTC),
                edited=c.get('edited', False),
                upvotes=c.get('upvotes', 0),
                downvotes=c.get('downvotes', 0),
                deleted=c.get('deleted', False),
                background_color=c.get('background_color'),
                text_color=c.get('text_color')
            )
            db.session.add(comment)
    db.session.commit()

    return jsonify({'success': True, 'message': 'Account data imported.'})

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = data.get('username')  # could be username or email
    password = data.get('password')
    if not identifier or not password:
        return jsonify({'success': False, 'message': 'Username/email and password required.'}), 400
    user = User.query.filter_by(username=identifier).first()
    if not user:
        user = User.query.filter_by(email=identifier).first()
    if not user or user.password != hash_password(password):
        return jsonify({'success': False, 'message': 'Invalid username/email or password.'}), 401
    if user.banned:
        return jsonify({'success': False, 'message': 'Your account has been banned.'}), 403
    return jsonify({
        'success': True,
        'message': 'Login successful.',
        'username': user.username,
        'email': user.email,
        'backgroundColor': user.background_color or '#ffffff',
        'textColor': user.text_color or '#000000',
        'bookmarks': json.loads(user.bookmarks) if user.bookmarks else [],
        'secondaryEmails': json.loads(user.secondary_emails) if user.secondary_emails else [],
        'font': user.font or '',
        'timezone': user.timezone or 'UTC',
        'notificationPrefs': json.loads(user.notification_prefs) if user.notification_prefs else {},
        'notificationHistory': json.loads(user.notification_history) if user.notification_history else [],
        'is_admin': user.is_admin
    })

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    password = data.get('password')
    backgroundColor = data.get('backgroundColor')
    textColor = data.get('textColor')
    if not username or not email or not password:
        return jsonify({'success': False, 'message': 'Username, email, and password required.'}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({'success': False, 'message': 'Username already exists.'}), 400
    if User.query.filter_by(email=email).first():
        return jsonify({'success': False, 'message': 'Email already registered.'}), 400
    user = User(
        username=username,
        email=email,
        password=hash_password(password),
        background_color=backgroundColor or '#ffffff',
        text_color=textColor or '#000000',
        bookmarks='[]',
        secondary_emails='[]',
        font='',
        timezone='UTC',
        notification_prefs=json.dumps({
            'muteAll': False,
            'newBooks': True,
            'updates': True,
            'announcements': True,
            'channels': ['primary']
        }),
        notification_history='[]'
    )
    db.session.add(user)
    db.session.commit()
    # Send welcome notification
    add_notification(
        user,
        'announcement',
        'Welcome to Storyweave Chronicles!',
        'Thank you for registering. Explore stories, bookmark your favorites, and join the community!',
        link='/'
    )
    # Send welcome email
    send_notification_email(
        user,
        'Welcome to Storyweave Chronicles!',
        f"Welcome to the site! You can read stories, bookmark your favorites, and join the community discussion. Hope you have a great time!\n\nYour account info:\nUsername: {user.username}\nEmail: {user.email}\n"
    )
    return jsonify({
        'success': True,
        'message': 'Registration successful.',
        'username': user.username,
        'email': user.email,
        'backgroundColor': user.background_color or '#ffffff',
        'textColor': user.text_color or '#000000',
        'bookmarks': json.loads(user.bookmarks) if user.bookmarks else [],
        'secondaryEmails': json.loads(user.secondary_emails) if user.secondary_emails else [],
        'font': user.font or '',
        'timezone': user.timezone or 'UTC',
        'notificationPrefs': json.loads(user.notification_prefs) if user.notification_prefs else {},
        'notificationHistory': json.loads(user.notification_history) if user.notification_history else [],
        'is_admin': user.is_admin
    })

@app.route('/api/change-password', methods=['POST'])
def change_password():
    data = request.get_json()
    username = data.get('username')
    current_password = data.get('currentPassword')
    new_password = data.get('newPassword')
    if not username or not current_password or not new_password:
        return jsonify({'success': False, 'message': 'All fields are required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.password != hash_password(current_password):
        return jsonify({'success': False, 'message': 'Current password is incorrect.'}), 401
    user.password = hash_password(new_password)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Password changed successfully.'})

@app.route('/api/add-secondary-email', methods=['POST'])
def add_secondary_email():
    data = request.get_json()
    username = data.get('username')
    new_email = data.get('email')
    if not username:
        return jsonify({'success': False, 'message': 'Username required.'}), 400
    if not new_email:
        return jsonify({'success': False, 'message': 'Email required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    secondary = json.loads(user.secondary_emails) if user.secondary_emails else []
    if new_email == user.email or new_email in secondary:
        return jsonify({'success': False, 'message': 'Email already associated with account.'}), 400
    if User.query.filter_by(email=new_email).first():
        return jsonify({'success': False, 'message': 'Email already registered to another account.'}), 400
    secondary.append(new_email)
    user.secondary_emails = json.dumps(secondary)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Secondary email added.', 'secondaryEmails': secondary})

@app.route('/api/remove-secondary-email', methods=['POST'])
def remove_secondary_email():
    data = request.get_json()
    username = data.get('username')
    email_to_remove = data.get('email')
    if not username or not email_to_remove:
        return jsonify({'success': False, 'message': 'Username and email required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    secondary = json.loads(user.secondary_emails) if user.secondary_emails else []
    if email_to_remove not in secondary:
        return jsonify({'success': False, 'message': 'Email not found in secondary emails.'}), 400
    secondary.remove(email_to_remove)
    user.secondary_emails = json.dumps(secondary)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Secondary email removed.', 'secondaryEmails': secondary})

@app.route('/api/get-user', methods=['POST'])
def get_user():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.', 'username': None, 'email': None}), 404
    email = user.email
    secondary = json.loads(user.secondary_emails) if user.secondary_emails else []
    if not email and secondary and len(secondary) > 0:
        email = secondary[0]
    return jsonify({
        'success': True,
        'username': username,
        'email': email,
        'backgroundColor': user.background_color or '#ffffff',
        'textColor': user.text_color or '#000000',
        'bookmarks': json.loads(user.bookmarks) if user.bookmarks else [],
        'secondaryEmails': secondary,
        'font': user.font or '',
        'timezone': user.timezone or 'UTC',
        'notificationPrefs': json.loads(user.notification_prefs) if user.notification_prefs else {},
        'notificationHistory': json.loads(user.notification_history) if user.notification_history else [],
        'is_admin': user.is_admin
    })

@app.route('/api/get-user-meta', methods=['GET'])
def get_user_meta():
    username = request.args.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        # Always return valid JSON, even for missing users
        return jsonify({
            'success': False,
            'background_color': '#232323',
            'text_color': '#fff',
            'message': 'User not found.'
        })
    return jsonify({
        'success': True,
        'background_color': user.background_color or '#232323',
        'text_color': user.text_color or '#fff'
    })

# === Admin & Moderation ===
# Make a user admin (admin-only)
@app.route('/api/admin/make-admin', methods=['POST'])
def make_admin():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    target_username = data.get('targetUsername')
    if not is_admin(admin_username):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    user = User.query.filter_by(username=target_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'Target user not found.'}), 404
    user.is_admin = True
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {target_username} is now an admin.'})

# Remove admin rights (admin-only)
@app.route('/api/admin/remove-admin', methods=['POST'])
def remove_admin():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    target_username = data.get('targetUsername')
    if not is_admin(admin_username):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    user = User.query.filter_by(username=target_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'Target user not found.'}), 404
    user.is_admin = False
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {target_username} is no longer an admin.'})

# Bootstrap first admin if none exist
@app.route('/api/admin/bootstrap-admin', methods=['POST'])
def bootstrap_admin():
    data = request.get_json()
    target_username = data.get('targetUsername')
    admin_count = User.query.filter_by(is_admin=True).count()
    if admin_count > 0:
        return jsonify({'success': False, 'message': 'Admins already exist. Use make-admin endpoint.'}), 403
    user = User.query.filter_by(username=target_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'Target user not found.'}), 404
    user.is_admin = True
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {target_username} is now the first admin.'})

@app.route('/api/admin/send-emergency-email', methods=['POST'])
def send_emergency_email():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    subject = data.get('subject')
    message = data.get('message')
    recipient = data.get('recipient')  # 'all', username, or email
    errors = []
    sent_count = 0
    # Log all mail config values for debugging
    logging.info(f"MAIL CONFIG: SERVER={app.config.get('MAIL_SERVER')}, PORT={app.config.get('MAIL_PORT')}, USE_TLS={app.config.get('MAIL_USE_TLS')}, USERNAME={app.config.get('MAIL_USERNAME')}")
    logging.info(f"Attempting emergency email: admin={admin_username}, subject={subject}, message={message}, recipient={recipient}")
    if not is_admin(admin_username):
        logging.warning(f"Unauthorized emergency email attempt by {admin_username}")
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    if not subject or not message:
        logging.error("Missing subject or message for emergency email.")
        return jsonify({'success': False, 'message': 'Subject and message required.'}), 400
    def send_with_logging(user, subject, message):
        try:
            logging.info(f"Preparing to send to {user.username} ({user.email})")
            # Log message details
            logging.info(f"Message details: subject={subject}, body={message}, sender={app.config.get('MAIL_USERNAME')}, recipient={user.email}")
            send_notification_email(user, subject, message)
            logging.info(f"Sent emergency email to {user.username} ({user.email}) with subject '{subject}'")
        except Exception as e:
            tb = traceback.format_exc()
            error_msg = f"Failed to send to {user.username} ({user.email}): {e}\n{tb}"
            logging.error(error_msg)
            errors.append(error_msg)
    if recipient == 'all':
        users = User.query.filter(User.email.isnot(None)).all()
        logging.info(f"Found {len(users)} users with email for emergency email.")
        for user in users:
            send_with_logging(user, subject, message)
            sent_count += 1
        logging.info(f"Admin {admin_username} sent emergency email to ALL users. Subject: {subject}")
    else:
        user = None
        if recipient:
            user = User.query.filter((User.username==recipient)|(User.email==recipient)).first()
        if user and user.email:
            send_with_logging(user, subject, message)
            sent_count = 1
            logging.info(f"Admin {admin_username} sent emergency email to {user.username} ({user.email}). Subject: {subject}")
        else:
            error_msg = f"Recipient not found or has no email: {recipient}"
            logging.error(error_msg)
            errors.append(error_msg)
    result = {'success': True, 'message': f'Emergency email sent to {sent_count} user(s).'}
    if errors:
        result['errors'] = errors
    logging.info(f"Emergency email result: {result}")
    return jsonify(result)

@app.route('/api/admin/send-newsletter', methods=['POST'])
def send_newsletter():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    subject = data.get('subject')
    message = data.get('message')
    errors = []
    sent_count = 0

    # Only allow admins
    if not is_admin(admin_username):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403

    # Compose newsletter subject and body
    today = datetime.datetime.now().strftime('%m/%d/%Y')
    newsletter_subject = f"Newsletter {today} - {subject}"
    newsletter_body = f"{message}\n\nSincerely,\n{admin_username}"

    # Send only to users with newsletter enabled in notification_prefs
    users = User.query.all()
    for user in users:
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if prefs.get('newsletter', False) and user.email:
            try:
                send_notification_email(user, newsletter_subject, newsletter_body)
                sent_count += 1
            except Exception as e:
                errors.append(f"Failed to send to {user.username}: {e}")

    return jsonify({'success': True, 'message': f'Newsletter sent to {sent_count} user(s).', 'errors': errors})

# --- Ban/Unban Endpoints ---
@app.route('/api/admin/ban-user', methods=['POST'])
def ban_user():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    target_username = data.get('targetUsername')
    if not is_admin(admin_username):
        user = User.query.filter_by(username=target_username).first()
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    user = User.query.filter_by(username=target_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'Target user not found.'}), 404
    if user.is_admin:
        return jsonify({'success': False, 'message': 'You cannot ban another admin.'}), 403
    user.banned = True
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {target_username} has been banned.'})

@app.route('/api/admin/unban-user', methods=['POST'])
def unban_user():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    target_username = data.get('targetUsername')
    if not is_admin(admin_username):
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
    user = User.query.filter_by(username=target_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'Target user not found.'}), 404
    user.banned = False
    db.session.commit()
    return jsonify({'success': True, 'message': f'User {target_username} has been unbanned.'})

@app.route('/api/moderate-comment', methods=['POST'])
def moderate_comment():
    data = request.get_json()
    comment_id = data.get('comment_id')
    action = data.get('action')  # 'delete', 'hide', etc.
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user or not user.is_admin:
        return jsonify({'success': False, 'message': 'Not authorized.'}), 403
    comment = Comment.query.get(comment_id)
    if not comment:
        return jsonify({'success': False, 'message': 'Comment not found.'}), 404
    if action == 'delete':
        comment.deleted = True
        db.session.commit()
        # Notify comment author if deleted by moderator/admin
        author = User.query.filter_by(username=comment.username).first()
        if author:
            add_notification(
                author,
                'moderation',
                'Comment Deleted by Moderator',
                f'Your comment on book {comment.book_id} was deleted by an admin/moderator.',
                link=f'/read/{comment.book_id}?comment={comment_id}'
            )
        return jsonify({'success': True, 'message': 'Comment deleted.'})

# === Book & PDF Management ===
@app.route('/api/update-external-id', methods=['POST'])
def update_external_id():
    """
    Update a book's external_story_id if a new PDF version contains a valid external ID and the current value is missing or blank.
    Body: { "book_id": <drive_id>, "pdf_bytes": <base64-encoded PDF> }
    """
    data = request.get_json()
    book_id = data.get('book_id')
    pdf_bytes_b64 = data.get('pdf_bytes')
    if not book_id or not pdf_bytes_b64:
        return jsonify({'success': False, 'message': 'Missing book_id or pdf_bytes.'}), 400
    book = Book.query.filter_by(drive_id=book_id).first()
    if not book:
        return jsonify({'success': False, 'message': 'Book not found.'}), 404
    try:
        pdf_bytes = base64.b64decode(pdf_bytes_b64)
    except Exception:
        return jsonify({'success': False, 'message': 'Invalid PDF bytes.'}), 400
    new_external_id = extract_story_id_from_pdf(pdf_bytes)
    # Only update if new_external_id is not None and current value is missing or blank
    if new_external_id and (not book.external_story_id or not book.external_story_id.strip()):
        book.external_story_id = new_external_id
        db.session.commit()
        return jsonify({'success': True, 'message': 'External ID updated.', 'external_story_id': new_external_id})
    return jsonify({'success': True, 'message': 'No update needed.', 'external_story_id': book.external_story_id})

@app.route('/api/rebuild-cover-cache', methods=['POST'])
def api_rebuild_cover_cache():
    try:
        # Optionally accept book_ids from frontend, else use default
        data = request.get_json(silent=True)
        book_ids = data.get('book_ids') if data and 'book_ids' in data else None
        if not book_ids or len(book_ids) < 20:
            logging.warning(f"[API][rebuild-cover-cache] Skipping deletion: received only {len(book_ids) if book_ids else 0} book_ids (minimum required: 20). Possible partial/empty POST. Waiting for next request.")
        success, missing = rebuild_cover_cache(book_ids)
        if success:
            return jsonify({'success': True, 'message': 'Cover cache rebuilt.', 'missing_ids': []}), 200
        else:
            return jsonify({'success': False, 'error': 'Missing covers', 'missing_ids': missing}), 200
    except Exception as e:
        logging.error(f"[API][rebuild-cover-cache] Error: {e}")
        return jsonify({'success': False, 'error': str(e), 'missing_ids': []}), 500
    
# Optimized book fetch endpoint: returns only requested books by drive_id
@app.route('/api/books', methods=['GET'])
def get_books_by_ids():
    ids_param = request.args.get('ids')
    if not ids_param:
        return jsonify({'error': 'Missing ids parameter'}), 400
    ids = ids_param.split(',')
    # Query books by drive_id
    books = Book.query.filter(Book.drive_id.in_(ids)).all()
    found_ids = set(b.drive_id for b in books)
    result = []
    for book in books:
        result.append({
            'id': book.drive_id,
            'title': book.title,
            'external_story_id': book.external_story_id,
            'created_at': book.created_at.isoformat() if book.created_at else None,
            'updated_at': book.updated_at.isoformat() if book.updated_at else None,
            'cover_url': get_cover_url(book.drive_id),
            # ...other fields...
        })
    # Add stubs for missing books
    for missing_id in set(ids) - found_ids:
        result.append({
            'id': missing_id,
            'missing': True
        })
    return jsonify({'books': result})

# --- GLOBAL BOOK METADATA ENDPOINT ---
@app.route('/api/all-books', methods=['GET'])
def all_books():
    try:
        # Get all books for frontend
        books = Book.query.all()
        result = []
        for book in books:
            result.append({
                'id': book.id,
                'drive_id': book.drive_id,
                'title': book.title,
                'external_story_id': book.external_story_id,
                'created_at': book.created_at.isoformat() if book.created_at else None,
                'updated_at': book.updated_at.isoformat() if book.updated_at else None,
                'cover_url': get_cover_url(book.drive_id)
            })
        response = jsonify(success=True, books=result)

        # For cover cache management, get top 20 newest and top 10 voted book IDs
        newest_books = Book.query.order_by(desc(Book.updated_at)).limit(20).with_entities(Book.drive_id).all()
        voted_books = (
            Book.query
            .join(Vote, Book.drive_id == Vote.book_id)
            .group_by(Book.id)
            .order_by(func.count(Vote.id).desc())
            .limit(10)
            .with_entities(Book.drive_id)
            .all()
        )
        cover_ids = set([b.drive_id for b in newest_books] + [b.drive_id for b in voted_books])
        # Trigger async cover cache update (non-blocking)
        return response
    except Exception as e:
        response = jsonify(success=False, error=str(e))
        return response, 500

@app.route('/api/cover-exists/<file_id>', methods=['GET'])
def cover_exists(file_id):
    cover_path = os.path.join(COVERS_DIR, f"{file_id}.jpg")
    exists = os.path.exists(cover_path)
    return jsonify({'exists': exists})

@app.route('/api/landing-page-book-ids', methods=['GET'])
def api_landing_page_book_ids():
    """
    Returns the list of book IDs for the landing page (carousel + top voted).
    """
    logging.info(f"[DIAGNOSTIC][ServeCover] Covers folder (image serve): {os.listdir(COVERS_DIR)}")
    try:
        book_ids = get_landing_page_book_ids()
        logging.info(f"[DIAGNOSTIC][ServeCover] Covers folder (fallback serve): {os.listdir(COVERS_DIR)}")
        return jsonify({'success': True, 'book_ids': book_ids})
    except Exception as e:
        logging.error(f"[Atlas] Error in /api/landing-page-book-ids: {e}")
        return jsonify({'success': False, 'error': str(e)}), 500


# --- Serve covers from disk with fallback ---
@app.route('/covers/<cover_id>.jpg')
def serve_cover(cover_id):
    """
    Serve cached cover image from disk. If missing, serve fallback image.
    If ?status=1 is passed, return JSON status instead of image.
    """
    filename = f"{cover_id}.jpg"
    cover_path = os.path.join(COVERS_DIR, filename)
    status_query = request.args.get('status')
    logging.info(f"[ServeCover] Incoming request: cover_id={cover_id}, status_query={status_query}, exists={os.path.exists(cover_path)}")
    logging.info(f"[ServeCover] All request args: {dict(request.args)}")
    # Ultra-detailed diagnostics
    try:
        stat_info = os.stat(cover_path)
        logging.info(f"[ServeCover][DIAG] stat for {cover_path}: {stat_info}")
    except Exception as e:
        logging.warning(f"[ServeCover][DIAG] Could not stat {cover_path}: {e}")
    try:
        perms = oct(os.stat(cover_path).st_mode) if os.path.exists(cover_path) else None
        logging.info(f"[ServeCover][DIAG] Permissions for {cover_path}: {perms}")
    except Exception as e:
        logging.warning(f"[ServeCover][DIAG] Could not get permissions for {cover_path}: {e}")
    try:
        with open(cover_path, 'rb') as f:
            f.read(10)
        logging.info(f"[ServeCover][DIAG] Read test succeeded for {cover_path}")
    except Exception as e:
        logging.warning(f"[ServeCover][DIAG] Read test failed for {cover_path}: {e}")
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info(f"[ServeCover][DIAG] Covers folder: {covers_dir_files}")
    atlas = load_atlas()
    logging.info(f"[ServeCover][DIAG] Atlas keys: {list(atlas.keys())}")
    logging.info(f"[ServeCover][DIAG] Atlas entry for {cover_id}: {atlas.get(cover_id)}")

    if status_query:
        logging.info(f"[ServeCover] Status mode triggered for cover_id={cover_id}")
        # Always return JSON for status requests, never image data
        try:
            exists = os.path.exists(cover_path)
            valid = False
            error = None
            # Extra diagnostics for status mode
            try:
                stat_info = os.stat(cover_path)
                logging.info(f"[ServeCover][Status][DIAG] stat for {cover_path}: {stat_info}")
            except Exception as e:
                logging.warning(f"[ServeCover][Status][DIAG] Could not stat {cover_path}: {e}")
            try:
                perms = oct(os.stat(cover_path).st_mode) if os.path.exists(cover_path) else None
                logging.info(f"[ServeCover][Status][DIAG] Permissions for {cover_path}: {perms}")
            except Exception as e:
                logging.warning(f"[ServeCover][Status][DIAG] Could not get permissions for {cover_path}: {e}")
            try:
                with open(cover_path, 'rb') as f:
                    f.read(10)
                logging.info(f"[ServeCover][Status][DIAG] Read test succeeded for {cover_path}")
            except Exception as e:
                logging.warning(f"[ServeCover][Status][DIAG] Read test failed for {cover_path}: {e}")
            covers_dir_files = os.listdir(COVERS_DIR)
            logging.info(f"[ServeCover][Status][DIAG] Covers folder: {covers_dir_files}")
            atlas = load_atlas()
            logging.info(f"[ServeCover][Status][DIAG] Atlas keys: {list(atlas.keys())}")
            logging.info(f"[ServeCover][Status][DIAG] Atlas entry for {cover_id}: {atlas.get(cover_id)}")
            if exists:
                try:
                    with Image.open(cover_path) as img:
                        img.verify()
                    valid = True
                    logging.info(f"[ServeCover] Cover validation PASSED for {cover_id}: exists={exists}, valid={valid}")
                except Exception as e:
                    error = str(e)
                    logging.warning(f"[ServeCover] Cover validation FAILED for {cover_id}: exists={exists}, error={error}")
            else:
                logging.info(f"[ServeCover] Cover file does not exist for {cover_id}")

            # If the image exists and is valid, always set status to 'valid' and valid to True
            if exists and valid:
                status = 'valid'
                valid = True
                logging.info(f"[ServeCover] Returning status=valid for {cover_id}")
            else:
                logging.info(f"[ServeCover][Status] PIL verify succeeded for {cover_id}")
                # Check if cover is being processed or queued
                pending = False
                with cover_queue_lock:
                    logging.info(f"[ServeCover][Status] PIL verify failed for {cover_id}: {error}")
                    # Check active
                    if cover_queue_active and cover_queue_active.get('file_id') == cover_id:
                        pending = True
                    # Check queue
                    elif any(entry.get('file_id') == cover_id for entry in cover_request_queue):
                        pending = True
                status = 'exists' if exists else ('pending' if pending else 'missing')
                logging.info(f"[ServeCover] Returning status={status} for {cover_id}, pending={pending}")
            resp = {
                'status': status,
                'cover_id': cover_id,
                'exists': exists,
                'valid': valid,
                'pending': pending if not (exists and valid) else False
            }
            if error:
                resp['error'] = error
            logging.info(f"[ServeCover] JSON response for {cover_id}: {resp}")
            return jsonify(resp)
        except Exception as e:
            logging.info(f"[ServeCover][Status] Final status for {cover_id}: exists={exists}, valid={valid}")
            # Fallback: always return JSON error
            logging.error(f"[ServeCover] Exception in status mode for {cover_id}: {e}")
            return jsonify({'status': 'error', 'cover_id': cover_id, 'error': str(e)}), 200

    # Normal image serving
    logging.info(f"[ServeCover] Normal image mode for {cover_id}, exists={os.path.exists(cover_path)}")
    # Extra diagnostics for normal image mode
    try:
        stat_info = os.stat(cover_path)
        logging.info(f"[ServeCover][Normal][DIAG] stat for {cover_path}: {stat_info}")
    except Exception as e:
        logging.warning(f"[ServeCover][Normal][DIAG] Could not stat {cover_path}: {e}")
    try:
        perms = oct(os.stat(cover_path).st_mode) if os.path.exists(cover_path) else None
        logging.info(f"[ServeCover][Normal][DIAG] Permissions for {cover_path}: {perms}")
    except Exception as e:
        logging.warning(f"[ServeCover][Normal][DIAG] Could not get permissions for {cover_path}: {e}")
    try:
        with open(cover_path, 'rb') as f:
            f.read(10)
        logging.info(f"[ServeCover][Normal][DIAG] Read test succeeded for {cover_path}")
    except Exception as e:
        logging.warning(f"[ServeCover][Normal][DIAG] Read test failed for {cover_path}: {e}")
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info(f"[ServeCover][Normal][DIAG] Covers folder: {covers_dir_files}")
    atlas = load_atlas()
    logging.info(f"[ServeCover][Normal][DIAG] Atlas keys: {list(atlas.keys())}")
    logging.info(f"[ServeCover][Normal][DIAG] Atlas entry for {cover_id}: {atlas.get(cover_id)}")
    if os.path.exists(cover_path):
        logging.info(f"[ServeCover] Sending image for {cover_id}")
        return send_from_directory(COVERS_DIR, filename)
    fallback_path = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'no-cover.svg')
    try:
        stat_info = os.stat(fallback_path)
        logging.info(f"[ServeCover][Fallback][DIAG] stat for {fallback_path}: {stat_info}")
    except Exception as e:
        logging.warning(f"[ServeCover][Fallback][DIAG] Could not stat {fallback_path}: {e}")
    try:
        perms = oct(os.stat(fallback_path).st_mode) if os.path.exists(fallback_path) else None
        logging.info(f"[ServeCover][Fallback][DIAG] Permissions for {fallback_path}: {perms}")
    except Exception as e:
        logging.warning(f"[ServeCover][Fallback][DIAG] Could not get permissions for {fallback_path}: {e}")
    try:
        with open(fallback_path, 'rb') as f:
            f.read(10)
        logging.info(f"[ServeCover][Fallback][DIAG] Read test succeeded for {fallback_path}")
    except Exception as e:
        logging.warning(f"[ServeCover][Fallback][DIAG] Read test failed for {fallback_path}: {e}")
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info(f"[ServeCover][Fallback][DIAG] Covers folder: {covers_dir_files}")
    atlas = load_atlas()
    logging.info(f"[ServeCover][Fallback][DIAG] Atlas keys: {list(atlas.keys())}")
    logging.info(f"[ServeCover][Fallback][DIAG] Atlas entry for {cover_id}: {atlas.get(cover_id)}")
    if os.path.exists(fallback_path):
        logging.info(f"[ServeCover] Sending fallback image for {cover_id}")
        return send_file(fallback_path, mimetype='image/svg+xml')
    logging.error(f"[ServeCover] No cover or fallback found for {cover_id}")
    return jsonify({'success': False, 'message': 'Cover not found.'}), 404

@app.route('/api/cancel-session', methods=['POST'])
def cancel_session():
    """
    Cancel all active and queued requests for a given session_id and type ('cover' or 'text').
    Body: { "session_id": "...", "type": "cover" | "text" }
    """
    data = request.get_json(force=True)
    session_id = data.get('session_id')
    req_type = data.get('type')
    if not session_id or req_type not in ['cover', 'text']:
        return jsonify({'success': False, 'message': 'Missing session_id or invalid type.'}), 400

    removed = 0
    if req_type == 'cover':
        with cover_queue_lock:
            # Remove from queue
            before = len(cover_request_queue)
            cover_request_queue[:] = [e for e in cover_request_queue if e['session_id'] != session_id]
            removed = before - len(cover_request_queue)
            # Cancel active if matches
            global cover_queue_active
            if cover_queue_active and cover_queue_active.get('session_id') == session_id:
                cover_queue_active = None
    elif req_type == 'text':
        with text_queue_lock:
            before = len(text_request_queue)
            text_request_queue[:] = [e for e in text_request_queue if e['session_id'] != session_id]
            removed = before - len(text_request_queue)
            global text_queue_active
            if text_queue_active and text_queue_active.get('session_id') == session_id:
                text_queue_active = None

    # Remove session heartbeat
    session_last_seen.pop(session_id, None)
    return jsonify({'success': True, 'removed': removed, 'message': f'Cancelled session {session_id} for {req_type}.'})
    

@app.route('/pdf-cover/<file_id>', methods=['GET'])
def pdf_cover(file_id):
    """
    Queue a cover extraction for file_id (FIFO, dedup). If already queued, do nothing. If at front, process immediately.
    """
    process = psutil.Process()
    mem = process.memory_info().rss / (1024 * 1024)
    cpu = process.cpu_percent(interval=0.1)
    MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
    MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))
    logging.info(f"[pdf-cover] ENTRY: file_id={file_id}, RAM={mem:.2f} MB, CPU={cpu:.2f}%")
    cover_path = os.path.join(COVERS_DIR, f"{file_id}.jpg")
    covers_map = load_atlas()
    # --- Deduplication: fail immediately if already queued ---
    import time
    with cover_queue_lock:
        if file_id in cover_request_queue:
            logging.warning(f"[pdf-cover] DUPLICATE: file_id {file_id} is already in cover_request_queue. Failing immediately.")
            return make_response(jsonify({'error': 'duplicate', 'file_id': file_id}), 409)
        cover_request_queue.append(file_id)
        logging.info(f"[pdf-cover] Queued cover for {file_id}. Queue length: {len(cover_request_queue)}")
    # Wait until at front of queue (no timeout while waiting)
    POLL_INTERVAL = 0.1    # seconds
    while True:
        with cover_queue_lock:
            if cover_request_queue[0] == file_id:
                # At front, process now
                break
        time.sleep(POLL_INTERVAL)
    # Now at front of queue, start timeout for processing
    LONGPOLL_TIMEOUT = 30  # seconds
    process_start = time.time()
    # Aggressive GC before processing
    for _ in range(3):
        gc.collect()
    mem = process.memory_info().rss / (1024 * 1024)
    cpu = process.cpu_percent(interval=0.1)
    logging.info(f"[pdf-cover] PRE-PROCESS GC: RAM={mem:.2f} MB, CPU={cpu:.2f}%")
    if mem > MEMORY_LOW_THRESHOLD_MB:
        logging.warning(f"[pdf-cover] WARNING: Memory usage {mem:.2f} MB exceeds LOW threshold of {MEMORY_LOW_THRESHOLD_MB} MB!")
    if mem > MEMORY_HIGH_THRESHOLD_MB:
        logging.error(f"[pdf-cover] ERROR: Memory usage {mem:.2f} MB exceeds HIGH threshold of {MEMORY_HIGH_THRESHOLD_MB} MB! Consider spinning down or restarting the server.")
    # 1. Serve from disk if present
    if os.path.exists(cover_path):
        covers_map[file_id] = f"{file_id}.jpg"
        save_atlas(covers_map)
        logging.info(f"[pdf-cover] Served cover from disk for {file_id}, mapping updated.")
        response = make_response(send_file(cover_path, mimetype='image/jpeg'))
        origin = request.headers.get('Origin')
        allowed = [
            "http://localhost:5173",
            "http://localhost:5000",
            "https://storyweavechronicles.onrender.com",
            "https://swcflaskbackend.onrender.com"
        ]
        response.headers["Access-Control-Allow-Origin"] = origin if origin in allowed else "https://storyweavechronicles.onrender.com"
        for _ in range(3):
            gc.collect()
        mem = process.memory_info().rss / (1024 * 1024)
        logging.info(f"[pdf-cover] POST-SERVE GC: RAM={mem:.2f} MB")
        with cover_queue_lock:
            cover_request_queue.popleft()
        return response
    # 2. Extract and cache cover (with timeout)
    while True:
        if time.time() - process_start > LONGPOLL_TIMEOUT:
            logging.error(f"[pdf-cover] TIMEOUT: Extraction for {file_id} exceeded {LONGPOLL_TIMEOUT}s at front of queue.")
            with cover_queue_lock:
                cover_request_queue.popleft()
            return make_response(jsonify({'error': 'Cover extraction timed out', 'file_id': file_id, 'timeout': True}), 504)
        img = extract_cover_image_from_pdf(file_id)
        if img is not None:
            img.save(cover_path, format='JPEG', quality=70)
            covers_map[file_id] = f"{file_id}.jpg"
            save_atlas(covers_map)
            logging.info(f"[pdf-cover] Extracted and cached cover for {file_id}, mapping updated.")
            response = make_response(send_file(cover_path, mimetype='image/jpeg'))
            origin = request.headers.get('Origin')
            allowed = [
                "http://localhost:5173",
                "http://localhost:5000",
                "https://storyweavechronicles.onrender.com",
                "https://swcflaskbackend.onrender.com"
            ]
            response.headers["Access-Control-Allow-Origin"] = origin if origin in allowed else "https://storyweavechronicles.onrender.com"
            if hasattr(img, 'close'):
                img.close()
            del img
            for _ in range(3):
                gc.collect()
            mem = process.memory_info().rss / (1024 * 1024)
            logging.info(f"[pdf-cover] POST-EXTRACT GC: RAM={mem:.2f} MB")
            with cover_queue_lock:
                cover_request_queue.popleft()
            return response
        else:
            # Extraction failed, serve SVG fallback
            logging.error(f"[pdf-cover] FAILURE: extract_cover_image_from_pdf returned None for file_id={file_id}")
            logging.error(f"[pdf-cover] FAILURE: Could not extract cover for {file_id}. Will send fallback SVG.")
            for _ in range(3):
                gc.collect()
            mem = process.memory_info().rss / (1024 * 1024)
            logging.info(f"[pdf-cover] POST-FALLBACK GC: RAM={mem:.2f} MB")
            fallback_svg_path = os.path.join(os.path.dirname(__file__), '..', 'client', 'public', 'no-cover.svg')
            with cover_queue_lock:
                cover_request_queue.popleft()
            if os.path.exists(fallback_svg_path):
                response = make_response(send_file(fallback_svg_path, mimetype='image/svg+xml'))
                origin = request.headers.get('Origin')
                allowed = [
                    "http://localhost:5173",
                    "http://localhost:5000",
                    "https://storyweavechronicles.onrender.com",
                    "https://swcflaskbackend.onrender.com"
                ]
                response.headers["Access-Control-Allow-Origin"] = origin if origin in allowed else "https://storyweavechronicles.onrender.com"
                return response
            else:
                logging.error(f"[pdf-cover] Fallback SVG not found at {fallback_svg_path}")
                return make_response(jsonify({'error': 'No cover available', 'file_id': file_id}), 404)

@app.route('/api/pdf-text/<file_id>', methods=['GET'])
def pdf_text(file_id):
    """
    Extracts text and images from a single PDF page in Google Drive by file_id and page number.
    Query params: page (1-based), session_id (optional)
    Returns: {"success": True, "page": n, "text": ..., "images": [...]} or error JSON.
    """
    global text_queue_active
    global text_queue_lock
    # --- Profiling: log CPU and RAM usage at entry ---
    process = psutil.Process()
    mem = process.memory_info().rss / (1024 * 1024)
    cpu = process.cpu_percent(interval=0.1)
    logging.info(f"[pdf-text] ENTRY: file_id={file_id}, RAM={mem:.2f} MB, CPU={cpu:.2f}%")
    # --- Existing code logic ---
    # --- Find book in DB and get total_pages if available ---
    book = Book.query.filter_by(drive_id=file_id).first()
    total_pages = None
    if book and hasattr(book, 'version_history') and book.version_history:
        try:
            vh = json.loads(book.version_history)
            # Try to get total_pages from version_history JSON
            if isinstance(vh, dict) and 'total_pages' in vh:
                total_pages = vh['total_pages']
            elif isinstance(vh, list) and len(vh) > 0 and 'total_pages' in vh[0]:
                total_pages = vh[0]['total_pages']
        except Exception as e:
            total_pages = None
    session_id = request.args.get('session_id') or request.headers.get('X-Session-Id')
    page_str = request.args.get('page')
    logging.info(f"[pdf-text] Incoming request: file_id={file_id}, page={page_str}, session_id={session_id}")
    start_time = time.time()
    entry = None
    page_num = 1
    try:
        if not session_id:
            logging.error("[pdf-text] ERROR: No session_id provided!")
            return jsonify({"success": False, "error": "Missing session_id"}), 400
        heartbeat(session_id)
        page_num = int(page_str) if page_str and page_str.isdigit() else 1
        entry = {'session_id': session_id, 'file_id': file_id, 'page_num': page_num, 'timestamp': time.time()}
        acquired = text_queue_lock.acquire(timeout=5)
        if not acquired:
            logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock.")
            return jsonify({"success": False, "error": "Could not acquire queue lock (deadlock?)"}), 503
        try:
            # Deduplicate: only add if not already present
            if not any(e['session_id'] == entry['session_id'] and e['file_id'] == entry['file_id'] and e['page_num'] == entry['page_num'] for e in text_request_queue):
                text_request_queue.append(entry)
                logging.info(f"[pdf-text] appended to queue: {entry}. Queue length now: {len(text_request_queue)}")
            else:
                logging.info(f"[pdf-text] duplicate entry detected, not appending: {entry}")
            logging.info(f"[pdf-text] Queue length after append: {len(text_request_queue)}")
        finally:
            text_queue_lock.release()

        # --- Queue/delay requests BEFORE starting the timeout timer ---
        # Wait until this request is at the front of the queue and no active request
        logging.info(f"[pdf-text] Entering waiting loop: Queue length in wait loop: {len(text_request_queue)}")
        while True:
            acquired = text_queue_lock.acquire(timeout=5)
            if not acquired:
                logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock in queue wait loop.")
                # Robust cleanup on lock failure
                cleanup_text_queue()
                break
            try:
                cleanup_text_queue()
                if text_request_queue and text_request_queue[0] == entry and (text_queue_active is None or text_queue_active == entry):
                    text_queue_active = entry
                    break
            finally:
                text_queue_lock.release()
            time.sleep(0.05)
        # Now at front of queue, start the timeout timer for actual processing
        wait_start = time.time()
        wait_end = None
        # --- Actual text extraction logic (OUTSIDE LOCK) ---
        try:
            service = get_drive_service()
            logging.info(f"[pdf-text] Step: got Google Drive service for file_id={file_id}")
            request_drive = service.files().get_media(fileId=file_id)
            pdf_bytes = request_drive.execute()
            logging.info(f"[pdf-text] downloaded file content for file_id={file_id}, size={len(pdf_bytes)} bytes")
            temp_pdf = None
            doc = None
            try:
                with tempfile.NamedTemporaryFile(delete=True, suffix='.pdf') as tmp_file:
                    tmp_file.write(pdf_bytes)
                    tmp_file.flush()
                    logging.info(f"[pdf-text] wrote PDF to temp file: {tmp_file.name}")
                    doc = fitz.open(tmp_file.name)
                    logging.info(f"[pdf-text] opened PDF from temp file for file_id={file_id}, page_count={doc.page_count}")
            except Exception as temp_e:
                logging.error(f"[pdf-text] failed to open PDF from temp file: {temp_e}. Falling back to in-memory.")
                try:
                    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                    logging.info(f"[pdf-text] opened PDF from memory for file_id={file_id}, page_count={doc.page_count}")
                except Exception as mem_e:
                    logging.error(f"[pdf-text] failed to open PDF from memory: {mem_e}")
                    response = jsonify({"success": False, "error": f"Failed to open PDF: {mem_e}", "total_pages": total_pages})
                    return response, 500
            if not doc:
                response = jsonify({"success": False, "error": "Could not open PDF.", "total_pages": total_pages})
                return response, 500
            # Always set total_pages from doc.page_count if not already set
            if not total_pages:
                total_pages = doc.page_count
            if page_num < 1 or page_num > doc.page_count:
                doc.close()
                logging.error(f"[pdf-text] invalid page number: {page_num} for file_id={file_id}")
                response = jsonify({
                    "success": False,
                    "error": f"Page {page_num} is out of range.",
                    "total_pages": total_pages,
                    "stop": True
                })
                acquired = text_queue_lock.acquire(timeout=5)
                if acquired:
                    try:
                        if text_request_queue and text_request_queue[0] == entry:
                            text_request_queue.popleft()
                        if text_queue_active == entry:
                            text_queue_active = None
                    finally:
                        text_queue_lock.release()
                else:
                    logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock in cleanup.")
                end_time = time.time()
                logging.info(f"[pdf-text] finished! total request time: {end_time - start_time:.2f}s for file_id={file_id} page={page_num}")
                return response, 200
            page = doc.load_page(page_num - 1)
            page_text = page.get_text("text")
            logging.info(f"[pdf-text] extracted text from page {page_num} for file_id={file_id}")
            images = []
            for img_index, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                try:
                    base_image = doc.extract_image(xref)
                    img_bytes = base_image["image"]
                    out = downscale_image(img_bytes, size=(300, 400), format="JPEG", quality=70)
                    img_b64 = base64.b64encode(out.read()).decode("utf-8")
                    images.append({
                        "index": img_index,
                        "xref": xref,
                        "base64": img_b64,
                        "ext": "jpg"
                    })
                except Exception as img_e:
                    logging.warning(f"[pdf-text] failed to extract image xref={xref} on page={page_num}: {img_e}")
            page = None
            doc.close()
            del doc
            gc.collect()
            mem = psutil.Process().memory_info().rss / (1024 * 1024)
            logging.info(f"[pdf-text] memory usage: {mem:.2f} MB for file_id={file_id} page={page_num}")
            MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
            MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))
            if mem > MEMORY_LOW_THRESHOLD_MB:
                logging.warning(f"[pdf-text] WARNING: Memory usage {mem:.2f} MB exceeds LOW threshold of {MEMORY_LOW_THRESHOLD_MB} MB!")
            if mem > MEMORY_HIGH_THRESHOLD_MB:
                logging.error(f"[pdf-text] ERROR: Memory usage {mem:.2f} MB exceeds HIGH threshold of {MEMORY_HIGH_THRESHOLD_MB} MB! Consider spinning down or restarting the server.")
            response = jsonify({"success": True, "page": page_num, "text": page_text, "images": images, "total_pages": total_pages})
        except Exception as e:
            logging.error(f"[pdf-text] error extracting text for file_id={file_id}: {e}")
            response = jsonify({"success": False, "error": str(e), "total_pages": total_pages})

        # Remove from queue and clear active (INSIDE LOCK, FAST, always)
        acquired = text_queue_lock.acquire(timeout=5)
        if acquired:
            try:
                if text_request_queue and text_request_queue[0] == entry:
                    text_request_queue.popleft()
                    logging.info(f"[pdf-text] Queue length after popleft: {len(text_request_queue)}")
                if text_queue_active == entry:
                    text_queue_active = None
            finally:
                text_queue_lock.release()
        else:
            logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock in cleanup.")
        end_time = time.time()
        logging.info(f"[pdf-text] finished! total request time: {end_time - start_time:.2f}s for file_id={file_id} page={page_num}")
        return response
    except Exception as e:
        logging.error(f"[pdf-text] error in pdf-text endpoint for file_id={file_id}: {e}")
        # Always clean up queue/lock on error
        if entry:
            acquired = text_queue_lock.acquire(timeout=5)
            if acquired:
                try:
                    if text_request_queue and text_request_queue[0] == entry:
                        text_request_queue.popleft()
                    if text_queue_active == entry:
                        text_queue_active = None
                finally:
                    text_queue_lock.release()
            else:
                logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock in error cleanup.")
        return jsonify({"success": False, "error": str(e)}), 500

# === Voting ===
@app.route('/api/vote-book', methods=['POST'])
def vote_book():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    value = data.get('value')  # 1-5
    if not username or not book_id or value not in [1,2,3,4,5]:
        return jsonify({'success': False, 'message': 'Invalid vote data.'}), 400
    vote = Vote.query.filter_by(username=username, book_id=book_id).first()
    if vote:
        vote.value = value
        vote.timestamp = datetime.datetime.now(datetime.UTC)
    else:
        vote = Vote(username=username, book_id=book_id, value=value)
        db.session.add(vote)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vote recorded.'})

@app.route('/api/book-votes', methods=['GET'])
def book_votes():
    book_id = request.args.get('book_id')
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID required.'}), 400
    votes = Vote.query.filter_by(book_id=book_id).all()
    if not votes:
        return jsonify({'success': True, 'average': 0, 'count': 0})
    avg = round(sum(v.value for v in votes) / len(votes), 2)
    return jsonify({'success': True, 'average': avg, 'count': len(votes)})

@app.route('/api/top-voted-books', methods=['GET'])
def top_voted_books():
    vote_counts = db.session.query(
        Vote.book_id,
        func.avg(Vote.value).label('avg_vote'),
        func.count(Vote.value).label('vote_count')
    ).group_by(Vote.book_id).order_by(func.avg(Vote.value).desc()).limit(10).all()
    # Get book metadata from Google Drive
    service = None
    try:
        service = get_drive_service()
    except Exception:
        pass
    books = []
    for book_id, avg_vote, vote_count in vote_counts:
        meta = {'id': book_id, 'average': round(avg_vote,2), 'count': vote_count}
        if service:
            try:
                file_metadata = service.files().get(fileId=book_id, fields='name').execute()
                meta['name'] = file_metadata.get('name')
            except Exception:
                meta['name'] = None
        books.append(meta)
    return jsonify({'success': True, 'books': books})

@app.route('/api/user-voted-books', methods=['GET'])
def user_voted_books():
    username = request.args.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'Username required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # Get all votes by this user
    votes = Vote.query.filter_by(username=username).all()
    voted_books = []
    for vote in votes:
        book = Book.query.filter_by(drive_id=vote.book_id).first()
        if book:
            voted_books.append({
                'book_id': book.drive_id,
                'title': book.title,
                'vote': vote.value,
                'timestamp': vote.timestamp.strftime('%Y-%m-%d %H:%M'),
                'external_story_id': book.external_story_id
            })
    return jsonify({'success': True, 'voted_books': voted_books})

@app.route('/api/user-top-voted-books', methods=['GET'])
def user_top_voted_books():
    username = request.args.get('username')
    if not username:
        response = jsonify({'error': 'Missing username'})
        return response, 400
    user = User.query.filter_by(username=username).first()
    if not user:
        response = jsonify({'error': 'User not found'})
        return response, 404
    # Get all votes by this user
    votes = Vote.query.filter_by(username=username).all()
    if not votes:
        response = jsonify({'books': []})
        return response, 200
    # Get book info for each voted book
    book_ids = [v.book_id for v in votes]
    books = Book.query.filter(Book.drive_id.in_(book_ids)).all()
    # Build result list with vote info
    result = []
    for book in books:
        vote = next((v for v in votes if v.book_id == book.drive_id), None)
        result.append({
            'id': book.drive_id,
            'title': book.title,
            'cover_url': get_cover_url(book.drive_id),
            'votes': vote.value if vote else None
        })
    # Sort by vote value descending, then by title
    result.sort(key=lambda b: (-b['votes'] if b['votes'] is not None else 0, b['title']))
    response = jsonify({'books': result})
    return response, 200

# === Bookmarks ===
@app.route('/api/get-bookmarks', methods=['GET', 'POST'])
def get_bookmarks():
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username') if data else None
    else:
        username = request.args.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        response = jsonify({'success': False, 'message': 'User not found.'})
        return response, 404
    bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
    # Get last updated time for each bookmarked PDF from Google Drive
    try:
        service = get_drive_service()
        # Get all file IDs in bookmarks
        file_ids = [bm['id'] for bm in bookmarks]
        if file_ids:
            # Query Google Drive for these files
            query = " or ".join([f"'{fid}' in parents or id='{fid}'" for fid in file_ids])
            results = service.files().list(q=query, fields="files(id, modifiedTime)").execute()
            files = results.get('files', [])
            file_update_map = {f['id']: f.get('modifiedTime') for f in files}
            # Update each bookmark with actual last updated time
            for bm in bookmarks:
                bm['last_updated'] = file_update_map.get(bm['id'], bm.get('last_updated'))
        # Ensure every bookmark has a cover_url
        for bm in bookmarks:
            bm['cover_url'] = get_cover_url(bm['id'])
    except Exception as e:
        pass  # If Drive fails, fallback to stored last_updated
    response = jsonify({'success': True, 'bookmarks': bookmarks})
    return response

@app.route('/api/add-bookmark', methods=['POST'])
def add_bookmark():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    if not username or not book_id:
        return jsonify({'success': False, 'message': 'Username and book_id required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
    for bm in bookmarks:
        bm['cover_url'] = get_cover_url(bm['id'])
        if bm['id'] == book_id:
            return jsonify({'success': True, 'message': 'Already bookmarked.', 'bookmarks': bookmarks})
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    bookmarks.append({'id': book_id, 'last_page': 1, 'last_updated': now, 'unread': False, 'cover_url': get_cover_url(book_id)})
    user.bookmarks = json.dumps(bookmarks)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Bookmarked.', 'bookmarks': bookmarks})

@app.route('/api/remove-bookmark', methods=['POST'])
def remove_bookmark():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID missing.'}), 400
    bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
    before = len(bookmarks)
    bookmarks = [bm for bm in bookmarks if bm['id'] != book_id]
    after = len(bookmarks)
    # Ensure every bookmark has a cover_url
    for bm in bookmarks:
        bm['cover_url'] = get_cover_url(bm['id'])
    user.bookmarks = json.dumps(bookmarks)
    db.session.commit()
    if before == after:
        return jsonify({'success': False, 'message': 'Bookmark not found.', 'bookmarks': bookmarks})
    return jsonify({'success': True, 'message': 'Bookmark removed.', 'bookmarks': bookmarks})

@app.route('/api/update-bookmark-meta', methods=['POST'])
def update_bookmark_meta():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    last_page = data.get('last_page')
    unread = data.get('unread')
    if not username or not book_id:
        return jsonify({'success': False, 'message': 'Username and book_id required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
    updated = False
    for bm in bookmarks:
        if bm['id'] == book_id:
            if last_page is not None:
                bm['last_page'] = last_page
            if unread is not None:
                bm['unread'] = unread
            bm['last_updated'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
            updated = True
    # Ensure every bookmark has a cover_url
    for bm in bookmarks:
        bm['cover_url'] = get_cover_url(bm['id'])
    if not updated:
        return jsonify({'success': False, 'message': 'Bookmark not found.'}), 404
    user.bookmarks = json.dumps(bookmarks)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Bookmark updated.', 'bookmarks': bookmarks})

# === Comments ===
@app.route('/api/add-comment', methods=['POST'])
def add_comment():
    data = request.get_json()
    book_id = data.get('book_id')
    username = data.get('username')
    text = data.get('text')
    parent_id = data.get('parent_id')
    if not book_id or not username or not text:
        return jsonify({'success': False, 'message': 'Missing fields.'}), 400
    comment = Comment(book_id=book_id, username=username, text=text, parent_id=parent_id)
    db.session.add(comment)
    db.session.commit()
    # Hook for notifications: if parent_id, notify parent comment's author
    return jsonify({'success': True, 'message': 'Comment added.', 'comment_id': comment.id})

@app.route('/api/edit-comment', methods=['POST'])
def edit_comment():
    data = request.get_json()
    comment_id = data.get('comment_id')
    username = data.get('username')
    text = data.get('text')
    comment = Comment.query.get(comment_id)
    if not comment or comment.deleted:
        return jsonify({'success': False, 'message': 'Comment not found.'}), 404
    if comment.username != username:
        user = User.query.filter_by(username=username).first()
        if not user or not user.is_admin:
            return jsonify({'success': False, 'message': 'Not authorized.'}), 403
    comment.text = text
    comment.edited = True
    comment.timestamp = datetime.datetime.now(datetime.UTC)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Comment edited.'})

@app.route('/api/delete-comment', methods=['POST'])
def delete_comment():
    data = request.get_json()
    comment_id = data.get('comment_id')
    username = data.get('username')
    comment = Comment.query.get(comment_id)
    if not comment or comment.deleted:
        return jsonify({'success': False, 'message': 'Comment not found.'}), 404
    if comment.username != username:
        user = User.query.filter_by(username=username).first()
        if not user or not user.is_admin:
            return jsonify({'success': False, 'message': 'Not authorized.'}), 403
    comment.deleted = True
    db.session.commit()
    return jsonify({'success': True, 'message': 'Comment deleted.'})

@app.route('/api/get-comments', methods=['GET'])
def get_comments():
    book_id = request.args.get('book_id')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 20))
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID required.'}), 400
    # Query all comments for the book, ordered by timestamp ascending
    query = Comment.query.filter_by(book_id=book_id).order_by(Comment.timestamp.asc())
    total_comments = query.count()
    total_pages = (total_comments + page_size - 1) // page_size
    comments = query.offset((page - 1) * page_size).limit(page_size).all()
    # Build nested replies for only the current page
    comment_map = {}
    tree = []
    for c in comments:
        if c.deleted:
            continue
        user = User.query.filter_by(username=c.username).first()
        item = {
            'id': c.id,
            'book_id': c.book_id,
            'username': c.username,
            'parent_id': c.parent_id,
            'text': c.text,
            'timestamp': c.timestamp.isoformat(),
            'edited': c.edited,
            'upvotes': c.upvotes,
            'downvotes': c.downvotes,
            'deleted': c.deleted,
            'background_color': user.background_color if user and user.background_color else None,
            'text_color': user.text_color if user and user.text_color else None,
            'replies': []
        }
        comment_map[c.id] = item
    for item in comment_map.values():
        if item['parent_id'] and item['parent_id'] in comment_map:
            comment_map[item['parent_id']]['replies'].append(item)
        else:
            tree.append(item)
    return jsonify({
        'success': True,
        'comments': tree,
        'page': page,
        'page_size': page_size,
        'total_comments': total_comments,
        'total_pages': total_pages
    })

# Efficient polling endpoint for new comments on a book
@app.route('/api/has-new-comments', methods=['POST'])
def has_new_comments():
    data = request.get_json()
    book_id = data.get('book_id')
    # Accept either a list of known comment IDs or the latest timestamp
    known_ids = set(data.get('known_ids', []))
    latest_timestamp = data.get('latest_timestamp')  # ISO8601 string or None
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID required.'}), 400
    # Query all non-deleted comments for the book
    query = Comment.query.filter_by(book_id=book_id, deleted=False)
    # If known_ids provided, check for any comments not in known_ids
    if known_ids:
        new_comments = query.filter(~Comment.id.in_(known_ids)).all()
        has_new = len(new_comments) > 0
        new_ids = [c.id for c in new_comments]
        return jsonify({'success': True, 'hasNew': has_new, 'new_ids': new_ids})
    # If latest_timestamp provided, check for any comments newer than that
    elif latest_timestamp:
        try:
            ts = dateutil.parser.isoparse(latest_timestamp)
        except Exception:
            return jsonify({'success': False, 'message': 'Invalid timestamp.'}), 400
        new_comments = query.filter(Comment.timestamp > ts).all()
        has_new = len(new_comments) > 0
        new_ids = [c.id for c in new_comments]
        return jsonify({'success': True, 'hasNew': has_new, 'new_ids': new_ids})
    else:
        # If neither provided, just return False
        return jsonify({'success': True, 'hasNew': False, 'new_ids': []})

@app.route('/api/vote-comment', methods=['POST'])
def vote_comment():
    data = request.get_json()
    comment_id = data.get('comment_id')
    value = data.get('value')  # 1 for upvote, -1 for downvote
    if value not in [1, -1]:
        return jsonify({'success': False, 'message': 'Invalid vote value.'}), 400
    comment = Comment.query.get(comment_id)
    if not comment or comment.deleted:
        return jsonify({'success': False, 'message': 'Comment not found.'}), 404
    if value == 1:
        comment.upvotes += 1
    else:
        comment.downvotes += 1
    db.session.commit()
    return jsonify({'success': True, 'message': 'Vote recorded.', 'upvotes': comment.upvotes, 'downvotes': comment.downvotes})

@app.route('/api/get-comment-votes', methods=['GET'])
def get_comment_votes():
    comment_id = request.args.get('comment_id')
    comment = Comment.query.get(comment_id)
    if not comment or comment.deleted:
        return jsonify({'success': False, 'message': 'Comment not found.'}), 404
    return jsonify({'success': True, 'upvotes': comment.upvotes, 'downvotes': comment.downvotes})

@app.route('/api/user-comments', methods=['GET'])
def user_comments():
    username = request.args.get('username')
    comments = Comment.query.filter_by(username=username).order_by(Comment.timestamp.desc()).all()
    return jsonify({'success': True, 'comments': [
        {
            'id': c.id,
            'book_id': c.book_id,
            'parent_id': c.parent_id,
            'text': c.text,
            'timestamp': c.timestamp.isoformat(),
            'edited': c.edited,
            'upvotes': c.upvotes,
            'downvotes': c.downvotes,
            'deleted': c.deleted
        } for c in comments if not c.deleted
    ]})

# === Notifications ===
@app.route('/api/get-notification-prefs', methods=['POST'])
def get_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first() if username else None
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # Define all expected keys and their defaults
    expected_defaults = {
        'email': False,
        'push': False,
        'newsletter': False,
        'siteUpdates': True,
        'newBook': True,
        'bookmarkUpdates': True,
        'replyNotifications': True,
        'emailChannels': [],
        'emailFrequency': 'immediate',
        'muteAll': False,
        'newBooks': True,
        'updates': True,
        'announcements': True,
        'channels': ['primary']
    }
    if user.notification_prefs:
        prefs = json.loads(user.notification_prefs)
    else:
        prefs = expected_defaults.copy()
        user.notification_prefs = json.dumps(prefs)
        db.session.commit()
    # Normalize: ensure all expected keys are present
    normalized = expected_defaults.copy()
    normalized.update(prefs)
    # Type normalization: ensure booleans are booleans, arrays are arrays
    for k, v in expected_defaults.items():
        if isinstance(v, bool):
            normalized[k] = bool(normalized.get(k, v))
        elif isinstance(v, list):
            val = normalized.get(k, v)
            if not isinstance(val, list):
                try:
                    val = list(val) if isinstance(val, (tuple, set)) else [val] if val else []
                except Exception:
                    val = []
            normalized[k] = val
        else:
            normalized[k] = normalized.get(k, v)
    return jsonify({'success': True, 'prefs': normalized})

@app.route('/api/update-notification-prefs', methods=['POST'])
def update_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    prefs = data.get('prefs')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    user.notification_prefs = json.dumps(prefs)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Notification preferences updated.'})

# Paginated notification history endpoint
@app.route('/api/get-notification-history', methods=['POST'])
def get_notification_history():
    try:
        data = request.get_json(force=True)
        username = data.get('username')
        page = int(data.get('page', 1))
        page_size = int(data.get('page_size', 100))
        user = User.query.filter_by(username=username).first()
        logging.info(f"[get-notification-history] Requested username: {username}")
        if not user:
            logging.warning(f"Notification history: User not found: {username}")
            return jsonify({'success': False, 'message': 'User not found', 'notifications': []})
        logging.info(f"[get-notification-history] Found user: {user.username}, notification_history type: {type(user.notification_history)}, value: {repr(user.notification_history)[:200]}")
        history = []
        if user.notification_history:
            try:
                history = json.loads(user.notification_history)
                logging.info(f"[get-notification-history] Parsed notification_history, type: {type(history)}, length: {len(history) if isinstance(history, list) else 'N/A'}")
                if not isinstance(history, list):
                    logging.error(f"Notification history for user {username} is not a list. Got: {type(history)}")
                    history = []
            except Exception as e:
                logging.error(f"Error loading notification history for user {username}: {e}")
                history = []
        else:
            logging.info(f"[get-notification-history] No notification_history for user {username}")
        # Sort by timestamp descending (newest first)
        history.sort(key=lambda n: n.get('timestamp', 0), reverse=True)
        total = len(history)
        start = (page - 1) * page_size
        end = start + page_size
        chunk = history[start:end]
        logging.info(f"[get-notification-history] Returning {len(chunk)} notifications out of {total} total.")
        return jsonify({
            'success': True,
            'notifications': chunk,
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size
        })
    except Exception as e:
        logging.error(f"Exception in get_notification_history: {e}")
        return jsonify({'success': False, 'message': f'Error: {str(e)}', 'notifications': []})

# Add a GET handler to return JSON error
@app.route('/api/notification-history', methods=['GET'])
def notification_history_get():
    return jsonify({'success': False, 'message': 'Use POST for this endpoint.'}), 405

@app.route('/api/notify-reply', methods=['POST'])
def notify_reply():
    data = request.get_json()
    book_id = data.get('book_id')
    comment_id = data.get('comment_id')
    message = data.get('message', 'Someone replied to your comment!')
    # Find the parent comment (use Session.get for SQLAlchemy 2.x compatibility)
    parent_comment = db.session.get(Comment, comment_id)
    if not parent_comment or parent_comment.deleted:
        return jsonify({'success': False, 'message': 'Parent comment not found.'}), 404
    parent_username = parent_comment.username
    user = User.query.filter_by(username=parent_username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # Add notification with link to the reply
    add_notification(
        user,
        'reply',
        'New Reply!',
        message,
        link=f'/read/{book_id}?comment={comment_id}'
    )
    return jsonify({'success': True, 'message': f'Reply notification sent to {parent_username}.'})

@app.route('/api/notify-new-book', methods=['POST'])
def notify_new_book():
    data = request.get_json()
    book_id = data.get('book_id')
    book_title = data.get('book_title', 'Untitled Book')
    users = User.query.all()
    for user in users:
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if not prefs.get('muteAll', False) and prefs.get('newBooks', True):
            add_notification(user, 'newBook', 'New Book Added!', f'A new book "{book_title}" is now available in the library.', link=f'/read/{book_id}')
    return jsonify({'success': True, 'message': f'Notification sent for new book: {book_title}.'})

@app.route('/api/notify-book-update', methods=['POST'])
def notify_book_update():
    data = request.get_json()
    book_id = data.get('book_id')
    book_title = data.get('book_title', 'A book in your favorites')
    count = 0
    users = User.query.all()
    for user in users:
        bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if any(bm['id'] == book_id for bm in bookmarks) and not prefs.get('muteAll', False) and prefs.get('updates', True):
            add_notification(user, 'bookUpdate', 'Book Updated!', f'"{book_title}" in your favorites has been updated.', link=f'/read/{book_id}')
            count += 1
    return jsonify({'success': True, 'message': f'Notification sent to {count} users for book update.'})

@app.route('/api/notify-app-update', methods=['POST'])
def notify_app_update():
    users = User.query.all()
    for user in users:
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if not prefs.get('muteAll', False) and prefs.get('announcements', True):
            add_notification(user, 'appUpdate', 'App Updated!', 'Storyweave Chronicles has been updated!')
    return jsonify({'success': True, 'message': 'App update notification sent to all users.'})

@app.route('/api/mark-all-notifications-read', methods=['POST'])
def mark_notifications_read():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    history = json.loads(user.notification_history) if user.notification_history else []
    for n in history:
        n['read'] = True
    user.notification_history = json.dumps(history)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Notifications marked as read.', 'history': history})

@app.route('/api/delete-notification', methods=['POST'])
def delete_notification():
    data = request.get_json()
    username = data.get('username')
    notification_id = data.get('notificationId')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    history = json.loads(user.notification_history) if user.notification_history else []
    new_history = [n for n in history if str(n.get('id', n.get('timestamp'))) != str(notification_id)]
    found = len(new_history) < len(history)
    user.notification_history = json.dumps(new_history)
    db.session.commit()
    return jsonify({'success': found, 'message': 'Notification deleted.' if found else 'Notification not found.', 'history': new_history})

# Dismiss all notifications for a user
@app.route('/api/dismiss-all-notifications', methods=['POST'])
def dismiss_all_notifications():
    data = request.get_json()
    username = data.get('username')
    logging.info(f"[DISMISS ALL] Request for user: {username}")
    user = User.query.filter_by(username=username).first()
    if not user:
        logging.error(f"[DISMISS ALL] User not found: {username}")
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    history = json.loads(user.notification_history) if user.notification_history else []
    logging.info(f"[DISMISS ALL] Initial history count: {len(history)}")
    for n in history:
        n['dismissed'] = True
        if 'id' not in n:
            n['id'] = n.get('timestamp')
    user.notification_history = json.dumps(history)
    db.session.commit()
    logging.info(f"[DISMISS ALL] All notifications set to dismissed. History count: {len(history)}")
    return jsonify({'success': True, 'message': 'All notifications dismissed.', 'history': history})

# Mark a single notification as read/unread
@app.route('/api/mark-notification-read', methods=['POST'])
def mark_notification_read():
    data = request.get_json()
    username = data.get('username')
    notification_id = data.get('notificationId')
    read = data.get('read', True)
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    history = json.loads(user.notification_history) if user.notification_history else []
    found = False
    for n in history:
        if 'id' not in n:
            n['id'] = n.get('timestamp')
        if n.get('id') == notification_id or n.get('timestamp') == notification_id:
            n['read'] = read
            found = True
    user.notification_history = json.dumps(history)
    db.session.commit()
    return jsonify({'success': found, 'message': 'Notification marked as read.' if found else 'Notification not found.', 'history': history})

@app.route('/api/delete-all-notification-history', methods=['POST'])
def delete_all_notification_history():
    data = request.get_json()
    username = data.get('username')
    logging.info(f"[DELETE ALL] Request for user: {username}")
    user = User.query.filter_by(username=username).first()
    if not user:
        logging.error(f"[DELETE ALL] User not found: {username}")
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    logging.info(f"[DELETE ALL] History BEFORE: {user.notification_history}")
    user.notification_history = json.dumps([])
    db.session.commit()
    logging.info(f"[DELETE ALL] History AFTER: {user.notification_history}")
    # Double-check by reloading from DB
    user_check = User.query.filter_by(username=username).first()
    logging.info(f"[DELETE ALL] History AFTER COMMIT (reloaded): {user_check.notification_history}")
    logging.info(f"[DELETE ALL] Notification history cleared for user: {username}")
    return jsonify({'success': True, 'message': 'All notifications deleted from history.', 'history': []})

# Endpoint to check for new notifications for polling
@app.route('/api/has-new-notifications', methods=['POST'])
@cross_origin()
def has_new_notifications():
    data = request.get_json(force=True)
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    has_new = False
    if user and user.notification_history:
        try:
            history = json.loads(user.notification_history)
            # Only count notifications that are not read and not dismissed
            has_new = any(not n.get('read', False) and not n.get('dismissed', False) for n in history if isinstance(n, dict))
        except Exception:
            has_new = False
    response = jsonify({'hasNew': has_new})
    response.headers.add('Access-Control-Allow-Origin', '*')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
    return response

# === Health & Diagnostics ===

# Paginated PDF list endpoint
@app.route('/list-pdfs/<folder_id>')
def list_pdfs(folder_id):
    try:
        # Get pagination params
        page = int(request.args.get('page', 1))
        page_size = int(request.args.get('page_size', 50))
        if page_size > 200:
            page_size = 200  # Prevent excessive memory usage
        offset = (page - 1) * page_size

        # Fetch PDFs from Google Drive folder
        service = get_drive_service()
        query = f"'{folder_id}' in parents and mimeType='application/pdf' and trashed=false"
        drive_files = []
        page_token = None
        while True:
            response = service.files().list(
                q=query,
                fields="nextPageToken, files(id, name, createdTime, modifiedTime)",
                pageSize=1000,
                pageToken=page_token
            ).execute()
            drive_files.extend(response.get('files', []))
            page_token = response.get('nextPageToken', None)
            if not page_token:
                break

        # Only list PDFs from Drive, do not sync to DB
        existing_books = {b.drive_id: b for b in Book.query.filter(Book.drive_id.in_([f['id'] for f in drive_files])).all()}

        # Paginate results from drive_files
        total_count = len(drive_files)
        paged_files = drive_files[offset:offset+page_size]
        pdf_list = []
        for f in paged_files:
            created_time = f.get('createdTime')
            modified_time = f.get('modifiedTime')
            pdf_list.append({
                'id': f['id'],
                'title': f.get('name', 'Untitled'),
                'createdTime': created_time,
                'modifiedTime': modified_time
            })
        mem = psutil.Process().memory_info().rss / (1024 * 1024)
        logging.info(f"[list-pdfs] Memory usage: {mem:.2f} MB for folder_id={folder_id}")
        return jsonify({
            'pdfs': pdf_list,
            'page': page,
            'page_size': page_size,
            'total_count': total_count,
            'has_more': offset + len(pdf_list) < total_count
        })
    except Exception as e:
        logging.error(f"Error in paginated /list-pdfs/: {e}")
        return jsonify({'error': 'Failed to list PDFs', 'details': str(e)}), 500

@app.route('/api/cover-queue-health', methods=['GET'])
def cover_queue_health():
    status = get_queue_status()
    return jsonify({
        'success': True,
        'active': status['active'],
        'queue_length': status['queue_length'],
        'queue': status['queue'],
        'sessions': status['sessions'],
    })

@app.route('/api/server-health', methods=['GET'])
def server_health():
    """
    Health check endpoint: verifies DB connectivity. Returns success: true if DB responds, else false.
    """
    try:
        # Simple DB query to test connection
        db.session.execute(text('SELECT 1'))
        return jsonify({'success': True})
    except Exception as e:
        logging.error(f"[server_health] DB health check failed: {e}")
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/health', methods=['GET'])
def health_check():
    """
    Health check endpoint for Render.com. Returns 200 OK and JSON status.
    Only log if status is not 200.
    """
    response = jsonify({'status': 'ok', 'message': 'Service is healthy.'})
    status_code = 200
    # Only log if status is not 200
    if status_code != 200:
        logging.info(f"[HEALTH CHECK] Status: {status_code} Response: {response.get_json()}")
    return response, status_code

@app.route('/api/cover-diagnostics', methods=['GET'])
def cover_diagnostics():
    covers_dir_files = os.listdir(COVERS_DIR)
    disk_covers = [fname for fname in covers_dir_files if fname.endswith('.jpg')]
    atlas = load_atlas()
    atlas_ids = list(atlas.keys())
    missing_on_disk = [bid for bid in atlas_ids if f"{bid}.jpg" not in disk_covers]
    extra_on_disk = [fname for fname in disk_covers if fname.replace('.jpg', '') not in atlas_ids]
    return jsonify({
        'covers_on_disk': disk_covers,
        'atlas_ids': atlas_ids,
        'missing_on_disk': missing_on_disk,
        'extra_on_disk': extra_on_disk,
        'atlas': atlas,
    })
# --- Manual Seed Endpoint ---
@app.route('/api/seed-drive-books', methods=['POST'])
def seed_drive_books():
    """
    Manually repopulate the Book table from all PDFs in the configured Google Drive folder.
    Returns: {success, added_count, skipped_count, errors}
    """
    try:
        data = request.get_json(silent=True) or {}
        folder_id = data.get('folder_id') or os.getenv('GOOGLE_DRIVE_FOLDER_ID')
        if not folder_id:
            return jsonify({'success': False, 'message': 'GOOGLE_DRIVE_FOLDER_ID not set.'}), 500
        service = get_drive_service()
        # List all PDFs in the folder
        query = f"'{folder_id}' in parents and mimeType='application/pdf' and trashed = false"
        files = []
        page_token = None
        while True:
            response = service.files().list(
                q=query,
                spaces='drive',
                fields='nextPageToken, files(id, name, createdTime, modifiedTime)',
                pageToken=page_token
            ).execute()
            files.extend(response.get('files', []))
            page_token = response.get('nextPageToken', None)
            if not page_token:
                break
        added_count = 0
        updated_count = 0
        external_id_updates = 0
        skipped_count = 0
        errors = []
        new_books = []
        updated_books = []
        logging.info(f"[Seed] Total files returned from Drive: {len(files)}")
        for idx, f in enumerate(files):
            drive_id = f.get('id')
            title = f.get('name')
            created_time = f.get('createdTime')
            modified_time = f.get('modifiedTime')
            logging.info(f"[Seed] Processing file {idx+1}/{len(files)}: drive_id={drive_id}, title={title}, created_time={created_time}, modified_time={modified_time}")
            try:
                book = Book.query.filter_by(drive_id=drive_id).first()
                if not book:
                    # New book: extract external_story_id
                    external_story_id = None
                    try:
                        file_request = service.files().get_media(fileId=drive_id)
                        file_content = file_request.execute()
                        external_story_id = extract_story_id_from_pdf(file_content)
                    except Exception as e:
                        logging.warning(f"[Seed] Error extracting story ID for {title}: {e}")
                        external_story_id = None
                    book = Book(
                        drive_id=drive_id,
                        title=title,
                        external_story_id=external_story_id,
                        version_history=None,
                        created_at=datetime.datetime.fromisoformat(created_time.replace('Z', '+00:00')) if created_time else datetime.datetime.now(datetime.UTC),
                        updated_at=datetime.datetime.fromisoformat(modified_time.replace('Z', '+00:00')) if modified_time else None
                    )
                    db.session.add(book)
                    added_count += 1
                    new_books.append({'id': drive_id, 'title': title})
                    logging.info(f"[Seed] Added new book: drive_id={drive_id}, title={title}")
                else:
                    # Existing book: update metadata if changed
                    updated = False
                    if book.title != title:
                        book.title = title
                        updated = True
                    if modified_time:
                        new_updated_at = datetime.datetime.fromisoformat(modified_time.replace('Z', '+00:00'))
                        if new_updated_at.tzinfo is None:
                            new_updated_at = new_updated_at.replace(tzinfo=datetime.timezone.utc)
                        if book.updated_at and book.updated_at.tzinfo is None:
                            book.updated_at = book.updated_at.replace(tzinfo=datetime.timezone.utc)
                        if not book.updated_at or book.updated_at < new_updated_at:
                            book.updated_at = new_updated_at
                            updated = True
                    if not book.external_story_id or not str(book.external_story_id).strip():
                        try:
                            file_request = service.files().get_media(fileId=drive_id)
                            file_content = file_request.execute()
                            external_story_id = extract_story_id_from_pdf(file_content)
                            if external_story_id:
                                book.external_story_id = external_story_id
                                external_id_updates += 1
                                updated = True
                        except Exception as e:
                            logging.warning(f"[Seed] Error extracting story ID for {title}: {e}")
                            errors.append(f"Error extracting story ID for {title}: {e}")
                    if updated:
                        updated_count += 1
                        updated_books.append({'id': drive_id, 'title': title})
                        logging.info(f"[Seed] Updated book: drive_id={drive_id}, title={title}")
            except Exception as e:
                skipped_count += 1
                errors.append(f"Error processing file {title} ({drive_id}): {e}")
                logging.error(f"[Seed] Skipped file due to error: drive_id={drive_id}, title={title}, error={e}")
        db.session.commit()
        # Use notification utility endpoints for new and updated books
        for book_info in new_books:
            try:
                notify_new_book(book_info['id'], book_info['title'])
            except Exception as e:
                errors.append(f"Error notifying new book {book_info['title']}: {e}")
        for book_info in updated_books:
            try:
                notify_book_update(book_info['id'], book_info['title'])
            except Exception as e:
                errors.append(f"Error notifying book update {book_info['title']}: {e}")

        # --- Cache covers for newest 20 and top voted books only ---
        # Get newest 20 books with their updated_at
        newest_books_full = Book.query.order_by(desc(Book.updated_at)).limit(20).all()
        logging.info("[Atlas] Newest books for cover cache:")
        for b in newest_books_full:
            logging.info(f"  drive_id={b.drive_id}, title={b.title}, updated_at={b.updated_at}")
        newest_books = [b.drive_id for b in newest_books_full]

        # Get voted books (top 10)
        voted_books_full = Book.query.join(Vote, Book.drive_id == Vote.book_id).group_by(Book.id).order_by(func.count(Vote.id).desc()).limit(10).all()
        logging.info("[Atlas] Top voted books for cover cache:")
        for b in voted_books_full:
            logging.info(f"  drive_id={b.drive_id}, title={b.title}, updated_at={b.updated_at}")
        voted_books = [b.drive_id for b in voted_books_full]

        cover_ids = set(newest_books + voted_books)
        logging.info(f"[Atlas] Final cover_ids for cache: {list(cover_ids)} (total: {len(cover_ids)})")
                # Rebuild cover cache for correct set
        logging.info(f"[Atlas][seed_drive_books] Starting batch cover cache for {len(cover_ids)} books.")
        try:
            cleanup_unused_covers(cover_ids)
            for book_id in cover_ids:
                logging.info(f"[Atlas][seed_drive_books] Processing cover for book_id={book_id}")
                filename = f"{book_id}.jpg"
                cover_path = os.path.join(COVERS_DIR, filename)
                cover_valid = False
                if os.path.exists(cover_path):
                    try:
                        with Image.open(cover_path) as img:
                            img.verify()
                        cover_valid = True
                        covers_map = load_atlas()
                        if book_id not in covers_map:
                            covers_map[book_id] = filename
                            save_atlas(covers_map)
                            logging.info(f"[Atlas][seed_drive_books] Added missing atlas mapping for {book_id}")
                        logging.info(f"[Atlas][seed_drive_books] Verified disk cover for {book_id} is valid JPEG.")
                    except Exception as e:
                        logging.warning(f"[Atlas][seed_drive_books] Disk cover for {book_id} exists but is invalid: {e}. Will re-extract.")
                        cover_valid = False
                if not cover_valid:
                    img = extract_cover_image_from_pdf(book_id)
                    if img is not None:
                        img.save(cover_path, format='JPEG', quality=70)
                        covers_map = load_atlas()
                        covers_map[book_id] = filename
                        save_atlas(covers_map)
                        logging.info(f"[Atlas][seed_drive_books] Extracted and cached cover for {book_id}")
                    else:
                        logging.warning(f"[Atlas][seed_drive_books] Failed to extract cover for {book_id}")
                else:
                    covers_map = load_atlas()
                    covers_map[book_id] = filename
                    save_atlas(covers_map)
                    logging.info(f"[Atlas][seed_drive_books] Mapping updated for {book_id}")
            logging.info(f"[Atlas][seed_drive_books] Finished batch cover cache for {len(cover_ids)} books.")
        except Exception as e:
            errors.append(f"Error rebuilding cover cache: {e}")

        return jsonify({
            'success': True,
            'added_count': added_count,
            'updated_count': updated_count,
            'external_id_updates': external_id_updates,
            'skipped_count': skipped_count,
            'errors': errors,
            'message': f"Seeded {added_count} new books, updated {updated_count} existing books, {external_id_updates} external IDs set."
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/simulate-cover-load', methods=['POST'])
def simulate_cover_load():
    """
    Simulate multiple users requesting covers at the same time for stress testing.
    POST data: {"file_ids": ["id1", "id2", ...], "num_users": 200, "concurrency": 20}
    """
    data = request.get_json(force=True)
    file_ids = data.get('file_ids', [])
    num_users = int(data.get('num_users', 200))
    concurrency = int(data.get('concurrency', 20))
    if not file_ids:
        return jsonify({'success': False, 'message': 'file_ids required'}), 400
    results = []
    start_time = time.time()
    # --- Attach FileHandler for simulation logging ---
    log_path = os.path.join(os.path.dirname(__file__), 'logs.txt')
    sim_handler = logging.FileHandler(log_path, mode='w', encoding='utf-8')
    sim_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    sim_handler.setFormatter(formatter)
    logging.getLogger().addHandler(sim_handler)
    # Save current handlers to restore later
    old_handlers = [h for h in logging.getLogger().handlers if h is not sim_handler]
    try:
        def simulate_user(user_idx):
            session_id = f"simuser-{user_idx}-{uuid.uuid4()}"
            file_id = random.choice(file_ids)
            url = f"http://localhost:{os.getenv('PORT', 5000)}/pdf-cover/{file_id}?session_id={session_id}"
            try:
                resp = requests.get(url, timeout=30)
                status = resp.status_code
                log_msg = f"[SIM] User {user_idx} session_id={session_id} file_id={file_id} status={status}"
                logging.info(log_msg)
                return {'user': user_idx, 'session_id': session_id, 'file_id': file_id, 'status': status}
            except Exception as e:
                logging.error(f"[SIM] User {user_idx} session_id={session_id} file_id={file_id} ERROR: {e}")
                return {'user': user_idx, 'session_id': session_id, 'file_id': file_id, 'error': str(e)}
        # Use ThreadPoolExecutor for concurrency
        with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = [executor.submit(simulate_user, i) for i in range(num_users)]
            for future in concurrent.futures.as_completed(futures):
                results.append(future.result())
        duration = time.time() - start_time
        mem = psutil.Process().memory_info().rss / (1024 * 1024)
        logging.info(f"[SIM] Simulated {num_users} users in {duration:.2f}s. Memory usage: {mem:.2f} MB")
    finally:
        # Remove simulation handler and restore previous handlers
        logging.getLogger().removeHandler(sim_handler)
        sim_handler.close()
    # --- Write simulation results to logs.txt (append) ---
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f"Simulated {num_users} users in {duration:.2f}s. Memory usage: {mem:.2f} MB\n")
    return jsonify({'success': True, 'results': results, 'duration': duration, 'memory': mem})

@app.route('/api/test-send-scheduled-notifications', methods=['POST'])
def test_send_scheduled_notifications():
    """
    Test endpoint to simulate scheduled notification emails for all users in batches.
    POST data: {"frequency": "daily"|"weekly"|"monthly", "batch_size": 20, "sleep_time": 2}
    """
    try:
        data = request.get_json()
        frequency = data.get('frequency', 'daily')
        batch_size = int(data.get('batch_size', 20))
        sleep_time = int(data.get('sleep_time', 2))
        # Compose subject and body for all users
        subject = f"Your {frequency.capitalize()} Notification Summary"
        body = f"This is your {frequency} notification summary from Storyweave Chronicles."
        send_scheduled_emails(subject, body, frequency, batch_size, sleep_time)
        return jsonify({'success': True, 'message': f'Scheduled notification emails sent in batches of {batch_size}.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e), 'trace': traceback.format_exc()}), 500

# === Webhooks & Integrations ===
@app.route('/api/drive-webhook', methods=['POST'])
def drive_webhook():
    channel_id = request.headers.get('X-Goog-Channel-ID')
    resource_id = request.headers.get('X-Goog-Resource-ID')
    resource_state = request.headers.get('X-Goog-Resource-State')
    changed = request.headers.get('X-Goog-Changed')
    logging.info(f"[Drive Webhook] Channel: {channel_id}, Resource: {resource_id}, State: {resource_state}, Changed: {changed}")

    # Only handle 'update' or 'add' events
    if resource_state in ['update', 'add']:
        try:
                service = get_drive_service()
                file = service.files().get(fileId=resource_id, fields='id, name, createdTime, modifiedTime').execute()
                book = Book.query.filter_by(drive_id=resource_id).first()
                if not book:
                    new_book = Book(
                        drive_id=file['id'],
                        title=file['name'],
                        created_at=file.get('createdTime'),
                        updated_at=file.get('modifiedTime')
                    )
                    db.session.add(new_book)
                    db.session.commit()
                    logging.info(f"Added new book to DB: {file['name']}")
                    notify_new_book(new_book.drive_id, new_book.title)
                else:
                    book.title = file['name']
                   
                    book.updated_at = file.get('modifiedTime')
                    db.session.commit()
                    logging.info(f"Updated book in DB: {file['name']}")
                    notify_book_update(book.drive_id, book.title)
        except Exception as e:
            logging.error(f"Error updating DB from webhook: {e}")
    return '', 200

# --- GitHub Webhook for App Update Notifications ---
@app.route('/api/github-webhook', methods=['POST'])
def github_webhook():
    """
    Receives GitHub webhook payload for push events and sends app update notifications to all users.
    """
    data = request.get_json()
    # Only handle push events
    if not data or data.get('ref') is None or 'commits' not in data:
        return jsonify({'success': False, 'message': 'Invalid payload.'}), 400
    repo = data.get('repository', {}).get('full_name', 'Unknown repo')
    branch = data.get('ref', '').split('/')[-1]
    commits = data.get('commits', [])
    commit_msgs = [c.get('message', '') for c in commits]
    committers = [c.get('committer', {}).get('name', '') for c in commits]
    summary = f"Site updated on branch '{branch}' in repo '{repo}'.\n"
    for i, msg in enumerate(commit_msgs):
        summary += f"- {msg} (by {committers[i]})\n"
    users = User.query.all()
    for user in users:
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if not prefs.get('muteAll', False) and prefs.get('announcements', True):
            add_notification(
                user,
                'appUpdate',
                'Site Updated!',
                summary,
                link='https://github.com/nixodemus1/storyweavechronicles/commits/main'
            )
    return jsonify({'success': True, 'message': 'App update notifications sent.'})
    # Add more moderation actions as needed

@app.route('/authorize')
def authorize():
    creds = service_account.Credentials.from_service_account_info(
        service_account_info,
        scopes=SCOPES
    )
    return redirect("/")

# === Static ===
@app.route("/")
def api_almanac():
    """
    Returns a JSON object listing all API endpoints and their descriptions.
    """
    endpoints = {
        # === Authentication & User Management ===
        "/api/register": "Register a new user (POST)",
        "/api/change-password": "Change user password (POST)",
        "/api/add-secondary-email": "Add a secondary email to user (POST)",
        "/api/remove-secondary-email": "Remove a secondary email from user (POST)",
        "/api/get-user": "Get user info (POST)",
        "/api/get-user-meta": "Get user metadata (GET)",
        # === Admin & Moderation ===
        "/api/admin/make-admin": "Make a user admin (POST, admin-only)",
        "/api/admin/remove-admin": "Remove admin rights (POST, admin-only)",
        "/api/admin/bootstrap-admin": "Bootstrap first admin if none exist (POST)",
        "/api/admin/send-emergency-email": "Send emergency email to all users (POST, admin-only)",
        "/api/admin/send-newsletter": "Send newsletter to all users (POST, admin-only)",
        "/api/admin/ban-user": "Ban a user (POST, admin-only)",
        "/api/admin/unban-user": "Unban a user (POST, admin-only)",
        "/api/moderate-comment": "Moderate a comment (POST, admin-only)",
        # === Book & PDF Management ===
        "/api/update-external-id": "Update external story ID for a book (POST)",
        "/api/rebuild-cover-cache": "Rebuild cover cache for books (POST)",
        "/api/books": "Get books by drive_id (GET)",
        "/api/all-books": "Get metadata for all books (GET)",
        "/api/cover-exists/<file_id>": "Check if cover exists for file_id (GET)",
        "/api/landing-page-book-ids": "Get book IDs for landing page (GET)",
        "/covers/<cover_id>.jpg": "Serve cover image from disk (GET)",
        "/api/cancel-session": "Cancel a session (POST)",
        "/pdf-cover/<file_id>": "Serve PDF cover image (GET)",
        "/api/pdf-text/<file_id>": "Extract text/images from a PDF page (GET)",
        # === Voting ===
        "/api/vote-book": "Vote for a book (POST)",
        "/api/book-votes": "Get votes for a book (GET)",
        "/api/top-voted-books": "Get top voted books (GET)",
        "/api/user-voted-books": "Get books voted by a user (GET)",
        "/api/user-top-voted-books": "Get user's top voted books (GET)",
        # === Bookmarks ===
        "/api/get-bookmarks": "Get bookmarks for a user (GET/POST)",
        "/api/add-bookmark": "Add a bookmark (POST)",
        "/api/remove-bookmark": "Remove a bookmark (POST)",
        "/api/update-bookmark-meta": "Update bookmark metadata (POST)",
        # === Comments ===
        "/api/add-comment": "Add a comment to a book (POST)",
        "/api/edit-comment": "Edit a comment (POST)",
        "/api/delete-comment": "Delete a comment (POST)",
        "/api/get-comments": "Get comments for a book (GET)",
        "/api/has-new-comments": "Check for new comments (POST)",
        "/api/vote-comment": "Upvote/downvote a comment (POST)",
        "/api/get-comment-votes": "Get votes for a comment (GET)",
        "/api/user-comments": "Get all comments by a user (GET)",
        # === Notifications ===
        "/api/get-notification-prefs": "Get notification preferences (POST)",
        "/api/update-notification-prefs": "Update notification preferences (POST)",
        "/api/get-notification-history": "Get notification history (POST)",
        "/api/notification-history": "Notification history (GET, error)",
        "/api/notify-reply": "Send reply notification (POST)",
        "/api/notify-new-book": "Send new book notification (POST)",
        "/api/notify-book-update": "Send book update notification (POST)",
        "/api/notify-app-update": "Send app update notification (POST)",
        "/api/mark-all-notifications-read": "Mark all notifications as read (POST)",
        "/api/delete-notification": "Delete a notification (POST)",
        "/api/dismiss-all-notifications": "Dismiss all notifications (POST)",
        "/api/mark-notification-read": "Mark a notification as read/unread (POST)",
        "/api/delete-all-notification-history": "Delete all notification history (POST)",
        "/api/has-new-notifications": "Check for new notifications (POST)",
        # === Health & Diagnostics ===
        "/list-pdfs/<folder_id>": "List PDFs in a Google Drive folder (GET)",
        "/api/cover-queue-health": "Get cover queue health (GET)",
        "/api/server-health": "Check server health/DB connectivity (GET)",
        "/api/health": "Health check for Render.com (GET)",
        "/api/cover-diagnostics": "Diagnostics for cover images (GET)",
        "/api/seed-drive-books": "Manually repopulate Book table from Drive (POST)",
        "/api/simulate-cover-load": "Simulate concurrent cover requests (POST)",
        "/api/test-send-scheduled-notifications": "Test scheduled notification emails (POST)",
        # === Webhooks & Integrations ===
        "/api/drive-webhook": "Google Drive webhook for file changes (POST)",
        "/api/github-webhook": "GitHub webhook for app update notifications (POST)",
        "/authorize": "Google service account authorization (GET)",
        # === Static & Fallback ===
        "/": "API Almanac (GET, this endpoint)",
        "/<path:path>": "Serve React frontend or static files (GET)",
    }
    return jsonify({"endpoints": endpoints, "message": "Storyweave Chronicles Backend API Almanac"})

@app.route("/<path:path>")
def serve_react(path):
    # --- Environment detection ---
    is_production = os.getenv("RENDER") == "true" or os.getenv("FLASK_ENV") == "production" or os.getenv("PRODUCTION") == "true"
    # Use client/dist for production, client/public for development
    frontend_static_dir = os.getenv("FRONTEND_STATIC_DIR")
    if not frontend_static_dir:
        if is_production:
            frontend_static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "client", "dist"))
        else:
            frontend_static_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "client", "public"))

    # Covers directory: always relative to static dir
    covers_dir = os.path.join(frontend_static_dir, "covers")

    # 1. API route fallback: JSON 404
    if path.startswith("api/"):
        return jsonify({"success": False, "message": "API endpoint not found.", "hint": "See / for API Almanac."}), 404

    # 2. Serve cover images from disk if requested
    if path.startswith("covers/") and path.endswith(".jpg"):
        cover_id = path.split("/")[-1].replace(".jpg", "")
        cover_path = os.path.join(covers_dir, f"{cover_id}.jpg")
        if os.path.exists(cover_path):
            return send_from_directory(covers_dir, f"{cover_id}.jpg")
        else:
            return jsonify({"success": False, "message": f"Cover {cover_id}.jpg not found."}), 404

    # 3. Serve favicon.ico from frontend static dir (or vite.svg)
    if path == "favicon.ico":
        vite_svg_path = os.path.join(frontend_static_dir, "vite.svg")
        if os.path.exists(vite_svg_path):
            return send_from_directory(frontend_static_dir, "vite.svg")
        else:
            return jsonify({"success": False, "message": "vite.svg not found in frontend static directory."}), 404

    # 4. Serve static files (css, js, images) from frontend static dir
    static_extensions = [".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".json"]
    if any(path.endswith(ext) for ext in static_extensions):
        static_file_path = os.path.join(frontend_static_dir, path)
        if os.path.exists(static_file_path):
            return send_from_directory(frontend_static_dir, path)
        else:
            return jsonify({"success": False, "message": f"Static file {path} not found."}), 404

    # 5. Serve index.html for all other non-API routes (React SPA fallback)
    try:
        index_path = os.path.join(frontend_static_dir, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(frontend_static_dir, "index.html")
        else:
            return jsonify({"success": False, "message": "index.html not found in frontend static directory."}), 404
    except Exception as e:
        # 6. Render.com fallback: return helpful JSON if index.html missing
        return jsonify({"success": False, "message": "Frontend not found. This may be a Render.com deployment issue.", "error": str(e), "hint": "Check / for API Almanac."}), 404

@app.route('/<filename>')
def serve_static_file(filename):
    static_dir = os.path.join(os.path.dirname(__file__), '..', 'client', 'public')
    file_path = os.path.join(static_dir, filename)
    if os.path.exists(file_path):
        return send_from_directory(static_dir, filename)
    return jsonify({"message": f"Static file {filename} not found.", "success": False}), 404

# === Main ===
if __name__ == '__main__':
    # Register Google Drive webhook on startup
    try:
        folder_id = os.getenv('GOOGLE_DRIVE_FOLDER_ID')
        webhook_url = 'https://swcflaskbackend.onrender.com/api/drive-webhook'
        setup_drive_webhook(folder_id, webhook_url)
        logging.info("Google Drive webhook registered on startup.")
        logging.info("Tracemalloc started for memory tracking.")
    except Exception as e:
        logging.error(f"Failed to register Google Drive webhook: {e}")
    # Schedule daily/weekly/monthly email notifications at 8am, and daily new book check at 9am
    scheduler = BackgroundScheduler()
    scheduler.add_job(lambda: send_scheduled_emails('daily'), 'cron', hour=8)
    scheduler.add_job(lambda: send_scheduled_emails('weekly'), 'cron', day_of_week='mon', hour=8)
    scheduler.add_job(lambda: send_scheduled_emails('monthly'), 'cron', day=1, hour=8)
    # Change from hourly to daily for backup new book check
    scheduler.add_job(check_and_notify_new_books, 'cron', hour=9)
    # Add scheduled job to call seed-drive-books endpoint daily at 10am
    scheduler.add_job(call_seed_drive_books, 'cron', hour=10)
    scheduler.start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=os.getenv("DEBUG", True))