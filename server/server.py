#server/server.py
from apscheduler.schedulers.background import BackgroundScheduler
try:
    # For production (when run as a package)
    from .drive_webhook import setup_drive_webhook
except ImportError:
    # For local testing (when run as a script)
    from drive_webhook import setup_drive_webhook
import traceback
from flask import Flask, jsonify, send_file, redirect, send_from_directory, make_response, request
import threading
import time
import uuid
import tempfile
from collections import deque
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from flask_mail import Mail, Message
import fitz  # PyMuPDF
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
from google.oauth2 import service_account
import io
import os
import base64
import hashlib
import datetime
import json
from dotenv import load_dotenv
from PIL import Image
import psutil
import logging
import gc

load_dotenv()

app = Flask(__name__)

# --- Fair Queuing for Cover Requests ---
cover_request_queue = deque()  # Each entry: {session_id, file_id, timestamp}
cover_queue_lock = threading.Lock()
cover_queue_active = None  # Currently processing: {session_id, file_id, timestamp}
cover_queue_last_cleanup = 0

# --- Fair Queuing for Text Requests ---
text_request_queue = deque()  # Each entry: {session_id, file_id, page_num, timestamp}
text_queue_lock = threading.Lock()
text_queue_active = None  # Currently processing: {session_id, file_id, page_num, timestamp}
text_queue_last_cleanup = 0

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

# Session heartbeat tracking

session_last_seen = {}  # session_id: last_seen_timestamp
SESSION_TIMEOUT = 60  # seconds

def heartbeat(session_id):
    """Update the last seen timestamp for a session. Used to track active sessions and clean up timed-out requests."""
    session_last_seen[session_id] = time.time()

def cleanup_cover_queue():
    try:
        now = time.time()
        to_remove = set()
        for entry in list(cover_request_queue):
            sid = entry['session_id']
            if sid not in session_last_seen or now - session_last_seen[sid] > SESSION_TIMEOUT:
                to_remove.add(sid)
        before_len = len(cover_request_queue)
        filtered = [e for e in cover_request_queue if e['session_id'] not in to_remove]
        cover_request_queue.clear()
        cover_request_queue.extend(filtered)
        global cover_queue_active
        if cover_queue_active and cover_queue_active['session_id'] in to_remove:
            cover_queue_active = None
        if to_remove:
            logging.info(f"[cleanup_cover_queue] Removed {len(to_remove)} stale sessions from queue.")
    except Exception as e:
        logging.error(f"[cleanup_cover_queue] Error: {e}")

def get_queue_status():
    acquired = cover_queue_lock.acquire(timeout=5)
    if not acquired:
        logging.error("[get_queue_status] Could not acquire cover_queue_lock after 5 seconds! Possible deadlock.")
        return {
            'active': None,
            'queue': [],
            'queue_length': 0,
            'sessions': []
        }
    try:
        return {
            'active': cover_queue_active,
            'queue': list(cover_request_queue),
            'queue_length': len(cover_request_queue),
            'sessions': list(session_last_seen.keys()),
        }
    finally:
        cover_queue_lock.release()


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
CORS(app, origins=["http://localhost:5173", "https://storyweavechronicles.onrender.com"])
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

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

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

# --- User Model ---
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

# --- Voting Model ---
class Vote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    book_id = db.Column(db.String(128), db.ForeignKey('book.drive_id'), nullable=False)
    value = db.Column(db.Integer, nullable=False)  # 1-5 stars
    timestamp = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

# --- Comment Model ---
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

