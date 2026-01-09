"""
Storyweave Chronicles Backend API
Main server module.
"""
# =========================
# 1. Imports
# =========================
# --- Standard Library Imports ---
import tracemalloc
import csv
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
from datetime import timezone
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
from PIL import Image
from dotenv import load_dotenv
from apscheduler.schedulers.background import BackgroundScheduler
from flask import (
    Flask, jsonify, send_file, redirect, send_from_directory,
    make_response, request
)
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS, cross_origin
from flask_mail import Mail, Message
from flask_restx import Api, Namespace, Resource, fields
from sqlalchemy import desc, func, text
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.oauth2 import service_account
import dateutil.parser
from google.auth import jwt
from google.auth.transport.requests import Request
from google.oauth2 import id_token

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
api = Api(app, title="Storyweave Chronicles API", version="3.0", description="API documentation for Storyweave Chronicles")  # Swagger UI will be at /docs
auth_ns = Namespace('auth', description='Authentication and user management')
admin_ns = Namespace('admin', description='Admin and moderation')
books_ns = Namespace('books', description='Book and PDF management')
votes_ns = Namespace('votes', description='Voting endpoints')
comments_ns = Namespace('comments', description='Comments and discussion')
notifications_ns = Namespace('notifications', description='Notifications and alerts')
health_ns = Namespace('health', description='Health and diagnostics')
integrations_ns = Namespace('integrations', description='Webhooks and integrations')
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

# Build a safe CORS origins list. Use env vars when available so dev/prod frontends
# can be added without editing code. Note: missing commas can accidentally
# concatenate strings (causing wrong origin values) — include an explicit list.
frontend_base = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5173')
dev_frontend = os.getenv('DEV_FRONTEND_URL', 'http://localhost:5000')
allowed_origins = [
    frontend_base,
    dev_frontend,
    'https://dev-swc-backend.onrender.com',
    'https://dev-swc-backend-1v2c.onrender.com',
    'https://storyweavechronicles.onrender.com',
    'https://swcflaskbackend.onrender.com'
]

# Build a normalized set for runtime comparisons and log allowed origins for debugging
# If DEBUG is enabled, ensure the common Vite dev origin is present so local dev frontends
# (served at http://localhost:5173) can be matched even when .env.FRONTEND_BASE_URL points elsewhere.
is_debug = os.getenv('DEBUG', 'True').lower() == 'true'
vite_dev_origin = 'http://localhost:5173'
if is_debug and vite_dev_origin not in allowed_origins:
    # keep the explicit dev origin at the end of the list
    allowed_origins.append(vite_dev_origin)
    logging.info(f"CORS debug: added vite dev origin {vite_dev_origin} to allowed_origins")

# During development on Render we sometimes run frontend and backend on different
# render subdomains (for example dev-swc-backend.onrender.com vs
# dev-swc-backend-1v2c.onrender.com). To make local/dev testing smoother we
# optionally allow any origin under the onrender.com domain while DEBUG is true.
allow_onrender_wildcard = os.getenv('ALLOW_ONRENDER_WILDCARD', 'True').lower() == 'true'
if is_debug and allow_onrender_wildcard:
    logging.info('CORS debug: ALLOW_ONRENDER_WILDCARD enabled; allowing *.onrender.com origins at runtime')

# Normalize allowed origins (strip whitespace, remove trailing slash, lowercase)
normalized_allowed_origins = set(o.strip().rstrip('/').lower() for o in allowed_origins if o)
# Log the raw and normalized lists using repr to make hidden characters visible during debugging
logging.info(f"CORS allowed origins: {[repr(a) for a in allowed_origins]}")
logging.info(f"CORS normalized allowed origins: {[repr(a) for a in sorted(list(normalized_allowed_origins))]}")

CORS(app, origins=allowed_origins, supports_credentials=True, allow_headers="*", methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"])
mail = Mail(app)


service_account_info = {
    "type": "service_account",
    "project_id": os.getenv("GOOGLE_PROJECT_ID"),
    "private_key_id": os.getenv("GOOGLE_PRIVATE_KEY_ID"),
    # Normalize the private key: accept either literal \n sequences or real newlines,
    # and strip any surrounding quotes that might be present when loading from .env.
    "private_key": (os.getenv("GOOGLE_PRIVATE_KEY") or '').replace('\\n', '\n').replace('"', '').strip(),
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

# Log to both console and logs.txt
LOG_FILE_PATH = os.path.join(os.path.dirname(__file__), 'logs.txt')
log_formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')

root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Console handler
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
root_logger.addHandler(console_handler)

# File logging toggle based on .env/config
ENABLE_FILE_LOGGING = os.getenv('ENABLE_FILE_LOGGING', 'True') == 'True'
DEBUG_MODE = os.getenv('DEBUG', 'True') == 'True'
if ENABLE_FILE_LOGGING and DEBUG_MODE:
    file_handler = logging.handlers.RotatingFileHandler(LOG_FILE_PATH, maxBytes=5*1024*1024, backupCount=2, encoding='utf-8')
    file_handler.setFormatter(log_formatter)
    root_logger.addHandler(file_handler)

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
atlas_init_lock = threading.Lock()

ATLAS_INITIALIZED = False  # C0103: UPPER_CASE naming style

# --- Fair Queuing for Cover Requests ---
cover_request_queue = deque()  # Each entry: file_id (str)
cover_queue_lock = threading.Lock()

# --- Fair Queuing for Text Requests ---
text_request_queue = deque()  # Each entry: {session_id, file_id, page_num, timestamp}
text_queue_lock = threading.Lock()
TEXT_QUEUE_ACTIVE = None  # C0103: UPPER_CASE naming style
TEXT_QUEUE_LAST_CLEANUP = 0
# =========================
# 5. Database Models
# =========================
# --- SQLAlchemy models: Book, User, Vote, Comment, Webhook ---

class Book(db.Model):
    """SQLAlchemy Book Model"""
    id = db.Column(db.Integer, primary_key=True)
    drive_id = db.Column(db.String(128), unique=True, nullable=False)  # Google Drive file ID
    title = db.Column(db.String(256), nullable=False)
    external_story_id = db.Column(db.String(128), nullable=True)  # e.g. 'goodreads 2504839'
    version_history = db.Column(db.Text, nullable=True)  # JSON string of version info
    created_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(timezone.utc))
    updated_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(timezone.utc), onupdate=lambda: datetime.datetime.now(timezone.utc))

    # Relationships
    comments = db.relationship('Comment', backref='book', lazy=True, foreign_keys='Comment.book_id')
    votes = db.relationship('Vote', backref='book', lazy=True, foreign_keys='Vote.book_id')

class User(db.Model):
    """SQLAlchemy User Model"""
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

class Vote(db.Model):
    """SQLAlchemy Voting Model"""
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    book_id = db.Column(db.String(128), db.ForeignKey('book.drive_id'), nullable=False)
    value = db.Column(db.Integer, nullable=False)  # 1-5 stars
    timestamp = db.Column(db.DateTime, default=lambda: datetime.datetime.now(timezone.utc))

class Comment(db.Model):
    """SQLAlchemy Comment Model"""
    id = db.Column(db.Integer, primary_key=True)
    book_id = db.Column(db.String(128), db.ForeignKey('book.drive_id'), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    parent_id = db.Column(db.Integer, nullable=True)  # null for top-level
    text = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=lambda: datetime.datetime.now(timezone.utc))
    edited = db.Column(db.Boolean, default=False)
    upvotes = db.Column(db.Integer, default=0)
    downvotes = db.Column(db.Integer, default=0)
    deleted = db.Column(db.Boolean, default=False)  # for moderation
    background_color = db.Column(db.String(16), nullable=True)
    text_color = db.Column(db.String(16), nullable=True)

class Webhook(db.Model):
    """SQLAlchemy Webhook Model"""
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.String(128), unique=True, nullable=False)
    expiration = db.Column(db.BigInteger, nullable=True)  # ms since epoch
    registered_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(timezone.utc))

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
def get_cover_url(file_id):
    """Returns the public URL for a cover image, using FRONTEND_BASE_URL from .env."""
    base_url = os.getenv('FRONTEND_BASE_URL', 'http://localhost:5173')
    return f"{base_url}/api/covers/{file_id}.jpg"

def safe_get_json(default=None):
        """Return request JSON parsed safely.

        Behavior:
        - In DEBUG/dev (is_debug == True) the parser is silent (silent=True) so fuzzers with
            empty/malformed bodies do not raise and we can return a controlled default.
        - In production (is_debug == False) we intentionally do not silence JSON errors so
            invalid JSON will raise and surface a useful stacktrace for debugging.

        Returns parsed JSON or `default` when parsing returns None.
        """
        # request.get_json will raise when silent=False and JSON is invalid; that's desired in prod
        parsed = request.get_json(silent=is_debug)
        return parsed if parsed is not None else default

def load_atlas():
    """Load the atlas.json file and return the covers mapping. Retries up to 3 times on error."""
    if not os.path.exists(ATLAS_PATH):
        return {}
    for attempt in range(3):
        try:
            with open(ATLAS_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('covers', {})
        except (json.JSONDecodeError, FileNotFoundError, OSError) as e:
            logging.error(f"[Atlas] Failed to load atlas.json (attempt {attempt+1}): {e}")
            time.sleep(0.05)
    return {}

def save_atlas(covers_map):
    """Save the covers mapping to atlas.json atomically."""
    try:
        # Write to a temp file first, then atomically replace atlas.json
        dir_name = os.path.dirname(ATLAS_PATH)
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=dir_name, delete=False) as tf:
            json.dump({'covers': covers_map}, tf, indent=2)
            tempname = tf.name
        shutil.move(tempname, ATLAS_PATH)
        logging.info("[Atlas][save] Atlas saved with %d entries: %s", len(covers_map), list(covers_map.keys()))
    except (OSError, IOError) as e:
        logging.error("[Atlas] Failed to save atlas.json: %s", e)

def cleanup_unused_covers(valid_ids, needed_ids):
    """Remove unused cover images from disk and update atlas.json."""
    covers_map = load_atlas()
    covers_dir_files = os.listdir(COVERS_DIR)
    logging.info("[DIAGNOSTIC][COVERS] [cleanup_unused_covers] Covers folder BEFORE: %s", covers_dir_files)
    # Build set of actual cover IDs on disk
    disk_cover_ids = set()
    for fname in covers_dir_files:
        if fname.endswith('.jpg'):
            disk_cover_ids.add(fname[:-4])
    logging.info("[Atlas][cleanup_unused_covers] Disk cover IDs: %s", disk_cover_ids)
    if not cleanup_covers_lock.acquire(blocking=False):
        logging.warning("[Atlas][cleanup_unused_covers] Cleanup already running, skipping duplicate call.")
        return []
    try:
        removed = []
        valid_ids = set(str(i).strip() for i in valid_ids) if valid_ids else set()
        needed_ids = set(str(i).strip() for i in needed_ids) if needed_ids else set()
        logging.info("[Atlas][cleanup_unused_covers] Incoming valid_ids: %s", valid_ids)
        logging.info("[Atlas][cleanup_unused_covers] Incoming needed_ids: %s", needed_ids)
        # Only remove covers that are not needed
        to_remove = disk_cover_ids - needed_ids
        logging.info("[Atlas][cleanup_unused_covers] Covers to remove (not needed): %s", to_remove)
        for book_id in to_remove:
            cover_path = os.path.join(COVERS_DIR, f"{book_id}.jpg")
            try:
                logging.info("[DIAGNOSTIC][DELETE] Attempting to delete cover file: %s (book_id=%s)", cover_path, book_id)
                if os.path.exists(cover_path):
                    os.remove(cover_path)
                    removed.append(book_id)
                    logging.info("[DIAGNOSTIC][DELETE] Deleted unused cover: %s", cover_path)
                else:
                    logging.warning("[DIAGNOSTIC][DELETE] Tried to delete missing cover file: %s", cover_path)
            except OSError as e:
                logging.error("[DIAGNOSTIC][DELETE] Error deleting cover file %s: %s", cover_path, e)
        # Update atlas: keep only valid and needed covers
        covers_map = {bid: fname for bid, fname in covers_map.items() if bid in valid_ids and bid in needed_ids}
        save_atlas(covers_map)
        covers_dir_files_after = os.listdir(COVERS_DIR)
        logging.info("[DIAGNOSTIC][COVERS] [cleanup_unused_covers] Covers folder AFTER: %s", covers_dir_files_after)
        logging.info("[Atlas][cleanup_unused_covers] Final covers_map after deletion: %s", covers_map)
        logging.info("[Atlas] Cleaned up unused covers: %s", removed)
    finally:
        cleanup_covers_lock.release()

def get_landing_page_book_ids():
    """Return a list of book IDs for the landing page (carousel + top voted)."""
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
    """Extract cover image for a given book_id from its PDF in Google Drive."""

    process = psutil.Process()
    MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
    MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))

    for _ in range(3):
        gc.collect()
    mem_start = process.memory_info().rss / (1024 * 1024)
    cpu_start = process.cpu_percent(interval=0.1)
    logging.info(f"[extract_cover_image_from_pdf] GC BEFORE: book_id={book_id}, RAM={mem_start:.2f} MB, CPU={cpu_start:.2f}%")

    # Removed unused variable initializations (img, doc, page, pix)
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
        try:
            request_drive = service.files().get_media(fileId=book.drive_id)
            pdf_bytes = request_drive.execute()
        except Exception as e:
            logging.error(f"[extract_cover_image_from_pdf] Drive get_media failed for {book.drive_id}: {e}")
            # Avoid raising: return None so caller can handle missing cover
            return None
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
        except Exception as e:  # Rendering can fail for many reasons (PyMuPDF, PIL, etc.)
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
            except Exception as e:  # Embedded image extraction can fail for many reasons
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

    except Exception as e:  # Catch-all for PDF/image extraction errors
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
    """Rebuild atlas and cache covers for provided book_ids (landing page), or fallback to DB if not provided."""
    if book_ids is None:
        book_ids = get_landing_page_book_ids()
        logging.info(f"[Atlas][rebuild_cover_cache] Starting rebuild for book_ids: {book_ids}")
    covers_map_before = load_atlas()
    covers_dir_files_before = os.listdir(COVERS_DIR)
    logging.info("[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder BEFORE: %s", covers_dir_files_before)
    logging.info("[Atlas][rebuild_cover_cache] covers_map BEFORE cleanup: %s", covers_map_before)
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
    logging.info("[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder AFTER cleanup: %s", covers_dir_files_after_cleanup)
    logging.info("[Atlas][rebuild_cover_cache] covers_map AFTER cleanup: %s", covers_map_after_cleanup)
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
    logging.info("[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder FINAL: %s", covers_dir_files_final)
    logging.info("[Atlas][rebuild_cover_cache] covers_map FINAL: %s", covers_map_final)
    logging.info("[Atlas][rebuild_cover_cache] Covers in cache after rebuild: %s", list(covers_map_final.keys()))
    logging.info("[Atlas][rebuild_cover_cache] Rebuilt cover cache for %d books.", len(book_ids))

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
        logging.info("[DIAGNOSTIC][COVERS] [rebuild_cover_cache] Covers folder AFTER cache size limit: %s", covers_dir_files_after_limit)

    # Return tuple: (success, missing_ids)
    if missing:
        logging.error(f"[Atlas][rebuild_cover_cache] Missing covers after rebuild: {missing}")
        return False, missing
    return True, []