# --- Webhook Model ---
class Webhook(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    channel_id = db.Column(db.String(128), unique=True, nullable=False)
    expiration = db.Column(db.BigInteger, nullable=True)  # ms since epoch
    registered_at = db.Column(db.DateTime, default=lambda: datetime.datetime.now(datetime.UTC))

# Create tables if not exist
with app.app_context():
    db.create_all()

# Google Drive API scope
SCOPES = [os.getenv('SCOPES', 'https://www.googleapis.com/auth/drive.readonly')]


# Credential storage
TOKEN_FILE = 'server/token.json'

# --- Story ID Extraction Utility ---
def extract_story_id_from_pdf(file_content):
    """
    Given a PDF file (as bytes or BytesIO), extract the bottom-most line of text from page 1.
    Returns the story ID string, or None if not found.
    """
    import re
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

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

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

# --- Scheduled Email Rollout with Batching ---
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

# --- Notification Utility ---
def add_notification(user, type_, title, body, link=None):
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    import uuid
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

# Endpoint to check for new notifications for polling
@app.route('/api/has-new-notifications', methods=['POST'])
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
    return jsonify({'hasNew': has_new})

# --- Admin Utility ---
def is_admin(username):
    user = User.query.filter_by(username=username).first()
    return user and user.is_admin

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
    import traceback
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

@app.route('/authorize')
def authorize():
    creds = service_account.Credentials.from_service_account_info(
        service_account_info,
        scopes=SCOPES
    )
    return redirect("/")

@app.route('/api/update-external-id', methods=['POST'])
def update_external_id():
    """
    Update a book's external_story_id if a new PDF version contains a valid external ID and the current value is missing or blank.
    Body: { "book_id": <drive_id>, "pdf_bytes": <base64-encoded PDF> }
    """
    import base64
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

        # Query PDFs from database (Book model)
        total_count = Book.query.count()
        pdfs = Book.query.order_by(Book.created_at.desc()).offset(offset).limit(page_size).all()
        pdf_list = []
        for book in pdfs:
            # Try to get createdTime and modifiedTime from version_history if present
            created_time = None
            modified_time = None
            try:
                history = json.loads(book.version_history) if book.version_history else []
                if history and isinstance(history, list):
                    created_time = history[0].get('created')
            except Exception:
                pass
            if not created_time:
                created_time = book.created_at.isoformat() if book.created_at else None
            if book.updated_at:
                modified_time = book.updated_at.isoformat()
            else:
                modified_time = created_time
            pdf_list.append({
                'id': book.drive_id,
                'title': book.title,
                'external_story_id': book.external_story_id,
                'createdTime': created_time,
                'modifiedTime': modified_time,
                'created_at': book.created_at.isoformat() if book.created_at else None,
                'updated_at': book.updated_at.isoformat() if book.updated_at else None
            })
        mem = psutil.Process().memory_info().rss / (1024 * 1024)
        logging.info(f"[list-pdf] Memory usage: {mem:.2f} MB for folder_id={folder_id}")
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
            # ...other fields...
        })
    # Add stubs for missing books
    for missing_id in set(ids) - found_ids:
        result.append({
            'id': missing_id,
            'missing': True
        })
    return jsonify({'books': result})

@app.route('/download-pdf/<file_id>')
def download_pdf(file_id):
    try:
        service = get_drive_service()
        file_metadata = service.files().get(fileId=file_id, fields='name').execute()
        filename = file_metadata.get('name', 'downloaded.pdf')
        request = service.files().get_media(fileId=file_id)
        def generate():
            downloader = request
            chunk_size = 1024 * 64  # 64KB
            data = downloader.execute()
            buf = memoryview(data)
            offset = 0
            while offset < len(buf):
                yield buf[offset:offset+chunk_size]
                offset += chunk_size
        mem = psutil.Process().memory_info().rss / (1024 * 1024)
        logging.info(f"[download-pdf] Memory usage: {mem:.2f} MB for file_id={file_id}, filename={filename}")
        response = make_response(generate())
        response.headers['Content-Type'] = 'application/pdf'
        response.headers['Content-Disposition'] = f'attachment; filename="{filename}"'
        response.headers["Access-Control-Allow-Origin"] = "https://storyweavechronicles.onrender.com"
        return response
    except Exception as e:
        response = make_response(jsonify(error=str(e)), 500)
        response.headers["Access-Control-Allow-Origin"] = "https://storyweavechronicles.onrender.com"
        return response

# --- Health Check for Cover Queue ---
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

@app.route('/pdf-cover/<file_id>', methods=['GET'])
def pdf_cover(file_id):
    global cover_queue_active
    session_id = request.args.get('session_id') or request.headers.get('X-Session-Id')
    if not session_id:
        return jsonify({'success': False, 'error': 'Missing session_id'}), 400
    heartbeat(session_id)
    entry = {'session_id': session_id, 'file_id': file_id, 'timestamp': time.time()}
    acquired = cover_queue_lock.acquire(timeout=5)
    if not acquired:
        logging.error("[pdf-cover] Could not acquire cover_queue_lock after 5 seconds! Possible deadlock.")
        return jsonify({'success': False, 'error': 'Server busy, try again later.'}), 503
    try:
        cover_request_queue.append(entry)
        logging.info(f"[pdf-cover] Queue length after append: {len(cover_request_queue)}")
    finally:
        cover_queue_lock.release()
    # --- Queue/delay requests BEFORE starting the timeout timer ---
    # Wait until this request is at the front of the queue and no active request
    logging.info(f"[pdf-cover] Entering waiting loop: Queue length in wait loop: {len(cover_request_queue)}")
    while True:
        with cover_queue_lock:
            cleanup_cover_queue()  # Always called inside locked context
            if cover_request_queue and cover_request_queue[0]['session_id'] == session_id and cover_request_queue[0]['file_id'] == file_id:
                if cover_queue_active is None:
                    cover_queue_active = entry
                    break
        time.sleep(0.05)
    # Now at front of queue, start the timeout timer for actual processing
    wait_start = time.time()
    # ...existing code...
    # --- Actual cover extraction logic ---
    def send_fallback():
        logging.error(f"[pdf-cover] Fallback image used for file_id={file_id}")
        fallback_path = os.path.join('..', 'client', 'public', 'no-cover.png')
        if not os.path.exists(fallback_path):
            logging.error(f"[pdf-cover] Fallback image not found at {fallback_path}")
            return make_response(jsonify({'error': 'No cover available'}), 404)
        logging.info(f"[pdf-cover] Serving fallback cover for file_id={file_id}")
        response = make_response(send_file(fallback_path, mimetype='image/png'))
        response.headers["Access-Control-Allow-Origin"] = "https://storyweavechronicles.onrender.com"
        response.status_code = 404
        return response

    logging.info(f"[pdf-cover] Request for file_id={file_id}")
    try:
        logging.info(f"[pdf-cover] Queue entry: session_id={session_id}, file_id={file_id}")
        service = get_drive_service()
        logging.info(f"[pdf-cover] Got Drive service for file_id={file_id}")
        request_drive = service.files().get_media(fileId=file_id)
        pdf_bytes = request_drive.execute()
        pdf_size = len(pdf_bytes)
        pdf_header = pdf_bytes[:8]
        logging.info(f"[pdf-cover] Downloaded PDF size: {pdf_size} bytes, header: {pdf_header}")
        # Check if PDF header is valid
        if not pdf_bytes or not pdf_bytes.startswith(b'%PDF'):
            logging.error(f"[pdf-cover] Invalid PDF content for file_id={file_id}. Header: {pdf_header}")
            return send_fallback()
        # Always try temp file first, fallback to in-memory if temp file fails
        doc = None
        try:
            with tempfile.NamedTemporaryFile(delete=True, suffix='.pdf') as tmp_pdf:
                tmp_pdf.write(pdf_bytes)
                tmp_pdf.flush()
                logging.info(f"[pdf-cover] wrote PDF to temp file: {tmp_pdf.name}")
                doc = fitz.open(tmp_pdf.name)
                logging.info(f"[pdf-cover] fitz.open succeeded from temp file for file_id={file_id}")
        except Exception as temp_e:
            logging.error(f"[pdf-cover] fitz.open from temp file failed for file_id={file_id}: {temp_e}. Falling back to in-memory.")
            try:
                doc = fitz.open(stream=pdf_bytes, filetype="pdf")
                logging.info(f"[pdf-cover] fitz.open succeeded from memory for file_id={file_id}")
            except Exception as mem_e:
                logging.error(f"[pdf-cover] fitz.open failed from memory for file_id={file_id}: {mem_e}")
                return send_fallback()
        try:
            page = doc.load_page(0)
            pix = page.get_pixmap(matrix=fitz.Matrix(2,2))
            img_bytes = pix.tobytes("jpeg")
            # Downscale and compress
            out = downscale_image(img_bytes, size=(200, 300), format="JPEG", quality=85)
            out.seek(0)
            # Clean up large objects before streaming
            page = None
            pix = None
            doc.close()
            del doc
            del img_bytes
            gc.collect()
            def generate():
                logging.info(f"[pdf-cover] Generator START: session_id={session_id}, file_id={file_id}")
                start_time = time.time()
                timeout = 15  # seconds, max allowed for generator
                try:
                    while True:
                        if time.time() - start_time > timeout:
                            logging.error(f"[pdf-cover] Generator TIMEOUT: session_id={session_id}, file_id={file_id}, duration={time.time() - start_time:.2f}s")
                            break
                        chunk = out.read(128 * 1024)  # 128KB chunks for faster streaming and lower memory
                        if not chunk:
                            break
                        yield chunk
                    duration = time.time() - start_time
                    logging.info(f"[pdf-cover] Generator FINISH: session_id={session_id}, file_id={file_id}, duration={duration:.2f}s")
                except Exception as gen_e:
                    logging.error(f"[pdf-cover] Generator ERROR: session_id={session_id}, file_id={file_id}, error={gen_e}")
                    raise
                finally:
                    out.close()
                    gc.collect()
                    logging.info(f"[pdf-cover] Generator CLEANUP: session_id={session_id}, file_id={file_id} (gc.collect called)")
            mem = psutil.Process().memory_info().rss / (1024 * 1024)
            logging.info(f"[pdf-cover] Memory usage: {mem:.2f} MB for file_id={file_id}")
            MEMORY_LOW_THRESHOLD_MB = int(os.getenv('MEMORY_LOW_THRESHOLD_MB', '250'))
            MEMORY_HIGH_THRESHOLD_MB = int(os.getenv('MEMORY_HIGH_THRESHOLD_MB', '350'))
            if mem > MEMORY_LOW_THRESHOLD_MB:
                logging.warning(f"[pdf-cover] WARNING: Memory usage {mem:.2f} MB exceeds LOW threshold of {MEMORY_LOW_THRESHOLD_MB} MB!")
            if mem > MEMORY_HIGH_THRESHOLD_MB:
                logging.error(f"[pdf-cover] ERROR: Memory usage {mem:.2f} MB exceeds HIGH threshold of {MEMORY_HIGH_THRESHOLD_MB} MB! Consider spinning down or restarting the server.")
            response = make_response(generate())
            response.headers["Content-Type"] = "image/jpeg"
            response.headers["Access-Control-Allow-Origin"] = "https://storyweavechronicles.onrender.com"
            return response
        except Exception as page_e:
            logging.error(f"[pdf-cover] Error processing PDF page for file_id={file_id}: {page_e}")
            return send_fallback()
    except Exception as e:
        logging.error(f"[pdf-cover] Error fetching file from Drive for file_id={file_id}: {e}")
        return send_fallback()
    finally:
        acquired = cover_queue_lock.acquire(timeout=5)
        if not acquired:
            logging.error("ERROR: Could not acquire cover_queue_lock in pdf_cover finally block after 5 seconds! Possible deadlock.")
        else:
            if cover_request_queue and cover_request_queue[0] == entry:
                cover_request_queue.popleft()
                logging.info(f"[pdf-cover] Queue length after popleft: {len(cover_request_queue)}")
            if cover_queue_active == entry:
                cover_queue_active = None
            cover_queue_lock.release()