def sync_atlas_with_covers():
    """Scan the covers folder and rebuild atlas.json to match the actual .jpg files on disk."""
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

def is_admin(username):
    """Check if a user is admin."""
    user = User.query.filter_by(username=username).first()
    return user and user.is_admin

def hash_password(password):
    """Hash a password using SHA256."""
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

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
    """Clean up stale sessions from the text request queue."""
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
        global TEXT_QUEUE_ACTIVE
        if TEXT_QUEUE_ACTIVE and TEXT_QUEUE_ACTIVE['session_id'] in to_remove:
            TEXT_QUEUE_ACTIVE = None
        # Only log if something was removed
        if to_remove:
            logging.info(f"[cleanup_text_queue] Removed {len(to_remove)} stale sessions from queue.")
    except Exception as e:
        logging.error(f"[cleanup_text_queue] Error: {e}")

def get_text_queue_status():
    """Get status of the text queue."""
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
            'active': TEXT_QUEUE_ACTIVE,
            'queue': list(text_request_queue),
            'queue_length': len(text_request_queue),
            'sessions': list(session_last_seen.keys()),
        }
    finally:
        text_queue_lock.release()

def heartbeat(session_id):
    """Update the last seen timestamp for a session."""
    session_last_seen[session_id] = time.time()

def cleanup_cover_queue():
    """Clear the cover request queue."""
    with cover_queue_lock:
        cover_request_queue.clear()
    logging.info("[cleanup_cover_queue] Cover queue cleared.")

def get_queue_status():
    """Get status of the cover queue."""
    with cover_queue_lock:
        return {
            'active': cover_request_queue[0] if cover_request_queue else None,
            'queue': list(cover_request_queue),
            'queue_length': len(cover_request_queue),
            'sessions': list(session_last_seen.keys()),
        }
#--- Notification & Email ---

def send_notification_email(user, subject, body, notifications=None):
    """Send notification email to a user with a list of notifications using Flask-Mail SMTP.

    notifications: optional list of notification dicts (each with 'title' and 'body').
    Older call sites pass only (user, subject, body) so we accept None and treat as empty list.
    """
    if not user or not getattr(user, 'email', None):
        logging.warning(f"User {getattr(user, 'id', '<unknown>')} has no email address. Skipping email send.")
        return False

    notifications = notifications or []
    try:
        notifications_list = "\n".join(
            [f"- {n.get('title', '')}: {n.get('body', '')}" for n in notifications]
        )
    except Exception:
        # Defensive: if notifications is not iterable or items lack expected keys
        notifications_list = ''

    full_body = f"{body}\n\nNotifications:\n{notifications_list}" if notifications_list else body

    try:
        msg = Message(
            subject,
            sender=os.getenv('MAIL_USERNAME'),
            recipients=[user.email],
            body=full_body
        )
        mail.send(msg)
        logging.info(f"[SMTP] Sent email to {user.email} with subject '{subject}'")
        return True
    except Exception as e:
        logging.error(f"[SMTP] Failed to send email to {user.email}: {e}")
        return False

def send_scheduled_emails(frequency):
    """
    Send scheduled emails using Flask-Mail SMTP.
    :param frequency: 'daily', 'weekly', or 'monthly'
    """
    try:
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

                        msg = Message(
                            subject,
                            sender=os.getenv('MAIL_USERNAME'),
                            recipients=[user.email],
                            body=body
                        )
                        mail.send(msg)
                        logging.info(f"[SMTP] Sent {len(unread)} notifications to {user.email} for {frequency} summary.")

                        # Optionally mark as read after sending
                        for n in history:
                            if not n.get('read'):
                                n['read'] = True
                        user.notification_history = json.dumps(history)
                        db.session.commit()
    except Exception as e:
        logging.error(f"Error sending {frequency} emails: {e}")

def add_notification(user, type_, title, body, link=None, send_email=True):
    """Add a notification to a user.

    Returns the created notification dict.

    send_email: if True (default) and the user's prefs indicate immediate emails, an email will be sent.
    If False, the caller may choose to send the email explicitly (useful to include exact notification data in the email body).
    """
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
        if send_email and prefs.get('emailFrequency', 'immediate') == 'immediate':
            # Preserve previous behavior by sending the email when requested
            send_notification_email(user, title, body, [notification])
    return notification

def call_seed_drive_books():
    """Call the seed-drive-books endpoint."""
    try:
        url = os.getenv('VITE_HOST_URL', 'http://localhost:5000') + '/api/seed-drive-books'
        response = requests.post(url, timeout=10)  # W3101: Add timeout
        logging.info("Scheduled seed-drive-books response: %s %s", response.status_code, response.text)
    except Exception as e:
        logging.error("Error calling seed-drive-books endpoint: %s", e)

def check_and_notify_new_books():
    """Check for new books and notify users."""
    with app.app_context():
        try:
            # Set your Google Drive folder ID here (or load from env)
            folder_id = os.getenv('DRIVE_BOOKS_FOLDER_ID')
            if not folder_id:
                logging.warning('No DRIVE_BOOKS_FOLDER_ID set in environment.')
                return
            service = get_drive_service()
            query = f"'{folder_id}' in parents and mimeType='application/pdf'"
            try:
                results = service.files().list(q=query, fields="files(id, name, createdTime, modifiedTime)").execute()
            except Exception as e:
                logging.error(f"[check_and_notify_new_books] Drive files().list failed for query={query}: {e}")
                return
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
                except Exception as e:
                    logging.error(f"[check_and_notify_new_books] Failed to download/extract PDF for {f.get('id')}: {e}")
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

# --- Google Drive API ---

def get_drive_service():
    """Get Google Drive service."""
    # Build credentials from service_account_info; provide clearer errors when missing
    try:
        # Quick sanity checks for common missing values
        pk = service_account_info.get('private_key')
        client_email = service_account_info.get('client_email')
        project_id = service_account_info.get('project_id')
        if not pk:
            raise ValueError('GOOGLE_PRIVATE_KEY missing or empty')
        if not client_email:
            raise ValueError('GOOGLE_CLIENT_EMAIL missing')
        creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
        return build('drive', 'v3', credentials=creds)
    except Exception as e:
        logging.error(f"[get_drive_service] Failed to build Drive service: {e}")
        raise

def setup_drive_webhook(folder_id, webhook_url):
    """Setup Google Drive webhook."""
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
                try:
                    response = service.files().watch(fileId=folder_id, body=body).execute()
                except Exception as e:
                    logging.error(f"Failed to register Google Drive webhook for folder {folder_id}: {e}")
                    response = {}
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

# =========================
# 8. App Hooks
# =========================
# Explicitly handle OPTIONS preflight requests early so we always return proper
# CORS headers for preflight checks (avoids gateway/proxy responses that lack ACAO).
@app.before_request
def handle_preflight():
    if request.method == 'OPTIONS':
        origin = request.headers.get('Origin')
        # Build a minimal response and let add_cors_diagnostics attach headers
        resp = make_response(('', 200))
        return resp

@app.before_request
def check_atlas_init():
    """Initialize atlas on first API request."""
    global ATLAS_INITIALIZED
    # Only initialize once. Use a non-blocking lock so concurrent incoming requests
    # don't spawn multiple rebuilds during startup (causes churn/deletes).
    if not ATLAS_INITIALIZED and request.path.startswith('/api/'):
        acquired = atlas_init_lock.acquire(blocking=False)
        if not acquired:
            # Another request is handling initialization — skip here.
            logging.info('[Atlas][init] Initialization already in progress by another request; skipping.')
            return
        try:
            # Double-check after acquiring lock
            if not ATLAS_INITIALIZED:
                try:
                    sync_atlas_with_covers()
                    rebuild_cover_cache()
                    ATLAS_INITIALIZED = True
                    logging.info('[Atlas][init] Atlas initialization complete.')
                except Exception as e:
                    logging.error('[Atlas] Error during first-load rebuild: %s', e)
        finally:
            try:
                atlas_init_lock.release()
            except RuntimeError:
                # In case lock was not held for some reason, ignore release errors
                pass


# Runtime CORS diagnostics: log incoming Origin and ensure ACAO header for allowed origins
@app.after_request
def add_cors_diagnostics(response):
    try:
        origin = request.headers.get('Origin')
        # Log origin and request path for diagnostics. Use repr() so invisible characters are visible.
        logging.info(f"[CORS][DIAGNOSTIC] Incoming request from Origin={repr(origin)} Path={request.path}")
        if origin:
            # Normalize origin (strip whitespace, remove trailing slash, lowercase)
            origin_norm = origin.strip().rstrip('/').lower()
            # Show normalized allowed origins as reprs for easier diffing (print at INFO so it appears in logs)
            logging.info(f"[CORS][DIAGNOSTIC] Normalized allowed origins: {[repr(a) for a in sorted(list(normalized_allowed_origins))]}")
            # Allow if origin explicitly listed OR (debug + onrender wildcard matches)
            allowed_by_list = origin_norm in normalized_allowed_origins
            allowed_by_onrender = is_debug and allow_onrender_wildcard and origin_norm.endswith('.onrender.com')
            if allowed_by_list or allowed_by_onrender:
                response.headers['Access-Control-Allow-Origin'] = origin
                response.headers['Access-Control-Allow-Credentials'] = 'true'
                # Allow common preflight headers/methods as well
                response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
                response.headers['Access-Control-Allow-Headers'] = request.headers.get('Access-Control-Request-Headers', '*')
                logging.info(f"[CORS][DIAGNOSTIC] Allowed origin: {repr(origin)} (normalized: {origin_norm}) by_list={allowed_by_list} by_onrender={allowed_by_onrender}")
            else:
                # Not allowed origin — log for debugging (do not set ACAO)
                logging.warning(f"[CORS][DIAGNOSTIC] Blocked origin: {repr(origin)} (normalized: {origin_norm})")
        else:
            logging.info("[CORS][DIAGNOSTIC] No Origin header on request.")
    except Exception as e:
        logging.error(f"[CORS][DIAGNOSTIC] Error in add_cors_diagnostics: {e}")
    return response
# =========================