@app.route('/api/pdf-text/<file_id>', methods=['GET'])
def pdf_text(file_id):
    """
    Extracts text and images from a single PDF page in Google Drive by file_id and page number.
    Query params: page (1-based), session_id (optional)
    Returns: {"success": True, "page": n, "text": ..., "images": [...]} or error JSON.
    """
    global text_queue_active
    global text_queue_lock
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
        # ...existing code...

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
            if page_num < 1 or page_num > doc.page_count:
                doc.close()
                logging.error(f"[pdf-text] invalid page number: {page_num} for file_id={file_id}")
                response = jsonify({
                    "success": False,
                    "error": f"Page {page_num} is out of range.",
                    "total_pages": doc.page_count,
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
    
@app.route('/api/update-colors', methods=['POST'])
def update_colors():
    data = request.get_json()
    username = data.get('username')
    backgroundColor = data.get('backgroundColor')
    textColor = data.get('textColor')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if backgroundColor:
        user.background_color = backgroundColor
    if textColor:
        user.text_color = textColor
    db.session.commit()
    # Update all comments by this user to match new colors
    user_comments = Comment.query.filter_by(username=username).all()
    for comment in user_comments:
        comment.background_color = user.background_color
        comment.text_color = user.text_color
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

@app.route('/api/get-notification-prefs', methods=['POST'])
def get_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first() if username else None
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.notification_prefs:
        prefs = json.loads(user.notification_prefs)
    else:
        prefs = {
            'muteAll': False,
            'newBooks': True,
            'updates': True,
            'announcements': True,
            'channels': ['primary'],
            'emailFrequency': 'immediate'
        }
        user.notification_prefs = json.dumps(prefs)
        db.session.commit()
    return jsonify({'success': True, 'prefs': prefs})

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
        if not user:
            logging.warning(f"Notification history: User not found: {username}")
            return jsonify({'success': False, 'message': 'User not found', 'notifications': []})
        history = []
        if user.notification_history:
            try:
                history = json.loads(user.notification_history)
                if not isinstance(history, list):
                    logging.error(f"Notification history for user {username} is not a list. Got: {type(history)}")
                    history = []
            except Exception as e:
                logging.error(f"Error loading notification history for user {username}: {e}")
                history = []
        # Sort by timestamp descending (newest first)
        history.sort(key=lambda n: n.get('timestamp', 0), reverse=True)
        total = len(history)
        start = (page - 1) * page_size
        end = start + page_size
        chunk = history[start:end]
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
        if bm['id'] == book_id:
            return jsonify({'success': True, 'message': 'Already bookmarked.', 'bookmarks': bookmarks})
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    bookmarks.append({'id': book_id, 'last_page': 1, 'last_updated': now, 'unread': False})
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
    user.bookmarks = json.dumps(bookmarks)
    db.session.commit()
    if before == after:
        return jsonify({'success': False, 'message': 'Bookmark not found.', 'bookmarks': bookmarks})
    return jsonify({'success': True, 'message': 'Bookmark removed.', 'bookmarks': bookmarks})

@app.route('/api/set-primary-email', methods=['POST'])
def set_primary_email():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    user = User.query.filter_by(username=username).first()
    if not user or not email:
        return jsonify({'success': False, 'message': 'User or email missing.'}), 400
    if User.query.filter(User.username != username, User.email == email).first():
        return jsonify({'success': False, 'message': 'Email already registered to another account.'}), 400
    user.email = email
    db.session.commit()
    return jsonify({'success': True, 'message': 'Primary email updated.', 'email': email})

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
    if not updated:
        return jsonify({'success': False, 'message': 'Bookmark not found.'}), 404
    user.bookmarks = json.dumps(bookmarks)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Bookmark updated.', 'bookmarks': bookmarks})

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
    from sqlalchemy import func
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
            'name': book.title,
            'cover_url': f'/pdf-cover/{book.drive_id}',
            'votes': vote.value if vote else None
        })
    # Sort by vote value descending, then by title
    result.sort(key=lambda b: (-b['votes'] if b['votes'] is not None else 0, b['title']))
    response = jsonify({'books': result})
    return response, 200

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
            import dateutil.parser
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
    return jsonify({'success': False, 'message': 'Unknown action.'}), 400

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

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    # If the request is for an API route, return JSON 404
    if path.startswith("api/"):
        return jsonify({"success": False, "message": "API endpoint not found."}), 404

    # Serve favicon.ico from client/public (or vite.svg if that's your favicon)
    if path == "favicon.ico":
        return send_from_directory("../client/public", "vite.svg")

    # Serve other static files if needed (add more conditions here)

    # Serve index.html for all other non-API routes
    return send_from_directory("../client/public", "index.html")