# === Authentication & User Management ===
# Update font and timezone for user
@auth_ns.route('/update-profile-settings')
@auth_ns.expect(api.model('UpdateProfileSettings', {
    'username': fields.String(required=True, description='Username'),
    'font': fields.String(required=False, description='Font name'),
    'timezone': fields.String(required=False, description='Timezone identifier'),
    'comments_page_size': fields.Integer(required=False, description='Comments page size (1-20)')
}), validate=False)
class UpdateProfileSettings(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        font = data.get('font')
        timezone = data.get('timezone')
        comments_page_size = data.get('comments_page_size')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

@auth_ns.route('/update-colors')
@auth_ns.expect(api.model('UpdateColors', {
    'username': fields.String(required=True, description='Username'),
    'backgroundColor': fields.String(required=True, description='Background color hex or name'),
    'textColor': fields.String(required=True, description='Text color hex or name')
}), validate=False)
class UpdateColors(Resource):
    def post(self):
        data = request.get_json(force=True)
        username = data.get('username')
        background_color = data.get('backgroundColor')
        text_color = data.get('textColor')
        if not username or not background_color or not text_color:
            response = make_response(jsonify({'success': False, 'message': 'Missing required fields.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        try:
            user.background_color = background_color
            user.text_color = text_color
            db.session.commit()
            comments = Comment.query.filter_by(username=username).all()
            for comment in comments:
                comment.background_color = background_color
                comment.text_color = text_color
            db.session.commit()
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
            response = make_response(jsonify({'success': False, 'message': str(e)}))
            response.status_code = 500
            return response

@auth_ns.route('/export-account')
@auth_ns.expect(api.model('ExportAccountRequest', {
    'username': fields.String(required=True, description='Username')
}), validate=False)
class ExportAccount(Resource):
    def post(self):
        data = request.get_json(force=True)
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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


@auth_ns.route('/import-account')
@auth_ns.expect(api.model('ImportAccountRequest', {
    'username': fields.String(required=True, description='Username'),
    'account': fields.Raw(required=True, description='Account JSON object to import')
}), validate=False)
class ImportAccount(Resource):
    def post(self):
        data = request.get_json(force=True)
        username = data.get('username')
        account = data.get('account')
        user = User.query.filter_by(username=username).first()
        if not user or not account:
            response = make_response(jsonify({'success': False, 'message': 'User not found or invalid data.'}))
            response.status_code = 400
            return response
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


@auth_ns.route('/login')
@auth_ns.expect(api.model('LoginRequest', {
    'username': fields.String(required=True, description='Username or email'),
    'password': fields.String(required=True, description='Password')
}), validate=False)
class Login(Resource):
    def post(self):
        data = request.get_json()
        identifier = data.get('username')
        password = data.get('password')
        if not identifier or not password:
            response = make_response(jsonify({'success': False, 'message': 'Username/email and password required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=identifier).first()
        if not user:
            user = User.query.filter_by(email=identifier).first()
        if not user or user.password != hash_password(password):
            response = make_response(jsonify({'success': False, 'message': 'Invalid username/email or password.'}))
            response.status_code = 401
            return response
        if user.banned:
            response = make_response(jsonify({'success': False, 'message': 'Your account has been banned.'}))
            response.status_code = 403
            return response
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

@auth_ns.route('/register')
@auth_ns.expect(api.model('RegisterRequest', {
    'username': fields.String(required=True, description='Desired username'),
    'email': fields.String(required=True, description='Email address'),
    'password': fields.String(required=True, description='Password'),
    'backgroundColor': fields.String(required=False, description='Preferred background color hex or name'),
    'textColor': fields.String(required=False, description='Preferred text color hex or name')
}), validate=False)
class Register(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        email = data.get('email')
        password = data.get('password')
        backgroundColor = data.get('backgroundColor')
        textColor = data.get('textColor')
        if not username or not email or not password:
            response = make_response(jsonify({'success': False, 'message': 'Username, email, and password required.'}))
            response.status_code = 400
            return response
        if User.query.filter_by(username=username).first():
            response = make_response(jsonify({'success': False, 'message': 'Username already exists.'}))
            response.status_code = 400
            return response
        if User.query.filter_by(email=email).first():
            response = make_response(jsonify({'success': False, 'message': 'Email already registered.'}))
            response.status_code = 400
            return response
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
        # Create the welcome notification but do not auto-send email here; we'll send with exact notification data
        welcome_notification = add_notification(
            user,
            'announcement',
            'Welcome to Storyweave Chronicles!',
            'Thank you for registering. Explore stories, bookmark your favorites, and join the community!',
            link='/',
            send_email=False
        )
        # Send welcome email and include the created notification so the email body matches the in-app notification
        send_notification_email(
            user,
            'Welcome to Storyweave Chronicles!',
            f"Welcome to the site! You can read stories, bookmark your favorites, and join the community discussion. Hope you have a great time!\n\nYour account info:\nUsername: {user.username}\nEmail: {user.email}\n",
            [welcome_notification] if welcome_notification else []
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

@auth_ns.route('/change-password')
@auth_ns.expect(api.model('ChangePasswordRequest', {
    'username': fields.String(required=True, description='Username'),
    'currentPassword': fields.String(required=True, description='Current password'),
    'newPassword': fields.String(required=True, description='New password')
}), validate=False)
class ChangePassword(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        current_password = data.get('currentPassword')
        new_password = data.get('newPassword')
        if not username or not current_password or not new_password:
            response = make_response(jsonify({'success': False, 'message': 'All fields are required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        if user.password != hash_password(current_password):
            response = make_response(jsonify({'success': False, 'message': 'Current password is incorrect.'}))
            response.status_code = 401
            return response
        user.password = hash_password(new_password)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Password changed successfully.'})

@auth_ns.route('/add-secondary-email')
@auth_ns.expect(api.model('AddSecondaryEmailRequest', {
    'username': fields.String(required=True, description='Username'),
    'email': fields.String(required=True, description='Secondary email to add')
}), validate=False)
class AddSecondaryEmail(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        new_email = data.get('email')
        if not username:
            response = make_response(jsonify({'success': False, 'message': 'Username required.'}))
            response.status_code = 400
            return response
        if not new_email:
            response = make_response(jsonify({'success': False, 'message': 'Email required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        secondary = json.loads(user.secondary_emails) if user.secondary_emails else []
        if new_email == user.email or new_email in secondary:
            response = make_response(jsonify({'success': False, 'message': 'Email already associated with account.'}))
            response.status_code = 400
            return response
        if User.query.filter_by(email=new_email).first():
            response = make_response(jsonify({'success': False, 'message': 'Email already registered to another account.'}))
            response.status_code = 400
            return response
        secondary.append(new_email)
        user.secondary_emails = json.dumps(secondary)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Secondary email added.', 'secondaryEmails': secondary})

@auth_ns.route('/remove-secondary-email')
@auth_ns.expect(api.model('RemoveSecondaryEmailRequest', {
    'username': fields.String(required=True, description='Username'),
    'email': fields.String(required=True, description='Secondary email to remove')
}), validate=False)
class RemoveSecondaryEmail(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        email_to_remove = data.get('email')
        if not username or not email_to_remove:
            response = make_response(jsonify({'success': False, 'message': 'Username and email required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        secondary = json.loads(user.secondary_emails) if user.secondary_emails else []
        if email_to_remove not in secondary:
            response = make_response(jsonify({'success': False, 'message': 'Email not found in secondary emails.'}))
            response.status_code = 400
            return response
        secondary.remove(email_to_remove)
        user.secondary_emails = json.dumps(secondary)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Secondary email removed.', 'secondaryEmails': secondary})

@auth_ns.route('/get-user')
@auth_ns.expect(api.model('GetUserRequest', {
    'username': fields.String(required=True, description='Username')
}), validate=False)
class GetUser(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

get_user_meta_parser = auth_ns.parser()
get_user_meta_parser.add_argument('username', type=str, required=True, location='args', help='Username')

@auth_ns.route('/get-user-meta')
@auth_ns.expect(get_user_meta_parser, validate=False)
class GetUserMeta(Resource):
    def get(self):
        username = request.args.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
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


@auth_ns.route('/get-profile')
class GetProfile(Resource):
    """Return the currently authenticated user's profile.

    Detection (non-invasive):
    - cookie 'username'
    - header 'X-Username'
    - Authorization: Bearer <token> (treated as username for compatibility)

    If no username is found, returns success: False so the frontend can continue unauthenticated.
    """
    def get(self):
        try:
            # Try cookie first
            username = request.cookies.get('username')
            # Then a custom header
            if not username:
                username = request.headers.get('X-Username')
            # Finally, tolerate a Bearer token containing the username (non-invasive)
            if not username:
                auth = request.headers.get('Authorization') or ''
                if auth.lower().startswith('bearer '):
                    parts = auth.split(None, 1)
                    if len(parts) > 1:
                        username = parts[1].strip()

            if not username:
                # No authenticated user found — return non-error so frontend can proceed
                return jsonify({'success': False, 'message': 'No authenticated user.'})

            user = User.query.filter_by(username=username).first()
            if not user:
                return jsonify({'success': False, 'message': 'User not found.'})

            user_obj = {
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
            }
            return jsonify({'success': True, 'user': user_obj})
        except Exception as e:
            logging.error(f"[API][get-profile] Error: {e}")
            return jsonify({'success': False, 'message': 'Internal error while retrieving profile.'}), 500

# Register the namespace with the API
api.add_namespace(auth_ns, path='/api')

notification_history_request = api.model('NotificationHistoryRequest', {
    'username': fields.String(required=True, description='Username'),
    'page': fields.Integer(required=False, description='Page number', default=1),
    'page_size': fields.Integer(required=False, description='Page size', default=100)
})

# === Admin & Moderation ===
admin_make_admin_request = admin_ns.model('MakeAdminRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'targetUsername': fields.String(required=True, description='Username to grant admin')
})

admin_remove_admin_request = admin_ns.model('RemoveAdminRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'targetUsername': fields.String(required=True, description='Username to revoke admin')
})

admin_bootstrap_request = admin_ns.model('BootstrapAdminRequest', {
    'targetUsername': fields.String(required=True, description='Username to make the initial admin')
})

admin_send_emergency_request = admin_ns.model('SendEmergencyEmailRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'subject': fields.String(required=True, description='Email subject'),
    'message': fields.String(required=True, description='Email body'),
    'recipient': fields.String(required=False, description="'all', username, or email")
})

admin_send_newsletter_request = admin_ns.model('SendNewsletterRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'subject': fields.String(required=True, description='Newsletter subject'),
    'message': fields.String(required=True, description='Newsletter body')
})

admin_ban_user_request = admin_ns.model('BanUserRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'targetUsername': fields.String(required=True, description='Username to ban')
})

admin_unban_user_request = admin_ns.model('UnbanUserRequest', {
    'adminUsername': fields.String(required=True, description='Admin username performing the action'),
    'targetUsername': fields.String(required=True, description='Username to unban')
})

admin_moderate_comment_request = admin_ns.model('ModerateCommentRequest', {
    'username': fields.String(required=True, description='Admin username performing moderation'),
    'comment_id': fields.Integer(required=True, description='Comment id to moderate'),
    'action': fields.String(required=True, description="Action to perform, e.g., 'delete'")
})

@admin_ns.route('/make-admin')
@admin_ns.expect(admin_make_admin_request, validate=False)
class MakeAdmin(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        target_username = data.get('targetUsername')
        if not is_admin(admin_username):
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        user = User.query.filter_by(username=target_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'Target user not found.'}))
            response.status_code = 404
            return response
        user.is_admin = True
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {target_username} is now an admin.'})

@admin_ns.route('/remove-admin')
@admin_ns.expect(admin_remove_admin_request, validate=False)
class RemoveAdmin(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        target_username = data.get('targetUsername')
        if not is_admin(admin_username):
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        user = User.query.filter_by(username=target_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'Target user not found.'}))
            response.status_code = 404
            return response
        user.is_admin = False
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {target_username} is no longer an admin.'})

@admin_ns.route('/bootstrap-admin')
@admin_ns.expect(admin_bootstrap_request, validate=False)
class BootstrapAdmin(Resource):
    def post(self):
        data = request.get_json()
        target_username = data.get('targetUsername')
        admin_count = User.query.filter_by(is_admin=True).count()
        if admin_count > 0:
            response = make_response(jsonify({'success': False, 'message': 'Admins already exist. Use make-admin endpoint.'}))
            response.status_code = 403
            return response
        user = User.query.filter_by(username=target_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'Target user not found.'}))
            response.status_code = 404
            return response
        user.is_admin = True
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {target_username} is now the first admin.'})

@admin_ns.route('/send-emergency-email')
@admin_ns.expect(admin_send_emergency_request, validate=False)
class SendEmergencyEmail(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        subject = data.get('subject')
        message = data.get('message')
        recipient = data.get('recipient')  # 'all', username, or email
        errors = []
        sent_count = 0
        logging.info(f"MAIL CONFIG: SERVER={app.config.get('MAIL_SERVER')}, PORT={app.config.get('MAIL_PORT')}, USE_TLS={app.config.get('MAIL_USE_TLS')}, USERNAME={app.config.get('MAIL_USERNAME')}")
        logging.info(f"Attempting emergency email: admin={admin_username}, subject={subject}, message={message}, recipient={recipient}")
        if not is_admin(admin_username):
            logging.warning(f"Unauthorized emergency email attempt by {admin_username}")
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        if not subject or not message:
            logging.error("Missing subject or message for emergency email.")
            response = make_response(jsonify({'success': False, 'message': 'Subject and message required.'}))
            response.status_code = 400
            return response
        def send_with_logging(user, subject, message):
            try:
                logging.info(f"Preparing to send to {user.username} ({user.email})")
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

@admin_ns.route('/send-newsletter')
@admin_ns.expect(admin_send_newsletter_request, validate=False)
class SendNewsletter(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        subject = data.get('subject')
        message = data.get('message')
        errors = []
        sent_count = 0
        if not is_admin(admin_username):
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        today = datetime.datetime.now().strftime('%m/%d/%Y')
        newsletter_subject = f"Newsletter {today} - {subject}"
        newsletter_body = f"{message}\n\nSincerely,\n{admin_username}"
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

@admin_ns.route('/ban-user')
@admin_ns.expect(admin_ban_user_request, validate=False)
class BanUser(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        target_username = data.get('targetUsername')
        if not is_admin(admin_username):
            user = User.query.filter_by(username=target_username).first()
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        user = User.query.filter_by(username=target_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'Target user not found.'}))
            response.status_code = 404
            return response
        if user.is_admin:
            response = make_response(jsonify({'success': False, 'message': 'You cannot ban another admin.'}))
            response.status_code = 403
            return response
        user.banned = True
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {target_username} has been banned.'})

@admin_ns.route('/unban-user')
@admin_ns.expect(admin_unban_user_request, validate=False)
class UnbanUser(Resource):
    def post(self):
        data = request.get_json()
        admin_username = data.get('adminUsername')
        target_username = data.get('targetUsername')
        if not is_admin(admin_username):
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 403
            return response
        user = User.query.filter_by(username=target_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'Target user not found.'}))
            response.status_code = 404
            return response
        user.banned = False
        db.session.commit()
        return jsonify({'success': True, 'message': f'User {target_username} has been unbanned.'})

@admin_ns.route('/moderate-comment')
@admin_ns.expect(admin_moderate_comment_request, validate=False)
class ModerateComment(Resource):
    def post(self):
        data = request.get_json()
        comment_id = data.get('comment_id')
        action = data.get('action')
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        if not user or not user.is_admin:
            response = make_response(jsonify({'success': False, 'message': 'Not authorized.'}))
            response.status_code = 403
            return response
        comment = Comment.query.get(comment_id)
        if not comment:
            response = make_response(jsonify({'success': False, 'message': 'Comment not found.'}))
            response.status_code = 404
            return response
        if action == 'delete':
            comment.deleted = True
            db.session.commit()
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

# Register the namespace with the API
api.add_namespace(admin_ns, path='/api')

# === Book & PDF Management ===
books_update_external_model = books_ns.model('UpdateExternalIdRequest', {
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'pdf_bytes': fields.String(required=True, description='Base64-encoded PDF bytes')
})

books_rebuild_cover_cache_model = books_ns.model('RebuildCoverCacheRequest', {
    'book_ids': fields.List(fields.String, required=False, description='Optional list of book ids to rebuild cache for')
})

books_books_query = books_ns.parser()
books_books_query.add_argument('ids', type=str, required=True, location='args', help='Comma-separated list of drive ids')

books_cover_exists_parser = books_ns.parser()
books_cover_exists_parser.add_argument('file_id', type=str, required=True, location='view_args', help='Cover file id')

books_landing_page_parser = books_ns.parser()
books_landing_page_parser.add_argument('dummy', required=False, location='args', help='No args expected; placeholder')

books_serve_cover_parser = books_ns.parser()
books_serve_cover_parser.add_argument('status', type=int, required=False, location='args', help='Return JSON status instead of image')

books_cancel_session_model = books_ns.model('CancelSessionRequest', {
    'session_id': fields.String(required=True, description='Session id to cancel'),
    'type': fields.String(required=True, description="'cover' or 'text'")
})

books_pdf_text_parser = books_ns.parser()
books_pdf_text_parser.add_argument('page', type=int, required=False, location='args', help='Page number (1-based)')
books_pdf_text_parser.add_argument('session_id', type=str, required=True, location='args', help='Session id')

# --- Bookmarks request models/parsers ---
books_get_bookmarks_parser = books_ns.parser()
books_get_bookmarks_parser.add_argument('username', type=str, required=True, location='args', help='Username')

books_get_bookmarks_model = books_ns.model('GetBookmarksRequest', {
    'username': fields.String(required=True, description='Username')
})

books_add_bookmark_model = books_ns.model('AddBookmarkRequest', {
    'username': fields.String(required=True, description='Username'),
    'book_id': fields.String(required=True, description='Drive file id for the book')
})

books_remove_bookmark_model = books_ns.model('RemoveBookmarkRequest', {
    'username': fields.String(required=True, description='Username'),
    'book_id': fields.String(required=True, description='Drive file id to remove')
})

books_update_bookmark_meta_model = books_ns.model('UpdateBookmarkMetaRequest', {
    'username': fields.String(required=True, description='Username'),
    'book_id': fields.String(required=True, description='Drive file id for the bookmark'),
    'last_page': fields.Integer(required=False, description='Last page read'),
    'unread': fields.Boolean(required=False, description='Unread flag')
})
@books_ns.route('/update-external-id')
@books_ns.expect(books_update_external_model, validate=False)
class UpdateExternalId(Resource):
    def post(self):
        """
        Update a book's external_story_id if a new PDF version contains a valid external ID and the current value is missing or blank.
        Body: { "book_id": <drive_id>, "pdf_bytes": <base64-encoded PDF> }
        """
        data = request.get_json()
        book_id = data.get('book_id')
        pdf_bytes_b64 = data.get('pdf_bytes')
        if not book_id or not pdf_bytes_b64:
            response = make_response(jsonify({'success': False, 'message': 'Missing book_id or pdf_bytes.'}))
            response.status_code = 400
            return response
        book = Book.query.filter_by(drive_id=book_id).first()
        if not book:
            response = make_response(jsonify({'success': False, 'message': 'Book not found.'}))
            response.status_code = 404
            return response
        try:
            pdf_bytes = base64.b64decode(pdf_bytes_b64)
        except Exception:
            response = make_response(jsonify({'success': False, 'message': 'Invalid PDF bytes.'}))
            response.status_code = 400
            return response
        new_external_id = extract_story_id_from_pdf(pdf_bytes)
        # Only update if new_external_id is not None and current value is missing or blank
        if new_external_id and (not book.external_story_id or not book.external_story_id.strip()):
            book.external_story_id = new_external_id
            db.session.commit()
            return jsonify({'success': True, 'message': 'External ID updated.', 'external_story_id': new_external_id})
        return jsonify({'success': True, 'message': 'No update needed.', 'external_story_id': book.external_story_id})

@books_ns.route('/rebuild-cover-cache')
@books_ns.expect(books_rebuild_cover_cache_model, validate=False)
class RebuildCoverCache(Resource):
    def post(self):
        """Rebuild atlas and cache covers for provided book_ids (landing page), or fallback to DB if not provided."""
        try:
            # Optionally accept book_ids from frontend, else use default
            data = safe_get_json({})
            book_ids = data.get('book_ids') if data and 'book_ids' in data else None
            if not book_ids or len(book_ids) < 20:
                logging.warning(f"[API][rebuild-cover-cache] Skipping deletion: received only {len(book_ids) if book_ids else 0} book_ids (minimum required: 20). Possible partial/empty POST. Waiting for next request.")
            success, missing = rebuild_cover_cache(book_ids)
            if success:
                response = make_response(jsonify({'success': True, 'message': 'Cover cache rebuilt.', 'missing_ids': []}))
                response.status_code = 200
                return response
            else:
                response = make_response(jsonify({'success': False, 'error': 'Missing covers', 'missing_ids': missing}))
                response.status_code = 200
                return response
        except Exception as e:
            logging.error(f"[API][rebuild-cover-cache] Error: {e}")
            response = make_response(jsonify({'success': False, 'error': str(e), 'missing_ids': []}))
            response.status_code = 500
            return response

@books_ns.route('/books')
@books_ns.expect(books_books_query, validate=False)
class BooksByIds(Resource):
    def get(self):
        ids_param = request.args.get('ids')
        if not ids_param:
            response = make_response(jsonify({'error': 'Missing ids parameter'}))
            response.status_code = 400
            return response
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

@books_ns.route('/all-books')
class AllBooks(Resource):
    def get(self):
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

@books_ns.route('/cover-exists/<file_id>')
@books_ns.expect(books_cover_exists_parser, validate=False)
class CoverExists(Resource):
    def get(self, file_id):
        cover_path = os.path.join(COVERS_DIR, f"{file_id}.jpg")
        exists = os.path.exists(cover_path)
        return jsonify({'exists': exists})

@books_ns.route('/landing-page-book-ids')
@books_ns.expect(books_landing_page_parser, validate=False)
class LandingPageBookIds(Resource):
    def get(self):
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
            response = make_response(jsonify({'success': False, 'error': str(e)}))
            response.status_code = 500
            return response

# --- Serve covers from disk with fallback ---
@books_ns.route('/covers/<cover_id>.jpg')
@books_ns.expect(books_serve_cover_parser, validate=False)
class ServeCover(Resource):
    def get(self, cover_id):
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
                response = make_response(jsonify({'status': 'error', 'cover_id': cover_id, 'error': str(e)}))
                response.status_code = 200
                return response

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
            return send_from_directory(COVERS_DIR, f"{cover_id}.jpg")
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
        response = make_response(jsonify({'success': False, 'message': 'Cover not found.'}))
        response.status_code = 404
        return response

@books_ns.route('/cancel-session', methods=['POST'])
@books_ns.expect(books_cancel_session_model, validate=False)
class CancelSession(Resource):
    def post(self):
        """
        Cancel all active and queued requests for a given session_id and type ('cover' or 'text').
        Body: { "session_id": "...", "type": "cover" | "text" }
        """
        data = request.get_json(force=True)
        session_id = data.get('session_id')
        req_type = data.get('type')
        if not session_id or req_type not in ['cover', 'text']:
            response = make_response(jsonify({'success': False, 'message': 'Missing session_id or invalid type.'}))
            response.status_code = 400
            return response

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

@books_ns.route('/pdf-cover/<file_id>', methods=['GET'])
class PdfCover(Resource):
    def get(self, file_id):
        """
        Queue a cover extraction for file_id (FIFO, dedup). If already queued, do nothing. If at front, process immediately.
        """
        process = psutil.Process()
        mem = process.memory_info().rss / (1024 * 1024)
        cpu = process.cpu_percent(interval=0.1)
        MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
        MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))
        logging.info(f"[pdf-cover] ENTRY: file_id={file_id}, RAM={mem:.2f} MB, CPU={cpu:.2f}%")
        # --- Quick validation: reject obviously-invalid fuzzed file IDs (e.g. "str") ---
        if not re.match(r'^[A-Za-z0-9_-]{10,}$', file_id):
            logging.warning(f"[pdf-cover] INVALID_FILE_ID: {file_id}")
            response = make_response(jsonify({'error': 'invalid_file_id', 'file_id': file_id, 'message': 'Invalid file_id format'}))
            response.status_code = 400
            return response
        cover_path = os.path.join(COVERS_DIR, f"{file_id}.jpg")
        covers_map = load_atlas()
        # --- Deduplication: fail immediately if already queued ---
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

@books_ns.route('/pdf-text/<file_id>', methods=['GET'])
@books_ns.expect(books_pdf_text_parser, validate=False)
class PdfText(Resource):
    def get(self, file_id):
        """
        Extracts text and images from a single PDF page in Google Drive by file_id and page number.
        Query params: page (1-based), session_id (optional)
        Returns: {"success": True, "page": n, "text": ..., "images": [...]} or error JSON.
        """
        global TEXT_QUEUE_ACTIVE
        global text_queue_lock
        # --- Profiling: log CPU and RAM usage at entry ---
        process = psutil.Process()
        mem = process.memory_info().rss / (1024 * 1024)
        cpu = process.cpu_percent(interval=0.1)
        logging.info(f"[pdf-text] ENTRY: file_id={file_id}, RAM={mem:.2f} MB, CPU={cpu:.2f}%")
        # --- Quick validation: reject obviously-invalid fuzzed file IDs (e.g. "str") ---
        if not re.match(r'^[A-Za-z0-9_-]{10,}$', file_id):
            logging.warning(f"[pdf-text] INVALID_FILE_ID: {file_id}")
            response = make_response(jsonify({'success': False, 'error': 'invalid_file_id', 'file_id': file_id, 'message': 'Invalid file_id format'}))
            response.status_code = 400
            return response
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
                response = make_response(jsonify({"success": False, "error": "Missing session_id"}))
                response.status_code = 400
                return response
            heartbeat(session_id)
            page_num = int(page_str) if page_str and page_str.isdigit() else 1
            entry = {'session_id': session_id, 'file_id': file_id, 'page_num': page_num, 'timestamp': time.time()}
            acquired = text_queue_lock.acquire(timeout=5)
            if not acquired:
                logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock.")
                response = make_response(jsonify({"success": False, "error": "Could not acquire queue lock (deadlock?)"}))
                response.status_code = 503
                return response
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
                    if text_request_queue and text_request_queue[0] == entry and (TEXT_QUEUE_ACTIVE is None or TEXT_QUEUE_ACTIVE == entry):
                        TEXT_QUEUE_ACTIVE = entry
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
                try:
                    request_drive = service.files().get_media(fileId=file_id)
                    pdf_bytes = request_drive.execute()
                except Exception as e:
                    logging.error(f"[pdf endpoint] Drive get_media failed for {file_id}: {e}")
                    return jsonify({"success": False, "error": f"Failed to download PDF: {e}"}), 503
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
                            if TEXT_QUEUE_ACTIVE == entry:
                                TEXT_QUEUE_ACTIVE = None
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
                    if TEXT_QUEUE_ACTIVE == entry:
                        TEXT_QUEUE_ACTIVE = None
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
                        if TEXT_QUEUE_ACTIVE == entry:
                            TEXT_QUEUE_ACTIVE = None
                    finally:
                        text_queue_lock.release()
                else:
                    logging.error("[pdf-text] ERROR: Could not acquire text_queue_lock after 5 seconds! Possible deadlock in error cleanup.")
            response = make_response(jsonify({"success": False, "error": str(e)}))
            response.status_code = 500
            return response

# === Bookmarks ===
@books_ns.route('/get-bookmarks', methods=['GET', 'POST'])
@books_ns.expect(books_get_bookmarks_parser, validate=False)
class GetBookmarks(Resource):
    def get(self):
        username = request.args.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
        try:
            service = get_drive_service()
            file_ids = [bm['id'] for bm in bookmarks]
            if file_ids:
                query = " or ".join([f"'{fid}' in parents or id='{fid}'" for fid in file_ids])
                try:
                    results = service.files().list(q=query, fields="files(id, modifiedTime)").execute()
                except Exception as e:
                    logging.error(f"[cover health] Drive list failed for query={query}: {e}")
                    results = {'files': []}
                files = results.get('files', [])
                file_update_map = {f['id']: f.get('modifiedTime') for f in files}
                for bm in bookmarks:
                    bm['last_updated'] = file_update_map.get(bm['id'], bm.get('last_updated'))
            for bm in bookmarks:
                bm['cover_url'] = get_cover_url(bm['id'])
        except Exception as e:
            pass
        response = jsonify({'success': True, 'bookmarks': bookmarks})
        return response

    def post(self):
        data = request.get_json()
        username = data.get('username') if data else None
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
        try:
            service = get_drive_service()
            file_ids = [bm['id'] for bm in bookmarks]
            if file_ids:
                query = " or ".join([f"'{fid}' in parents or id='{fid}'" for fid in file_ids])
                try:
                    results = service.files().list(q=query, fields="files(id, modifiedTime)").execute()
                except Exception as e:
                    logging.error(f"[cover queue] Drive list failed for query={query}: {e}")
                    results = {'files': []}
                files = results.get('files', [])
                file_update_map = {f['id']: f.get('modifiedTime') for f in files}
                for bm in bookmarks:
                    bm['last_updated'] = file_update_map.get(bm['id'], bm.get('last_updated'))
            for bm in bookmarks:
                bm['cover_url'] = get_cover_url(bm['id'])
        except Exception as e:
            pass
        response = jsonify({'success': True, 'bookmarks': bookmarks})
        return response

@books_ns.route('/add-bookmark', methods=['POST'])
@books_ns.expect(books_add_bookmark_model, validate=False)
class AddBookmark(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        book_id = data.get('book_id')
        if not username or not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Username and book_id required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

@books_ns.route('/remove-bookmark', methods=['POST'])
@books_ns.expect(books_remove_bookmark_model, validate=False)
class RemoveBookmark(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        book_id = data.get('book_id')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        if not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Book ID missing.'}))
            response.status_code = 400
            return response
        bookmarks = json.loads(user.bookmarks) if user.bookmarks else []
        before = len(bookmarks)
        bookmarks = [bm for bm in bookmarks if bm['id'] != book_id]
        after = len(bookmarks)
        for bm in bookmarks:
            bm['cover_url'] = get_cover_url(bm['id'])
        user.bookmarks = json.dumps(bookmarks)
        db.session.commit()
        if before == after:
            return jsonify({'success': False, 'message': 'Bookmark not found.', 'bookmarks': bookmarks})
        return jsonify({'success': True, 'message': 'Bookmark removed.', 'bookmarks': bookmarks})

@books_ns.route('/update-bookmark-meta', methods=['POST'])
@books_ns.expect(books_update_bookmark_meta_model, validate=False)
class UpdateBookmarkMeta(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        book_id = data.get('book_id')
        last_page = data.get('last_page')
        unread = data.get('unread')
        if not username or not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Username and book_id required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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
        for bm in bookmarks:
            bm['cover_url'] = get_cover_url(bm['id'])
        if not updated:
            response = make_response(jsonify({'success': False, 'message': 'Bookmark not found.'}))
            response.status_code = 404
            return response
        user.bookmarks = json.dumps(bookmarks)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Bookmark updated.', 'bookmarks': bookmarks})

api.add_namespace(books_ns, path='/api')

# === Voting ===
vote_book_model = votes_ns.model('VoteBookRequest', {
    'username': fields.String(required=True, description='Username casting the vote'),
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'value': fields.Integer(required=True, description='Vote value (1-5)')
})

book_votes_parser = votes_ns.parser()
book_votes_parser.add_argument('book_id', type=str, required=True, location='args', help='Drive file id for the book')

user_voted_books_parser = votes_ns.parser()
user_voted_books_parser.add_argument('username', type=str, required=True, location='args', help='Username')

user_top_voted_books_parser = votes_ns.parser()
user_top_voted_books_parser.add_argument('username', type=str, required=True, location='args', help='Username')
@votes_ns.route('/vote-book')
@votes_ns.expect(vote_book_model, validate=False)
class VoteBook(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        book_id = data.get('book_id')
        value = data.get('value')  # 1-5
        if not username or not book_id or value not in [1,2,3,4,5]:
            response = make_response(jsonify({'success': False, 'message': 'Invalid vote data.'}))
            response.status_code = 400
            return response
        vote = Vote.query.filter_by(username=username, book_id=book_id).first()
        if vote:
            vote.value = value
            vote.timestamp = datetime.datetime.now(datetime.UTC)
        else:
            vote = Vote(username=username, book_id=book_id, value=value)
            db.session.add(vote)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Vote recorded.'})

@votes_ns.route('/book-votes')
@votes_ns.expect(book_votes_parser, validate=False)
class BookVotes(Resource):
    def get(self):
        book_id = request.args.get('book_id')
        if not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Book ID required.'}))
            response.status_code = 400
            return response
        votes = Vote.query.filter_by(book_id=book_id).all()
        if not votes:
            return jsonify({'success': True, 'average': 0, 'count': 0})
        avg = round(sum(v.value for v in votes) / len(votes), 2)
        return jsonify({'success': True, 'average': avg, 'count': len(votes)})

@votes_ns.route('/top-voted-books')
class TopVotedBooks(Resource):
    def get(self):
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
                    try:
                        file_metadata = service.files().get(fileId=book_id, fields='name').execute()
                    except Exception as e:
                        logging.error(f"[book meta] Drive get failed for {book_id}: {e}")
                        file_metadata = None
                    meta['name'] = file_metadata.get('name')
                except Exception:
                    meta['name'] = None
            books.append(meta)
        return jsonify({'success': True, 'books': books})

@votes_ns.route('/user-voted-books')
@votes_ns.expect(user_voted_books_parser, validate=False)
class UserVotedBooks(Resource):
    def get(self):
        username = request.args.get('username')
        if not username:
            response = make_response(jsonify({'success': False, 'message': 'Username required.'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

@votes_ns.route('/user-top-voted-books')
@votes_ns.expect(user_top_voted_books_parser, validate=False)
class UserTopVotedBooks(Resource):
    def get(self):
        username = request.args.get('username')
        if not username:
            response = make_response(jsonify({'error': 'Missing username'}))
            response.status_code = 400
            return response
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'error': 'User not found'}))
            response.status_code = 404
            return response
        # Get all votes by this user
        votes = Vote.query.filter_by(username=username).all()
        if not votes:
            response = make_response(jsonify({'books': []}))
            response.status_code = 200
            return response
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
        response = make_response(jsonify({'books': result}))
        response.status_code = 200
        return response

api.add_namespace(votes_ns, path='/api')

# === Comments ===
# -- Swagger models/parsers for comments namespace --
comments_add_model = comments_ns.model('AddCommentRequest', {
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'username': fields.String(required=True, description='Username posting the comment'),
    'text': fields.String(required=True, description='Comment text'),
    'parent_id': fields.Integer(required=False, description='Optional parent comment id')
})

comments_edit_model = comments_ns.model('EditCommentRequest', {
    'comment_id': fields.Integer(required=True, description='Comment id to edit'),
    'username': fields.String(required=True, description='Username performing the edit'),
    'text': fields.String(required=True, description='Updated comment text')
})

comments_delete_model = comments_ns.model('DeleteCommentRequest', {
    'comment_id': fields.Integer(required=True, description='Comment id to delete'),
    'username': fields.String(required=True, description='Username performing the delete')
})

comments_get_parser = comments_ns.parser()
comments_get_parser.add_argument('book_id', type=str, required=True, location='args', help='Drive file id for the book')
comments_get_parser.add_argument('page', type=int, required=False, location='args', help='Page number')
comments_get_parser.add_argument('page_size', type=int, required=False, location='args', help='Page size')

comments_has_new_model = comments_ns.model('HasNewCommentsRequest', {
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'known_ids': fields.List(fields.Integer, required=False, description='List of known comment ids'),
    'latest_timestamp': fields.String(required=False, description='ISO8601 timestamp of latest known comment')
})

comments_vote_model = comments_ns.model('VoteCommentRequest', {
    'comment_id': fields.Integer(required=True, description='Comment id to vote on'),
    'value': fields.Integer(required=True, description='Vote value: 1 for upvote, -1 for downvote')
})

comments_get_votes_parser = comments_ns.parser()
comments_get_votes_parser.add_argument('comment_id', type=int, required=True, location='args', help='Comment id')

comments_user_comments_parser = comments_ns.parser()
comments_user_comments_parser.add_argument('username', type=str, required=True, location='args', help='Username')

@comments_ns.route('/add-comment')
@comments_ns.expect(comments_add_model, validate=False)
class AddComment(Resource):
    def post(self):
        data = request.get_json()
        book_id = data.get('book_id')
        username = data.get('username')
        text = data.get('text')
        parent_id = data.get('parent_id')
        if not book_id or not username or not text:
            response = make_response(jsonify({'success': False, 'message': 'Missing fields.'}))
            response.status_code = 400
            return response
        comment = Comment(book_id=book_id, username=username, text=text, parent_id=parent_id)
        db.session.add(comment)
        db.session.commit()
        # Hook for notifications: if parent_id, notify parent comment's author
        return jsonify({'success': True, 'message': 'Comment added.', 'comment_id': comment.id})

@comments_ns.route('/edit-comment')
@comments_ns.expect(comments_edit_model, validate=False)
class EditComment(Resource):
    def post(self):
        data = request.get_json()
        comment_id = data.get('comment_id')
        username = data.get('username')
        text = data.get('text')
        comment = Comment.query.get(comment_id)
        if not comment or comment.deleted:
            response = make_response(jsonify({'success': False, 'message': 'Comment not found.'}))
            response.status_code = 404
            return response
        if comment.username != username:
            user = User.query.filter_by(username=username).first()
            if not user or not user.is_admin:
                response = make_response(jsonify({'success': False, 'message': 'Not authorized.'}))
                response.status_code = 403
                return response
        comment.text = text
        comment.edited = True
        comment.timestamp = datetime.datetime.now(datetime.UTC)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Comment edited.'})

@comments_ns.route('/delete-comment')
@comments_ns.expect(comments_delete_model, validate=False)
class DeleteComment(Resource):
    def post(self):
        data = request.get_json()
        comment_id = data.get('comment_id')
        username = data.get('username')
        comment = Comment.query.get(comment_id)
        if not comment or comment.deleted:
            response = make_response(jsonify({'success': False, 'message': 'Comment not found.'}))
            response.status_code = 404
            return response
        if comment.username != username:
            user = User.query.filter_by(username=username).first()
            if not user or not user.is_admin:
                response = make_response(jsonify({'success': False, 'message': 'Not authorized.'}))
                response.status_code = 403
                return response
        comment.deleted = True
        db.session.commit()
        return jsonify({'success': True, 'message': 'Comment deleted.'})

@comments_ns.route('/get-comments')
@comments_ns.expect(comments_get_parser, validate=False)
class GetComments(Resource):
    def get(self):
        book_id = request.args.get('book_id')
        # Defensive parsing for paging parameters
        try:
            page = int(request.args.get('page', 1))
        except Exception:
            page = 1
        try:
            page_size = int(request.args.get('page_size', 20))
        except Exception:
            page_size = 20
        # Normalize bounds
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 1
        if page_size > 200:
            page_size = 200

        if not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Book ID required.'}))
            response.status_code = 400
            return response

        # Validate book_id to avoid malicious or malformed input from fuzzers.
        # Google Drive ids are alphanumeric with - and _; require a conservative minimum length.
        if not re.match(r'^[A-Za-z0-9_\-]{10,}$', book_id):
            response = make_response(jsonify({'success': False, 'message': 'Invalid book_id parameter.'}))
            response.status_code = 400
            return response
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

@comments_ns.route('/has-new-comments')
@comments_ns.expect(comments_has_new_model, validate=False)
class HasNewComments(Resource):
    def post(self):
        data = request.get_json()
        book_id = data.get('book_id')
        # Accept either a list of known comment IDs or the latest timestamp
        known_ids = set(data.get('known_ids', []))
        latest_timestamp = data.get('latest_timestamp')  # ISO8601 string or None
        if not book_id:
            response = make_response(jsonify({'success': False, 'message': 'Book ID required.'}))
            response.status_code = 400
            return response
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
                response = make_response(jsonify({'success': False, 'message': 'Invalid timestamp.'}))
                response.status_code = 400
                return response
            new_comments = query.filter(Comment.timestamp > ts).all()
            has_new = len(new_comments) > 0
            new_ids = [c.id for c in new_comments]
            return jsonify({'success': True, 'hasNew': has_new, 'new_ids': new_ids})
        else:
            # If neither provided, just return False
            return jsonify({'success': True, 'hasNew': False, 'new_ids': []})

@comments_ns.route('/vote-comment')
@comments_ns.expect(comments_vote_model, validate=False)
class VoteComment(Resource):
    def post(self):
        data = request.get_json()
        comment_id = data.get('comment_id')
        value = data.get('value')  # 1 for upvote, -1 for downvote
        if value not in [1, -1]:
            response = make_response(jsonify({'success': False, 'message': 'Invalid vote value.'}))
            response.status_code = 400
            return response
        comment = Comment.query.get(comment_id)
        if not comment or comment.deleted:
            response = make_response(jsonify({'success': False, 'message': 'Comment not found.'}))
            response.status_code = 404
            return response
        if value == 1:
            comment.upvotes += 1
        else:
            comment.downvotes += 1
        db.session.commit()
        return jsonify({'success': True, 'message': 'Vote recorded.', 'upvotes': comment.upvotes, 'downvotes': comment.downvotes})

@comments_ns.route('/get-comment-votes')
@comments_ns.expect(comments_get_votes_parser, validate=False)
class GetCommentVotes(Resource):
    def get(self):
        comment_id = request.args.get('comment_id')
        comment = Comment.query.get(comment_id)
        if not comment or comment.deleted:
            response = make_response(jsonify({'success': False, 'message': 'Comment not found.'}))
            response.status_code = 404
            return response
        return jsonify({'success': True, 'upvotes': comment.upvotes, 'downvotes': comment.downvotes})

@comments_ns.route('/user-comments')
@comments_ns.expect(comments_user_comments_parser, validate=False)
class UserComments(Resource):
    def get(self):
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

# Register the namespace with the API
api.add_namespace(comments_ns, path='/api')

# === Notifications ===
# -- Swagger models/parsers for notifications namespace --
notifications_get_prefs_model = notifications_ns.model('GetNotificationPrefsRequest', {
    'username': fields.String(required=True, description='Username')
})

notifications_update_prefs_model = notifications_ns.model('UpdateNotificationPrefsRequest', {
    'username': fields.String(required=True, description='Username'),
    'prefs': fields.Raw(required=True, description='Notification preferences object')
})

notification_history_request = notifications_ns.model('NotificationHistoryRequest', {
    'username': fields.String(required=True, description='Username'),
    'page': fields.Integer(required=False, description='Page number', default=1),
    'page_size': fields.Integer(required=False, description='Page size', default=100)
})

notify_reply_model = notifications_ns.model('NotifyReplyRequest', {
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'comment_id': fields.Integer(required=True, description='Parent comment id'),
    'message': fields.String(required=False, description='Notification message')
})

notify_book_model = notifications_ns.model('NotifyBookRequest', {
    'book_id': fields.String(required=True, description='Drive file id for the book'),
    'book_title': fields.String(required=False, description='Book title')
})

notify_app_update_model = notifications_ns.model('NotifyAppUpdateRequest', {})

notifications_mark_all_model = notifications_ns.model('MarkAllNotificationsReadRequest', {
    'username': fields.String(required=True, description='Username')
})

notifications_delete_model = notifications_ns.model('DeleteNotificationRequest', {
    'username': fields.String(required=True, description='Username'),
    'notificationId': fields.String(required=True, description='Notification id or timestamp')
})

notifications_dismiss_all_model = notifications_ns.model('DismissAllNotificationsRequest', {
    'username': fields.String(required=True, description='Username')
})

notifications_mark_notification_model = notifications_ns.model('MarkNotificationRequest', {
    'username': fields.String(required=True, description='Username'),
    'notificationId': fields.String(required=True, description='Notification id or timestamp'),
    'read': fields.Boolean(required=False, description='Read flag')
})

notifications_delete_all_history_model = notifications_ns.model('DeleteAllNotificationHistoryRequest', {
    'username': fields.String(required=True, description='Username')
})

notifications_has_new_model = notifications_ns.model('HasNewNotificationsRequest', {
    'username': fields.String(required=True, description='Username')
})

notifications_send_scheduled_model = notifications_ns.model('SendScheduledEmailsRequest', {
    'frequency': fields.String(required=True, description="'daily' | 'weekly' | 'monthly'")
})

@notifications_ns.route('/get-notification-prefs')
@notifications_ns.expect(notifications_get_prefs_model, validate=False)
class GetNotificationPrefs(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        user = User.query.filter_by(username=username).first() if username else None
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

@notifications_ns.route('/update-notification-prefs')
@notifications_ns.expect(notifications_update_prefs_model, validate=False)
class UpdateNotificationPrefs(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        prefs = data.get('prefs')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        user.notification_prefs = json.dumps(prefs)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Notification preferences updated.'})

@notifications_ns.route('/get-notification-history')
@notifications_ns.expect(notification_history_request, validate=False)
class GetNotificationHistory(Resource):
    def get(self):
        response = make_response(jsonify({'success': False, 'message': 'Use POST for this endpoint.'}))
        response.status_code = 405
        return response

    def post(self):
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

@notifications_ns.route('/notify-reply', methods=['POST'])
@notifications_ns.expect(notify_reply_model, validate=False)
class NotifyReply(Resource):
    def post(self):
        data = request.get_json()
        book_id = data.get('book_id')
        comment_id = data.get('comment_id')
        message = data.get('message', 'Someone replied to your comment!')
        parent_comment = db.session.get(Comment, comment_id)
        if not parent_comment or parent_comment.deleted:
            response = make_response(jsonify({'success': False, 'message': 'Parent comment not found.'}))
            response.status_code = 404
            return response
        parent_username = parent_comment.username
        user = User.query.filter_by(username=parent_username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        add_notification(
            user,
            'reply',
            'New Reply!',
            message,
            link=f'/read/{book_id}?comment={comment_id}'
        )
        return jsonify({'success': True, 'message': f'Reply notification sent to {parent_username}.'})

@notifications_ns.route('/notify-new-book', methods=['POST'])
@notifications_ns.expect(notify_book_model, validate=False)
class NotifyNewBook(Resource):
    def post(self):
        data = request.get_json()
        book_id = data.get('book_id')
        book_title = data.get('book_title', 'Untitled Book')
        users = User.query.all()
        for user in users:
            prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
            if not prefs.get('muteAll', False) and prefs.get('newBooks', True):
                add_notification(user, 'newBook', 'New Book Added!', f'A new book "{book_title}" is now available in the library.', link=f'/read/{book_id}')
        return jsonify({'success': True, 'message': f'Notification sent for new book: {book_title}.'})

@notifications_ns.route('/notify-book-update', methods=['POST'])
@notifications_ns.expect(notify_book_model, validate=False)
class NotifyBookUpdate(Resource):
    def post(self):
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

@notifications_ns.route('/notify-app-update', methods=['POST'])
@notifications_ns.expect(notify_app_update_model, validate=False)
class NotifyAppUpdate(Resource):
    def post(self):
        users = User.query.all()
        for user in users:
            prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
            if not prefs.get('muteAll', False) and prefs.get('announcements', True):
                add_notification(user, 'appUpdate', 'App Updated!', 'Storyweave Chronicles has been updated!')
        return jsonify({'success': True, 'message': 'App update notification sent to all users.'})

@notifications_ns.route('/mark-all-notifications-read', methods=['POST'])
@notifications_ns.expect(notifications_mark_all_model, validate=False)
class MarkAllNotificationsRead(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        history = json.loads(user.notification_history) if user.notification_history else []
        for n in history:
            n['read'] = True
        user.notification_history = json.dumps(history)
        db.session.commit()
        return jsonify({'success': True, 'message': 'Notifications marked as read.', 'history': history})

@notifications_ns.route('/delete-notification', methods=['POST'])
@notifications_ns.expect(notifications_delete_model, validate=False)
class DeleteNotification(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        notification_id = data.get('notificationId')
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        history = json.loads(user.notification_history) if user.notification_history else []
        new_history = [n for n in history if str(n.get('id', n.get('timestamp'))) != str(notification_id)]
        found = len(new_history) < len(history)
        user.notification_history = json.dumps(new_history)
        db.session.commit()
        return jsonify({'success': found, 'message': 'Notification deleted.' if found else 'Notification not found.', 'history': new_history})

# Dismiss all notifications for a user
@notifications_ns.route('/dismiss-all-notifications', methods=['POST'])
@notifications_ns.expect(notifications_dismiss_all_model, validate=False)
class DismissAllNotifications(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        logging.info(f"[DISMISS ALL] Request for user: {username}")
        user = User.query.filter_by(username=username).first()
        if not user:
            logging.error(f"[DISMISS ALL] User not found: {username}")
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        history = json.loads(user.notification_history) if user.notification_history else []
        logging.info(f"[DISMISS ALL] Initial history count: {len(history)}")
        for n in history:
            n['dismissed'] = True
            if 'id' not in n:
                n['id'] = n.get('timestamp')
        user.notification_history = json.dumps(history)
        db.session.commit()
        logging.info(f"[DISMISS ALL] History AFTER: {user.notification_history}")
        user_check = User.query.filter_by(username=username).first()
        logging.info(f"[DISMISS ALL] History AFTER COMMIT (reloaded): {user_check.notification_history}")
        logging.info(f"[DISMISS ALL] Notification history cleared for user: {username}")
        return jsonify({'success': True, 'message': 'All notifications dismissed.', 'history': history})

# Mark a single notification as read/unread
@notifications_ns.route('/mark-notification-read', methods=['POST'])
@notifications_ns.expect(notifications_mark_notification_model, validate=False)
class MarkNotificationRead(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        notification_id = data.get('notificationId')
        read = data.get('read', True)
        user = User.query.filter_by(username=username).first()
        if not user:
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
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

@notifications_ns.route('/delete-all-notification-history', methods=['POST'])
@notifications_ns.expect(notifications_delete_all_history_model, validate=False)
class DeleteAllNotificationHistory(Resource):
    def post(self):
        data = request.get_json()
        username = data.get('username')
        logging.info(f"[DELETE ALL] Request for user: {username}")
        user = User.query.filter_by(username=username).first()
        if not user:
            logging.error(f"[DELETE ALL] User not found: {username}")
            response = make_response(jsonify({'success': False, 'message': 'User not found.'}))
            response.status_code = 404
            return response
        logging.info(f"[DELETE ALL] History BEFORE: {user.notification_history}")
        user.notification_history = json.dumps([])
        db.session.commit()
        logging.info(f"[DELETE ALL] History AFTER: {user.notification_history}")
        user_check = User.query.filter_by(username=username).first()
        logging.info(f"[DELETE ALL] History AFTER COMMIT (reloaded): {user_check.notification_history}")
        logging.info(f"[DELETE ALL] Notification history cleared for user: {username}")
        return jsonify({'success': True, 'message': 'All notifications deleted from history.', 'history': []})

@notifications_ns.route('/has-new-notifications', methods=['POST'])
@notifications_ns.expect(notifications_has_new_model, validate=False)
class HasNewNotifications(Resource):
    @cross_origin()
    def post(self):
        data = request.get_json(force=True)
        username = data.get('username')
        user = User.query.filter_by(username=username).first()
        has_new = False
        if user and user.notification_history:
            try:
                history = json.loads(user.notification_history)
                has_new = any(not n.get('read', False) and not n.get('dismissed', False) for n in history if isinstance(n, dict))
            except Exception:
                has_new = False
        response = jsonify({'hasNew': has_new})
        response.headers.add('Access-Control-Allow-Origin', '*')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'POST,OPTIONS')
        return response

@notifications_ns.route('/send-scheduled-emails', methods=['POST'])
@notifications_ns.expect(notifications_send_scheduled_model, validate=False)
class SendScheduledEmails(Resource):
    def post(self):
        """
        Trigger the send_scheduled_emails function for a given frequency.
        Expected JSON payload: { "frequency": "daily" }
        """
        data = request.get_json()
        frequency = data.get("frequency", "").lower()

        if frequency not in ["daily", "weekly", "monthly"]:
            response = make_response(jsonify({"error": "Invalid frequency. Must be 'daily', 'weekly', or 'monthly'."}))
            response.status_code = 400
            return response

        try:
            send_scheduled_emails(frequency)
            response = make_response(jsonify({"message": f"Scheduled emails for {frequency} frequency sent successfully."}))
            response.status_code = 200
            return response
        except Exception as e:
            logging.error(f"Error in /send-scheduled-emails endpoint: {e}")
            response = make_response(jsonify({"error": "Failed to send scheduled emails."}))
            response.status_code = 500
            return response

api.add_namespace(notifications_ns, path='/api')

# === Health & Diagnostics ===
# -- Swagger models/parsers for health namespace --
health_list_pdfs_parser = health_ns.parser()
health_list_pdfs_parser.add_argument('page', type=int, required=False, location='args', help='Page number')
health_list_pdfs_parser.add_argument('page_size', type=int, required=False, location='args', help='Page size')

health_seed_drive_model = health_ns.model('SeedDriveBooksRequest', {
    'folder_id': fields.String(required=False, description='Drive folder id to seed from')
})


@health_ns.route('/seed-drive-books')
@health_ns.expect(health_seed_drive_model, validate=False)
class SeedDriveBooks(Resource):
    """Seed the database with PDFs found in a Google Drive folder.

    This implementation restores the richer behavior from the previous version:
    - Iterates all pages from Drive.list
    - Adds new Book rows, updates existing metadata
    - Extracts external story IDs from PDFs when possible
    - Batches DB commits and throttles based on memory usage
    - Sends notify-new-book / notify-book-update callbacks for downstream UI

    Safety: Disabled by default in production. Allowed when `DEBUG` is true,
    or env `ENABLE_SEED_DRIVE` == 'True', or when request includes header
    `X-Admin-Username` belonging to an admin user.
    """
    def post(self):
        try:
            # Guard: only allow when explicitly enabled or called by an admin
            enabled_env = os.getenv('ENABLE_SEED_DRIVE', 'False') == 'True'
            admin_header = request.headers.get('X-Admin-Username')
            allowed = is_debug or enabled_env
            if not allowed and admin_header:
                try:
                    allowed = is_admin(admin_header)
                except Exception:
                    allowed = False
            if not allowed:
                response = make_response(jsonify({'success': False, 'message': 'seed-drive-books disabled. Set ENABLE_SEED_DRIVE or call as admin.'}))
                response.status_code = 403
                return response

            data = safe_get_json({}) or {}
            # Support both legacy and newer env var names for the Drive folder ID
            folder_id = (
                data.get('folder_id')
                or os.getenv('DRIVE_BOOKS_FOLDER_ID')
                or os.getenv('GOOGLE_DRIVE_FOLDER_ID')
            )
            if not folder_id:
                response = make_response(jsonify({'success': False, 'message': 'No folder_id provided and DRIVE_BOOKS_FOLDER_ID not set.'}))
                response.status_code = 400
                return response

            try:
                service = get_drive_service()
            except Exception as e:
                logging.error(f"[API][seed-drive-books] Drive credentials/setup error: {e}")
                response = make_response(jsonify({'success': False, 'message': 'Google Drive credentials unavailable.', 'error': str(e)}))
                response.status_code = 503
                return response

            query = f"'{folder_id}' in parents and mimeType='application/pdf' and trashed=false"
            files = []
            page_token = None
            try:
                while True:
                    resp = service.files().list(q=query, spaces='drive', fields='nextPageToken, files(id, name, createdTime, modifiedTime)', pageToken=page_token).execute()
                    files.extend(resp.get('files', []))
                    page_token = resp.get('nextPageToken')
                    if not page_token:
                        break
            except Exception as e:
                logging.error(f"[API][seed-drive-books] Drive files().list failed for folder {folder_id}: {e}")
                response = make_response(jsonify({'success': False, 'message': 'Drive list failed', 'error': str(e)}))
                response.status_code = 503
                return response

            # Prepare counters and batching
            added_count = 0
            updated_count = 0
            external_id_updates = 0
            skipped_count = 0
            errors = []
            new_books = []
            updated_books = []
            logging.info(f"[Seed] Total files returned from Drive: {len(files)}")
            # --- Compare DB vs Drive: produce CSV of DB books missing from Drive ---
            drive_id_set = set(f.get('id') for f in files if f.get('id'))
            db_books = Book.query.filter(Book.drive_id.isnot(None)).all()
            db_drive_map = {b.drive_id: b for b in db_books if b.drive_id}
            missing_drive_ids = [did for did in db_drive_map.keys() if did not in drive_id_set]
            timestamp_str = datetime.datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')
            csv_fname = os.path.join(os.path.dirname(__file__), f'missing_books_{timestamp_str}.csv')
            try:
                with open(csv_fname, 'w', newline='', encoding='utf-8') as fh:
                    writer = csv.writer(fh)
                    writer.writerow(['drive_id', 'db_id', 'title', 'external_story_id', 'created_at', 'updated_at'])
                    for did in missing_drive_ids:
                        b = db_drive_map.get(did)
                        writer.writerow([did, getattr(b, 'id', None), getattr(b, 'title', None), getattr(b, 'external_story_id', None), getattr(b, 'created_at', None), getattr(b, 'updated_at', None)])
                logging.info(f"[Seed][COMPARE] Wrote missing-drive CSV: {csv_fname} (missing_count={len(missing_drive_ids)})")
            except Exception as e:
                logging.error(f"[Seed][COMPARE] Failed writing missing CSV {csv_fname}: {e}")

            # Optional deletion/relink behavior controlled by env vars
            delete_missing = os.getenv('ENABLE_SEED_DELETE_MISSING', 'False') == 'True'
            relink_by_title = os.getenv('ENABLE_SEED_RELINK_BY_TITLE', 'False') == 'True'
            deleted_count = 0
            relinked_count = 0
            # Build title -> drive ids map for drive files (normalized)
            drive_title_map = {}
            for f in files:
                t = (f.get('name') or '').strip().lower()
                if not t:
                    continue
                drive_title_map.setdefault(t, []).append(f.get('id'))

            if relink_by_title and missing_drive_ids:
                logging.info(f"[Seed][RELINK] Attempting title-based relink for {len(missing_drive_ids)} missing DB records")
                for old_did in list(missing_drive_ids):
                    book = db_drive_map.get(old_did)
                    if not book:
                        continue
                    title_norm = (book.title or '').strip().lower()
                    candidates = drive_title_map.get(title_norm, [])
                    # Only auto-relink when there's exactly one candidate to avoid mistakes
                    if len(candidates) == 1:
                        new_did = candidates[0]
                        # Ensure no other DB book already uses new_did
                        existing = Book.query.filter_by(drive_id=new_did).first()
                        if existing:
                            logging.info(f"[Seed][RELINK] Skipping relink for {book.id} title='{book.title}': new drive id {new_did} already in DB")
                            continue
                        try:
                            logging.info(f"[Seed][RELINK] Relinking DB book id={book.id} title='{book.title}' from {old_did} -> {new_did}")
                            book.drive_id = new_did
                            book.updated_at = datetime.datetime.now(timezone.utc)
                            db.session.add(book)
                            db.session.commit()
                            relinked_count += 1
                            # remove from missing list since it's re-linked
                            missing_drive_ids.remove(old_did)
                        except Exception as e:
                            db.session.rollback()
                            logging.error(f"[Seed][RELINK] Failed relinking book id={book.id}: {e}")

            if delete_missing and missing_drive_ids:
                try:
                    logging.info(f"[Seed][DELETE] Deleting {len(missing_drive_ids)} DB books missing from Drive")
                    # delete by drive_id
                    deleted = Book.query.filter(Book.drive_id.in_(missing_drive_ids)).delete(synchronize_session=False)
                    db.session.commit()
                    deleted_count = int(deleted)
                    logging.info(f"[Seed][DELETE] Deleted {deleted_count} books from DB that were missing in Drive")
                except Exception as e:
                    db.session.rollback()
                    logging.error(f"[Seed][DELETE] Failed deleting missing books: {e}")

            # Expose counts to the later response via variables
            # They will be included in the final JSON return below
            process = psutil.Process()
            BATCH_SIZE = int(os.getenv('SEED_BATCH_SIZE', '10'))
            MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))
            MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
            batch = []

            for idx, f in enumerate(files):
                drive_id = f.get('id')
                title = f.get('name')
                created_time = f.get('createdTime')
                modified_time = f.get('modifiedTime')
                logging.info(f"[Seed] Processing file {idx+1}/{len(files)}: drive_id={drive_id}, title={title}, created_time={created_time}, modified_time={modified_time}")
                try:
                    book = Book.query.filter_by(drive_id=drive_id).first()
                    if not book:
                        external_story_id = None
                        try:
                            file_request = service.files().get_media(fileId=drive_id)
                            file_content = file_request.execute()
                            external_story_id = extract_story_id_from_pdf(file_content)
                            del file_content
                            gc.collect()
                        except Exception as e:
                            logging.warning(f"[Seed] Error extracting story ID for {title}: {e}")
                            errors.append(f"Error extracting story ID for {title}: {e}")
                            external_story_id = None
                        try:
                            book = Book(
                                drive_id=drive_id,
                                title=title,
                                external_story_id=external_story_id,
                                version_history=None,
                                created_at=datetime.datetime.fromisoformat(created_time.replace('Z', '+00:00')) if created_time else datetime.datetime.now(timezone.utc),
                                updated_at=datetime.datetime.fromisoformat(modified_time.replace('Z', '+00:00')) if modified_time else None
                            )
                            db.session.add(book)
                            added_count += 1
                            new_books.append({'id': drive_id, 'title': title})
                            logging.info(f"[Seed] Added new book: drive_id={drive_id}, title={title}")
                        except Exception as e:
                            skipped_count += 1
                            errors.append(f"Error creating new Book for {title} ({drive_id}): {e}")
                            logging.error(f"[Seed] Skipped file due to error creating Book: drive_id={drive_id}, title={title}, error={e}")
                            continue
                    else:
                        updated = False
                        try:
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
                                    del file_content
                                    gc.collect()
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
                            errors.append(f"Error updating Book for {title} ({drive_id}): {e}")
                            logging.error(f"[Seed] Skipped file due to error updating Book: drive_id={drive_id}, title={title}, error={e}")
                            continue

                    mem = process.memory_info().rss / (1024 * 1024)
                    if mem > MEMORY_HIGH_THRESHOLD_MB:
                        logging.warning(f"[Seed][THROTTLE] RAM {mem:.2f} MB > {MEMORY_HIGH_THRESHOLD_MB} MB. Sleeping 2s and running GC.")
                        time.sleep(2)
                        gc.collect()
                    elif mem > MEMORY_LOW_THRESHOLD_MB:
                        logging.info(f"[Seed][THROTTLE] RAM {mem:.2f} MB > {MEMORY_LOW_THRESHOLD_MB} MB. Running GC.")
                        gc.collect()
                    batch.append(book)
                    if len(batch) >= BATCH_SIZE:
                        try:
                            db.session.commit()
                            batch.clear()
                            gc.collect()
                            logging.info(f"[Seed][BATCH] Committed batch of {BATCH_SIZE} books. RAM: {mem:.2f} MB")
                        except Exception as e:
                            errors.append(f"Error committing batch at file {title} ({drive_id}): {e}")
                            logging.error(f"[Seed] Error committing batch: {e}")
                except Exception as e:
                    skipped_count += 1
                    errors.append(f"Error processing file {title} ({drive_id}): {e}")
                    logging.error(f"[Seed] Skipped file due to error: drive_id={drive_id}, title={title}, error={e}")
                    continue

            if batch:
                try:
                    db.session.commit()
                    batch.clear()
                    gc.collect()
                    mem = process.memory_info().rss / (1024 * 1024)
                    logging.info(f"[Seed][FINAL BATCH] Committed final batch. RAM: {mem:.2f} MB")
                except Exception as e:
                    errors.append(f"Error committing final batch: {e}")
                    logging.error(f"[Seed] Error committing final batch: {e}")

            # Notify UI/backend about new/updated books
            for book_info in new_books:
                try:
                    notify_url = request.host_url.rstrip('/') + '/api/notify-new-book'
                    resp = requests.post(notify_url, json={
                        'book_id': book_info['id'],
                        'book_title': book_info['title']
                    }, timeout=10)
                    if resp.status_code != 200:
                        errors.append(f"Error notifying new book: {resp.text}")
                except Exception as e:
                    errors.append(f"Error notifying new book: {e}")
            for book_info in updated_books:
                try:
                    notify_url = request.host_url.rstrip('/') + '/api/notify-book-update'
                    resp = requests.post(notify_url, json={
                        'book_id': book_info['id'],
                        'book_title': book_info['title']
                    }, timeout=10)
                    if resp.status_code != 200:
                        errors.append(f"Error notifying book update: {resp.text}")
                except Exception as e:
                    errors.append(f"Error notifying book update: {e}")

            missing_final_count = len(missing_drive_ids) if 'missing_drive_ids' in locals() else 0
            return jsonify({
                'success': True,
                'added_count': added_count,
                'updated_count': updated_count,
                'external_id_updates': external_id_updates,
                'skipped_count': skipped_count,
                'missing_count': missing_final_count,
                'deleted_count': deleted_count if 'deleted_count' in locals() else 0,
                'relinked_count': relinked_count if 'relinked_count' in locals() else 0,
                'missing_csv': os.path.basename(csv_fname) if 'csv_fname' in locals() else None,
                'errors': errors,
                'message': f"Seeded {added_count} new books, updated {updated_count} existing books, {external_id_updates} external IDs set."
            })
        except Exception as e:
            logging.error(f"[API][seed-drive-books] Unexpected error: {e}")
            response = make_response(jsonify({'success': False, 'message': 'Internal error', 'error': str(e)}))
            response.status_code = 500
            return response


@health_ns.route('/drive-ping', methods=['GET'])
class DrivePing(Resource):
    """Lightweight Drive connectivity check: tries to list 1 file using service account credentials."""
    def get(self):
        try:
            service = get_drive_service()
        except Exception as e:
            logging.error(f"[API][drive-ping] Drive credentials/setup error: {e}")
            return make_response(jsonify({'success': False, 'message': 'Drive credentials/setup error', 'error': str(e)}), 503)
        try:
            res = service.files().list(pageSize=1, fields='files(id)').execute()
            files = res.get('files', []) if isinstance(res, dict) else []
            return jsonify({'success': True, 'message': 'Drive reachable', 'sample_files': len(files)})
        except Exception as e:
            logging.error(f"[API][drive-ping] Drive API call failed: {e}")
            return make_response(jsonify({'success': False, 'message': 'Drive API call failed', 'error': str(e)}), 503)

health_simulate_cover_model = health_ns.model('SimulateCoverLoadRequest', {
    'file_ids': fields.List(fields.String, required=True, description='List of cover ids to request'),
    'num_users': fields.Integer(required=False, description='Number of simulated users', default=200),
    'concurrency': fields.Integer(required=False, description='Concurrent worker threads', default=20)
})

health_test_notifications_model = health_ns.model('TestSendScheduledNotificationsRequest', {
    'test_email': fields.String(required=True, description='Recipient email for test notifications'),
    'num_notifications': fields.Integer(required=False, description='Number of fake notifications to send', default=10)
})

# Paginated PDF list endpoint
@health_ns.route('/list-pdfs/<folder_id>')
@health_ns.expect(health_list_pdfs_parser, validate=False)
class ListPdfs(Resource):
    def get(self, folder_id):
        try:
            if not folder_id:
                response = make_response(jsonify({'success': False, 'message': 'Folder ID is required.'}))
                response.status_code = 400
                return response
            page = int(request.args.get('page', 1))
            page_size = int(request.args.get('page_size', 50))
            if page_size > 200:
                page_size = 200
            offset = (page - 1) * page_size
            drive_folder_id = folder_id
            service = get_drive_service()
            query = f"'{drive_folder_id}' in parents and mimeType='application/pdf' and trashed=false"
            drive_files = []
            page_token = None
            try:
                while True:
                    response = service.files().list(
                        q=query,
                        spaces='drive',
                        fields='nextPageToken, files(id, name, createdTime, modifiedTime)',
                        pageToken=page_token
                    ).execute()
                    drive_files.extend(response.get('files', []))
                    page_token = response.get('nextPageToken', None)
                    if not page_token:
                        break
            except Exception as e:
                response = make_response(jsonify({'success': False, 'message': f'Error listing files from Drive: {e}'}))
                response.status_code = 500
                return response
            existing_books = {b.drive_id: b for b in Book.query.filter(Book.drive_id.in_([f['id'] for f in drive_files])).all()}
            total_count = len(drive_files)
            paged_files = drive_files[offset:offset+page_size]
            pdf_list = []
            for f in paged_files:
                pdf_list.append({
                    'id': f['id'],
                    'title': f.get('name', 'Untitled'),
                    'createdTime': f.get('createdTime'),
                    'modifiedTime': f.get('modifiedTime')
                })
            mem = psutil.Process().memory_info().rss / (1024 * 1024)
            logging.info(f"[list-pdfs] Memory usage: {mem:.2f} MB for folder_id={drive_folder_id}")
            return jsonify({
                'pdfs': pdf_list,
                'page': page,
                'page_size': page_size,
                'total_count': total_count,
                'has_more': offset + len(pdf_list) < total_count
            })
        except ValueError as ve:
            logging.error(f"Invalid input in /list-pdfs/: {ve}")
            response = make_response(jsonify({'success': False, 'message': 'Invalid input parameters.'}))
            response.status_code = 400
            return response
        except Exception as e:
            logging.error(f"Error in paginated /list-pdfs/: {e}")
            response = make_response(jsonify({'error': 'Failed to list PDFs', 'details': str(e)}))
            response.status_code = 500
            return response

@health_ns.route('/cover-queue-health', methods=['GET'])
class CoverQueueHealth(Resource):
    def get(self):
        status = get_queue_status()
        return jsonify({
            'success': True,
            'active': status['active'],
            'queue_length': status['queue_length'],
            'queue': status['queue'],
            'sessions': status['sessions'],
        })

@health_ns.route('/server-health', methods=['GET'])
class ServerHealth(Resource):
    def get(self):
        """
        Health check endpoint: verifies DB connectivity. Returns success: true if DB responds, else false.
        """
        try:
            db.session.execute(text('SELECT 1'))
            return jsonify({'success': True})
        except Exception as e:
            logging.error(f"[server_health] DB health check failed: {e}")
            return jsonify({'success': False, 'error': str(e)})

@health_ns.route('/health', methods=['GET'])
class HealthCheck(Resource):
    def get(self):
        """
        Health check endpoint for Render.com. Returns 200 OK and JSON status.
        Only log if status is not 200.
        """
        try:
            response = make_response(jsonify({'success': True, 'status': 'ok', 'message': 'Service is healthy.'}))
            response.status_code = 200
            return response
        except Exception as e:
            logging.error(f"Error in /health/: {e}")
            response = make_response(jsonify({'success': False, 'status': 'error', 'message': 'Health check failed.', 'details': str(e)}))
            response.status_code = 500
            return response

@health_ns.route('/cover-diagnostics', methods=['GET'])
class CoverDiagnostics(Resource):
    def get(self):
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

api.add_namespace(health_ns, path='/api')

@health_ns.route('/pubsub-ping', methods=['GET'])
class PubsubPing(Resource):
    def get(self):
        """Attempt a lightweight publish to the configured Pub/Sub topic to verify credentials and connectivity.

        Returns 200 + publish result on success, 503 on publish failure, and 400 when config is missing.
        """
        project = os.getenv('GOOGLE_PROJECT_ID')
        topic_name = os.getenv('PUBSUB_TOPIC_NAME')
        if not project or not topic_name:
            response = make_response(jsonify({'success': False, 'message': 'PUBSUB config (GOOGLE_PROJECT_ID/PUBSUB_TOPIC_NAME) not set.'}))
            response.status_code = 400
            return response
        topic = f'projects/{project}/topics/{topic_name}'
        try:
            # Use service account info to build Pub/Sub client via googleapiclient
            pubsub_scopes = ['https://www.googleapis.com/auth/pubsub']
            creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=pubsub_scopes)
            pubsub_service = build('pubsub', 'v1', credentials=creds)
            body = {
                'messages': [
                    {'data': base64.b64encode(b'pubsub-ping').decode('utf-8')}
                ]
            }
            result = pubsub_service.projects().topics().publish(topic=topic, body=body).execute()
            logging.info(f"[PubSub ping] Published test message to {topic}: {result}")
            return jsonify({'success': True, 'result': result})
        except Exception as e:
            logging.error(f"[PubSub ping] Failed to publish to topic {topic}: {e}")
            response = make_response(jsonify({'success': False, 'message': str(e)}))
            response.status_code = 503
            return response


def publish_drive_to_pubsub(resource_id, resource_state, extra=None):
    """Publish a small message to the configured Pub/Sub topic for downstream processing.

    This is best-effort and will not raise on failure; callers should catch exceptions
    if they need blocking behavior.
    """
    project = os.getenv('GOOGLE_PROJECT_ID')
    topic_name = os.getenv('PUBSUB_TOPIC_NAME')
    if not project or not topic_name:
        logging.warning('[PubSub publish] PUBSUB config missing; skipping publish')
        return None
    topic = f'projects/{project}/topics/{topic_name}'
    try:
        pubsub_scopes = ['https://www.googleapis.com/auth/pubsub']
        creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=pubsub_scopes)
        pubsub_service = build('pubsub', 'v1', credentials=creds)
        payload = {'resourceId': resource_id, 'resourceState': resource_state}
        if extra and isinstance(extra, dict):
            payload.update(extra)
        data_b64 = base64.b64encode(json.dumps(payload).encode('utf-8')).decode('utf-8')
        body = {
            'messages': [
                {
                    'data': data_b64,
                    'attributes': {
                        'resourceId': str(resource_id) if resource_id else '',
                        'resourceState': str(resource_state) if resource_state else ''
                    }
                }
            ]
        }
        result = pubsub_service.projects().topics().publish(topic=topic, body=body).execute()
        logging.info(f"[PubSub publish] Published Drive notification to {topic}: {result}")
        return result
    except Exception as e:
        logging.error(f"[PubSub publish] Failed to publish Drive notification: {e}")
        return None


# === Webhooks & Integrations ===
# -- Swagger models/parsers for integrations namespace --
github_webhook_model = integrations_ns.model('GithubWebhookRequest', {
    'ref': fields.String(required=False, description='Git ref, e.g. refs/heads/main'),
    'repository': fields.Raw(required=False, description='Repository object'),
    'commits': fields.List(fields.Raw, required=False, description='List of commits')
})

authorize_parser = integrations_ns.parser()
authorize_parser.add_argument('redirect', type=str, required=False, location='args', help='Optional redirect target after authorize')

@integrations_ns.route('/drive-webhook', methods=['POST'])
class DriveWebhook(Resource):
    def post(self):
        # Verify JWT token from Pub/Sub (expect OIDC identity token)
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 401
            return response

        token = auth_header.split(' ')[1]
        try:
            # Verify the identity token using google.oauth2.id_token
            # Build a prioritized list of accepted audiences to try.
            # 1) PUBSUB_AUDIENCE (the push endpoint)
            # 2) any audiences listed in PUBSUB_ACCEPTED_AUD (comma-separated env var)
            # 3) GOOGLE_CLIENT_ID (legacy debug fallback)
            primary_audience = os.getenv('PUBSUB_AUDIENCE')
            accepted_auds = []
            if primary_audience:
                accepted_auds.append(primary_audience)
            extra = os.getenv('PUBSUB_ACCEPTED_AUD', '')
            if extra:
                for a in [x.strip() for x in extra.split(',') if x.strip()]:
                    if a not in accepted_auds:
                        accepted_auds.append(a)
            google_client_id = os.getenv('GOOGLE_CLIENT_ID')
            if google_client_id and google_client_id not in accepted_auds:
                accepted_auds.append(google_client_id)

            decoded_token = None
            last_error = None
            for aud in accepted_auds:
                try:
                    decoded_token = id_token.verify_oauth2_token(token, Request(), audience=aud)
                    logging.info(f"Verified JWT claims (aud={aud}): {decoded_token}")
                    matched_audience = aud
                    break
                except ValueError as e_aud:
                    logging.warning(f"Audience verification failed for aud={aud}: {e_aud}")
                    last_error = e_aud
                    continue
            if decoded_token is None:
                # None of the candidate audiences worked
                logging.error(f"JWT verification failed for all candidate audiences. Last error: {last_error}")
                raise last_error if last_error else ValueError('JWT verification failed')
        except ValueError as e:
            # Token verification failed for all attempted audiences
            logging.error(f"JWT verification failed: {e}")
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 401
            return response
        except Exception as e:
            logging.error(f"Unexpected error during JWT verification: {e}")
            response = make_response(jsonify({'success': False, 'message': 'Unauthorized'}))
            response.status_code = 401
            return response

        # Debug: log the decoded token claims (safe — token contains no secret keys)
        try:
            logging.info(f"Drive webhook token claims: {{'iss': decoded_token.get('iss'), 'sub': decoded_token.get('sub'), 'aud': decoded_token.get('aud'), 'email': decoded_token.get('email')}}")
        except Exception:
            logging.info("Drive webhook: could not log token claims cleanly")

        # Debug: log raw request body and Pub/Sub message attributes (do not log Authorization header)
        try:
            raw_body = request.get_data(as_text=True)
            logging.info(f"Drive webhook raw body: {raw_body}")
            # Attempt to parse and log message.attributes if present
            try:
                parsed = json.loads(raw_body) if raw_body else {}
                message = parsed.get('message') or {}
                attributes = message.get('attributes') if isinstance(message, dict) else None
                if attributes:
                    logging.info(f"Drive webhook message.attributes: {attributes}")
            except Exception:
                logging.info("Drive webhook: raw body not JSON or attributes missing")
        except Exception:
            logging.info("Drive webhook: failed to read raw request body for diagnostics")

        # Process the webhook event
        channel_id = request.headers.get('X-Goog-Channel-ID')
        resource_id = request.headers.get('X-Goog-Resource-ID')
        resource_state = request.headers.get('X-Goog-Resource-State')
        changed = request.headers.get('X-Goog-Changed')
        logging.info(f"[Drive Webhook] Channel: {channel_id}, Resource: {resource_id}, State: {resource_state}, Changed: {changed}")

        # If Pub/Sub push delivered the Drive change inside the message body/attributes
        # (common when using a Pub/Sub push subscription), prefer those values when
        # the Drive-specific headers are not present.
        try:
            parsed_body = request.get_json(silent=True)
            if parsed_body and isinstance(parsed_body, dict):
                msg = parsed_body.get('message') or {}
                if isinstance(msg, dict):
                    attrs = msg.get('attributes') or {}
                    if attrs:
                        if not resource_id:
                            resource_id = attrs.get('resourceId') or attrs.get('resource_id') or attrs.get('id')
                        if not resource_state:
                            resource_state = attrs.get('resourceState') or attrs.get('resource_state') or attrs.get('state')
                        logging.info(f"[Drive Webhook] Extracted from message.attributes: resource_id={resource_id}, resource_state={resource_state}")
                    # If message.data contains a JSON payload, try to parse it for a resource id too
                    data_b64 = msg.get('data')
                    if data_b64 and not resource_id:
                        try:
                            data_decoded = base64.b64decode(data_b64)
                            try:
                                data_json = json.loads(data_decoded)
                                # common keys
                                resource_id = resource_id or data_json.get('resourceId') or data_json.get('resource_id') or data_json.get('id')
                                resource_state = resource_state or data_json.get('resourceState') or data_json.get('resource_state')
                            except Exception:
                                # not JSON, ignore
                                pass
                        except Exception:
                            pass
        except Exception:
            logging.info('[Drive Webhook] Could not parse Pub/Sub message body for attributes.')

        # Best-effort: forward the notification into Pub/Sub so downstream
        # consumers won't miss it if they rely on Pub/Sub. This does not
        # replace direct Pub/Sub watch registration, but acts as a fallback
        # when Drive->Pub/Sub is unavailable.
        try:
            pub_result = publish_drive_to_pubsub(resource_id, resource_state, extra={'fileId': resource_id})
            if pub_result:
                logging.info(f"[Drive Webhook] Forwarded notification to Pub/Sub: {pub_result}")
        except Exception as e:
            logging.warning(f"[Drive Webhook] Pub/Sub forward failed (non-fatal): {e}")

        # Only handle 'update' or 'add' events
        if resource_state in ['update', 'add']:
            try:
                service = get_drive_service()
                try:
                    file_metadata = service.files().get(fileId=resource_id, fields='id, name, createdTime, modifiedTime').execute()
                except Exception as e:
                    logging.error(f"[resource meta] Drive get failed for {resource_id}: {e}")
                    file_metadata = None

                # Check if the book already exists in the database
                book = Book.query.filter_by(drive_id=resource_id).first()
                if not book:
                    # Extract external story ID from the PDF
                    external_story_id = None
                    try:
                        try:
                            file_request = service.files().get_media(fileId=resource_id)
                        except Exception as e:
                            logging.error(f"[resource download] Drive get_media creation failed for {resource_id}: {e}")
                            file_request = None
                        file_content = file_request.execute()
                        external_story_id = extract_story_id_from_pdf(file_content)
                    except Exception as e:
                        logging.warning(f"[Drive Webhook] Error extracting story ID for {file_metadata['name']}: {e}")

                    # Add new book
                    new_book = Book(
                        drive_id=file_metadata['id'],
                        title=file_metadata['name'],
                        external_story_id=external_story_id,
                        created_at=file_metadata['createdTime'],
                        updated_at=file_metadata['modifiedTime']
                    )
                    db.session.add(new_book)
                    db.session.commit()

                    # Notify users about the new book
                    users = User.query.all()
                    for user in users:
                        add_notification(
                            user,
                            type_='new_book',
                            title='New Book Added!',
                            body=f"A new book titled '{new_book.title}' has been added.",
                            link=f"/read/{new_book.drive_id}"
                        )
                    logging.info(f"[Drive Webhook] New book added: {new_book.title}")
                else:
                    # Update existing book
                    updated = False
                    if book.title != file_metadata['name']:
                        book.title = file_metadata['name']
                        updated = True
                    if file_metadata['modifiedTime']:
                        book.updated_at = file_metadata['modifiedTime']
                        updated = True

                    # Extract external story ID if missing
                    if not book.external_story_id:
                        try:
                            try:
                                file_request = service.files().get_media(fileId=resource_id)
                            except Exception as e:
                                logging.error(f"[resource download nested] Drive get_media creation failed for {resource_id}: {e}")
                                file_request = None
                            file_content = file_request.execute()
                            external_story_id = extract_story_id_from_pdf(file_content)
                            if external_story_id:
                                book.external_story_id = external_story_id
                                updated = True
                        except Exception as e:
                            logging.warning(f"[Drive Webhook] Error extracting story ID for {file_metadata['name']}: {e}")

                    if updated:
                        db.session.commit()

                        # Notify users about the updated book
                        users = User.query.all()
                        for user in users:
                            add_notification(
                                user,
                                type_='book_update',
                                title='Book Updated!',
                                body=f"The book '{book.title}' has been updated.",
                                link=f"/read/{book.drive_id}"
                            )
                        logging.info(f"[Drive Webhook] Book updated: {book.title}")

            except Exception as e:
                logging.error(f"Error processing Drive webhook: {e}")
        response = make_response('')
        response.status_code = 200
        return response

# --- GitHub Webhook for App Update Notifications ---
@integrations_ns.route('/github-webhook', methods=['POST'])
@integrations_ns.expect(github_webhook_model, validate=False)
class GithubWebhook(Resource):
    def post(self):
        """
        Receives GitHub webhook payload for push events and sends app update notifications to all users.
        """
        data = request.get_json()
        if not data or data.get('ref') is None or 'commits' not in data:
            response = make_response(jsonify({'success': False, 'message': 'Invalid payload.'}))
            response.status_code = 400
            return response
        repo = data.get('repository', {}).get('full_name', 'Unknown repo')
        branch = data.get('ref', '').split('/')[-1]
        commits = data.get('commits', [])
        commit_msgs = [c.get('message', '') for c in commits]
        committers = [c.get('committer', {}).get('name', '') for c in commits]
        summary = f"Site updated on branch '{branch}' in repo '{repo}'.\n"
        for i, msg in enumerate(commit_msgs):
            summary += f"- {msg} (by {committers[i]})\n"
        # Use notification endpoint for app update
        try:
            resp = requests.post(f'{os.getenv("VITE_HOST_URL", "http://localhost")}:{os.getenv("PORT", 5000)}/api/notify-app-update', json={
                'summary': summary
            })
            if resp.status_code != 200:
                logging.error(f"Error notifying app update: {resp.text}")
        except Exception as e:
            logging.error(f"Error notifying app update: {e}")
        return jsonify({'success': True, 'message': 'App update notifications sent.'})

@integrations_ns.route('/authorize')
@integrations_ns.expect(authorize_parser, validate=False)
class Authorize(Resource):
    def get(self):
        try:
            creds = service_account.Credentials.from_service_account_info(
                service_account_info,
                scopes=SCOPES
            )
        except Exception as e:
            logging.error(f"/api/authorize: Failed to build service account credentials: {e}")
            # Return 503 so scanners know this endpoint is unavailable in this environment
            response = make_response(jsonify({'success': False, 'message': f'Authorization unavailable: {e}'}))
            response.status_code = 503
            return response
        return redirect("/")

api.add_namespace(integrations_ns, path='/api')

# === Static ===

@app.route("/")

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
        response = make_response(jsonify({"success": False, "message": "API endpoint not found.", "hint": "See / for API Almanac."}))
        response.status_code = 404
        return response

    # 2. Serve cover images from disk if requested
    if path.startswith("covers/") and path.endswith(".jpg"):
        cover_id = path.split("/")[-1].replace(".jpg", "")
        cover_path = os.path.join(covers_dir, f"{cover_id}.jpg")
        if os.path.exists(cover_path):
            return send_from_directory(covers_dir, f"{cover_id}.jpg")
        else:
            response = make_response(jsonify({"success": False, "message": f"Cover {cover_id}.jpg not found."}))
            response.status_code = 404
            return response

    # 3. Serve favicon.ico from frontend static dir (or vite.svg)
    if path == "favicon.ico":
        vite_svg_path = os.path.join(frontend_static_dir, "vite.svg")
        if os.path.exists(vite_svg_path):
            return send_from_directory(frontend_static_dir, "vite.svg")
        else:
            response = make_response(jsonify({"success": False, "message": "vite.svg not found in frontend static directory."}))
            response.status_code = 404
            return response

    # 4. Serve static files (css, js, images) from frontend static dir
    static_extensions = [".css", ".js", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".json"]
    if any(path.endswith(ext) for ext in static_extensions):
        static_file_path = os.path.join(frontend_static_dir, path)
        if os.path.exists(static_file_path):
            return send_from_directory(frontend_static_dir, path)
        else:
            response = make_response(jsonify({"success": False, "message": f"Static file {path} not found."}))
            response.status_code = 404
            return response

    # 5. Serve index.html for all other non-API routes (React SPA fallback)
    try:
        index_path = os.path.join(frontend_static_dir, "index.html")
        if os.path.exists(index_path):
            return send_from_directory(frontend_static_dir, "index.html")
        else:
            response = make_response(jsonify({"success": False, "message": "index.html not found in frontend static directory."}))
            response.status_code = 404
            return response
    except Exception as e:
        # 6. Render.com fallback: return helpful JSON if index.html missing
        response = make_response(jsonify({"success": False, "message": "Frontend not found. This may be a Render.com deployment issue.", "error": str(e), "hint": "Check / for API Almanac."}))
        response.status_code = 404
        return response

@app.route('/<filename>')
def serve_static_file(filename):
    static_dir = os.path.join(os.path.dirname(__file__), '..', 'client', 'public')
    file_path = os.path.join(static_dir, filename)
    if os.path.exists(file_path):
        return send_from_directory(static_dir, filename)
    response = make_response(jsonify({"message": f"Static file {filename} not found.", "success": False}))
    response.status_code = 404
    return response

# === Main ===
if __name__ == '__main__':
    # Register Google Drive webhook on startup
    try:
        folder_id = os.getenv('GOOGLE_DRIVE_FOLDER_ID') or os.getenv('GOOGLE_DRIVE_FOLDER_ID')
        webhook_url = os.getenv('PUBSUB_AUDIENCE') or os.getenv('PUBSUB_TOPIC') or os.getenv('PUBSUB_TOPIC_NAME')
        if not folder_id:
            logging.warning('Google Drive webhook not registered: GOOGLE_DRIVE_FOLDER_ID is not set.')
        elif not webhook_url:
            logging.warning('Google Drive webhook not registered: PUBSUB_AUDIENCE/PUBSUB_TOPIC_NAME is not set.')
        else:
            try:
                setup_drive_webhook(folder_id, webhook_url)
                logging.info("Google Drive webhook registered on startup.")
            except Exception as e:
                logging.error(f"Failed to register Google Drive webhook during startup: {e}")
        logging.info("Tracemalloc started for memory tracking.")
    except Exception as e:
        logging.error(f"Failed startup webhook block: {e}")
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=os.getenv("DEBUG", True))