# --- GLOBAL BOOK METADATA ENDPOINT ---
@app.route('/api/all-books', methods=['GET'])
def all_books():
    try:
        books = Book.query.all()
        result = []
        for book in books:
            created_time = None
            modified_time = None
            try:
                history = json.loads(book.version_history) if book.version_history else []
                if history and isinstance(history, list):
                    created_time = history[0].get('created')
            except Exception:
                pass
            if not created_time:
                created_time = book.created_at.isoformat() if book.created_at else None
            if book.updated_at:
                modified_time = book.updated_at.isoformat()
            else:
                modified_time = created_time
            result.append({
                'id': book.drive_id,
                'title': book.title,
                'external_story_id': book.external_story_id,
                'createdTime': created_time,
                'modifiedTime': modified_time,
                'created_at': book.created_at.isoformat(),
                'updated_at': book.updated_at.isoformat() if book.updated_at else None
            })
        response = jsonify(success=True, books=result)
        return response
    except Exception as e:
        response = jsonify(success=False, error=str(e))

        return response, 500

@app.route('/api/user-voted-books', methods=['GET'])
def user_voted_books():
    username = request.args.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'Username required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
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

# --- Ban/Unban Endpoints ---
@app.route('/api/admin/ban-user', methods=['POST'])
def ban_user():
    data = request.get_json()
    admin_username = data.get('adminUsername')
    target_username = data.get('targetUsername')
    if not is_admin(admin_username):
        user = User.query.filter_by(username=target_username).first()
        return jsonify({'success': False, 'message': 'Unauthorized'}), 403
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

# --- Manual Seed Endpoint ---
@app.route('/api/seed-drive-books', methods=['POST'])
def seed_drive_books():
    """
    Manually repopulate the Book table from all PDFs in the configured Google Drive folder.
    Returns: {success, added_count, skipped_count, errors}
    """
    try:
        folder_id = os.getenv('GOOGLE_DRIVE_FOLDER_ID')
        if not folder_id:
            return jsonify({'success': False, 'message': 'GOOGLE_DRIVE_FOLDER_ID not set.'}), 500
        service = get_drive_service()
        # List all PDFs in the folder
        query = f"'{folder_id}' in parents and mimeType = 'application/pdf' and trashed = false"
        files = []
        page_token = None
        while True:
            response = service.files().list(
                q=query,
                spaces='drive',
                fields='nextPageToken, files(id, name)',
                pageToken=page_token
            ).execute()
            files.extend(response.get('files', []))
            page_token = response.get('nextPageToken', None)
            if not page_token:
                break
        added_count = 0
        skipped_count = 0
        errors = []
        for f in files:
            drive_id = f['id']
            title = f['name']
            # Check if already exists
            if Book.query.filter_by(drive_id=drive_id).first():
                skipped_count += 1
                continue
            # Try to extract external_story_id from PDF
            try:
                request = service.files().get_media(fileId=drive_id)
                file_content = request.execute()
                external_story_id = extract_story_id_from_pdf(file_content)
            except Exception as e:
                external_story_id = None
                errors.append(f"Error extracting story ID for {title}: {e}")
            book = Book(
                drive_id=drive_id,
                title=title,
                external_story_id=external_story_id,
                version_history=None
            )
            db.session.add(book)
            added_count += 1
        db.session.commit()
        return jsonify({
            'success': True,
            'added_count': added_count,
            'skipped_count': skipped_count,
            'errors': errors,
            'message': f'Seeded {added_count} new books, skipped {skipped_count} already present.'
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

@app.route('/api/cover-exists/<file_id>', methods=['GET'])
def cover_exists(file_id):
    try:
        service = get_drive_service()
        # Only check if the file exists in Drive, not if a cover is generated
        file_metadata = service.files().get(fileId=file_id, fields='id').execute()
        return jsonify({'exists': True})
    except Exception:
        return jsonify({'exists': False})

if __name__ == '__main__':
    # Register Google Drive webhook on startup
    try:
        folder_id = os.getenv('GOOGLE_DRIVE_FOLDER_ID')
        webhook_url = 'https://swcflaskbackend.onrender.com/api/drive-webhook'
        setup_drive_webhook(folder_id, webhook_url)
        logging.info("Google Drive webhook registered on startup.")
    except Exception as e:

        logging.error(f"Failed to register Google Drive webhook: {e}")
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
                            subject = f"Your {frequency.capitalize()} StoryWeave Notifications"
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
    scheduler = BackgroundScheduler()
    scheduler.add_job(lambda: send_scheduled_emails('daily'), 'cron', hour=8)
    scheduler.add_job(lambda: send_scheduled_emails('weekly'), 'cron', day_of_week='mon', hour=8)
    scheduler.add_job(lambda: send_scheduled_emails('monthly'), 'cron', day=1, hour=8)
    # Change from hourly to daily for backup new book check
    scheduler.add_job(check_and_notify_new_books, 'cron', hour=9)
    scheduler.start()
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", 5000)), debug=os.getenv("DEBUG", True))