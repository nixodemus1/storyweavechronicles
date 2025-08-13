from flask import Flask, jsonify, send_file, redirect, send_from_directory, request
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
import fitz  # PyMuPDF
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import io
import os
import base64
import hashlib
import datetime
import json


app = Flask(__name__)
basedir = os.path.abspath(os.path.dirname(__file__))
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(basedir, 'storyweave.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)
CORS(app)

# SQLAlchemy User model
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
    is_admin = db.Column(db.Boolean, default=False)  # admin privileges


# --- Voting Model ---
class Vote(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), nullable=False)
    book_id = db.Column(db.String(128), nullable=False)
    value = db.Column(db.Integer, nullable=False)  # 1-5 stars
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)

class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    book_id = db.Column(db.String(128), nullable=False)
    username = db.Column(db.String(80), nullable=False)
    parent_id = db.Column(db.Integer, nullable=True)  # null for top-level
    text = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    edited = db.Column(db.Boolean, default=False)
    upvotes = db.Column(db.Integer, default=0)
    downvotes = db.Column(db.Integer, default=0)
    deleted = db.Column(db.Boolean, default=False)  # for moderation

# Create tables if not exist
with app.app_context():
    db.create_all()

# Google Drive API scope
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

# Credential storage
CREDENTIALS_FILE = 'server/credentials.json'
TOKEN_FILE = 'server/token.json'

def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def get_drive_service():
    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    if not creds or not creds.valid:
        raise Exception("No valid credentials. Please visit /authorize to log in.")
    return build('drive', 'v3', credentials=creds)

# --- Notification Utility ---
def add_notification(user, type_, title, body):
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    history = json.loads(user.notification_history) if user.notification_history else []
    history.append({
        'type': type_,
        'title': title,
        'body': body,
        'timestamp': now,
        'read': False
    })
    user.notification_history = json.dumps(history)
    db.session.commit()

@app.route('/authorize')
def authorize():
    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
    creds = flow.run_local_server(port=0)
    with open(TOKEN_FILE, 'w') as token:
        token.write(creds.to_json())
    return redirect("/")

@app.route('/list-pdfs/<folder_id>')
def list_pdfs(folder_id):
    try:
        service = get_drive_service()
        query = f"'{folder_id}' in parents and mimeType='application/pdf'"
        results = service.files().list(q=query, fields="files(id, name, createdTime)").execute()
        files = results.get('files', [])
        return jsonify(pdfs=files)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/view-pdf/<file_id>')
def view_pdf(file_id):
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())
        return send_file(file_content, mimetype='application/pdf')
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/download-pdf/<file_id>')
def download_pdf(file_id):
    try:
        service = get_drive_service()
        file_metadata = service.files().get(fileId=file_id, fields='name').execute()
        filename = file_metadata.get('name', 'downloaded.pdf')
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())
        return send_file(file_content, mimetype='application/pdf', as_attachment=True, download_name=filename)
    except Exception as e:
        return jsonify(error=str(e)), 500

@app.route('/pdf-cover/<file_id>')
def pdf_cover(file_id):
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())
        doc = fitz.open(stream=file_content, filetype="pdf")
        page = doc.load_page(0)
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        img_bytes = io.BytesIO(pix.tobytes("png"))
        return send_file(img_bytes, mimetype="image/png")
    except Exception as e:
        return jsonify(error=str(e)), 500
    
@app.route('/api/pdf-text/<file_id>')
def pdf_text(file_id):
    try:
        service = get_drive_service()
        # Download PDF from Google Drive
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())
        doc = fitz.open(stream=file_content, filetype="pdf")
        pages = []
        for page_num in range(doc.page_count):
            page = doc.load_page(page_num)
            text = page.get_text()
            images = []
            for img in page.get_images(full=True):
                xref = img[0]
                base_image = doc.extract_image(xref)
                img_bytes = base_image['image']
                img_base64 = base64.b64encode(img_bytes).decode('utf-8')
                img_ext = base_image['ext']
                images.append(f"data:image/{img_ext};base64,{img_base64}")
            pages.append({
                'page': page_num + 1,
                'text': text,
                'images': images
            })
        # Try to get metadata (title, etc.)
        title = doc.metadata.get('title') if doc.metadata else None
        name = None
        # Try to get file name from Drive
        try:
            file_metadata = service.files().get(fileId=file_id, fields='name').execute()
            name = file_metadata.get('name')
        except Exception:
            pass
        return jsonify({
            'success': True,
            'id': file_id,
            'title': title,
            'name': name,
            'totalPages': doc.page_count,
            'pages': pages
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

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
    return jsonify({'success': True, 'message': 'Colors updated.', 'backgroundColor': user.background_color, 'textColor': user.text_color})

@app.route('/api/notification-prefs', methods=['POST'])
def get_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
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
            'channels': ['primary']
        }
        user.notification_prefs = json.dumps(prefs)
        db.session.commit()
    return jsonify({'success': True, 'prefs': prefs})

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

@app.route('/api/notification-history', methods=['POST'])
def notification_history():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    history = json.loads(user.notification_history) if user.notification_history else []
    return jsonify({'success': True, 'history': history})

# Update font and timezone for user
@app.route('/api/update-profile-settings', methods=['POST'])
def update_profile_settings():
    data = request.get_json()
    username = data.get('username')
    font = data.get('font')
    timezone = data.get('timezone')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if font is not None:
        user.font = font
    if timezone is not None:
        user.timezone = timezone
    db.session.commit()
    return jsonify({'success': True, 'message': 'Profile settings updated.', 'font': user.font, 'timezone': user.timezone})

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
        'notificationHistory': json.loads(user.notification_history) if user.notification_history else []
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
    return jsonify({'success': True, 'message': 'Registration successful.', 'username': username, 'email': email})

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

@app.route('/api/delete-account', methods=['POST'])
def delete_account():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required.'}), 400
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user.password != hash_password(password):
        return jsonify({'success': False, 'message': 'Password incorrect.'}), 401
    db.session.delete(user)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Account deleted.'})

@app.route('/api/seed-notifications', methods=['POST'])
def seed_notifications():
    data = request.get_json()
    username = data.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    history = [
        {'type': 'newBook', 'title': 'New Book Added!', 'body': 'Check out "The Lost Tome" in your library.', 'timestamp': now, 'read': False},
        {'type': 'update', 'title': 'App Update', 'body': 'We have improved the reading experience.', 'timestamp': now, 'read': True},
        {'type': 'announcement', 'title': 'Welcome!', 'body': 'Thanks for joining Storyweave Chronicles.', 'timestamp': now, 'read': True}
    ]
    user.notification_history = json.dumps(history)
    db.session.commit()
    return jsonify({'success': True, 'message': 'Notifications seeded.', 'history': history})

@app.route('/api/notify-new-book', methods=['POST'])
def notify_new_book():
    data = request.get_json()
    book_title = data.get('book_title', 'Untitled Book')
    users = User.query.all()
    for user in users:
        prefs = json.loads(user.notification_prefs) if user.notification_prefs else {}
        if not prefs.get('muteAll', False) and prefs.get('newBooks', True):
            add_notification(user, 'newBook', 'New Book Added!', f'A new book "{book_title}" is now available in the library.')
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
            add_notification(user, 'bookUpdate', 'Book Updated!', f'"{book_title}" in your favorites has been updated.')
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

@app.route('/api/drive-webhook', methods=['POST'])
def drive_webhook():
    channel_id = request.headers.get('X-Goog-Channel-ID')
    resource_id = request.headers.get('X-Goog-Resource-ID')
    resource_state = request.headers.get('X-Goog-Resource-State')
    changed = request.headers.get('X-Goog-Changed')
    print(f"[Drive Webhook] Channel: {channel_id}, Resource: {resource_id}, State: {resource_state}, Changed: {changed}")
    if resource_state == 'update':
        pass
    return '', 200

@app.route('/api/get-bookmarks', methods=['GET', 'POST'])
def get_bookmarks():
    if request.method == 'POST':
        data = request.get_json()
        username = data.get('username') if data else None
    else:
        username = request.args.get('username')
    user = User.query.filter_by(username=username).first()
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
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
    return jsonify({'success': True, 'bookmarks': bookmarks})

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
        'notificationHistory': json.loads(user.notification_history) if user.notification_history else []
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
        vote.timestamp = datetime.datetime.utcnow()
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

@app.route('/api/user-voted-books', methods=['GET'])
def user_voted_books():
    username = request.args.get('username')
    if not username:
        return jsonify({'success': False, 'message': 'Username required.'}), 400
    votes = Vote.query.filter_by(username=username).all()
    voted_books = [{'book_id': v.book_id, 'value': v.value, 'timestamp': v.timestamp.isoformat()} for v in votes]
    return jsonify({'success': True, 'voted_books': voted_books})

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
    comment.timestamp = datetime.datetime.utcnow()
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
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID required.'}), 400
    comments = Comment.query.filter_by(book_id=book_id).order_by(Comment.timestamp.asc()).all()
    # Build nested replies
    comment_map = {c.id: c for c in comments if not c.deleted}
    tree = []
    for c in comment_map.values():
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
            'replies': []
        }
        if c.parent_id and c.parent_id in comment_map:
            comment_map[c.parent_id].replies.append(item)
        else:
            tree.append(item)
    return jsonify({'success': True, 'comments': tree})

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
        return jsonify({'success': True, 'message': 'Comment deleted.'})
    # Add more moderation actions as needed
    return jsonify({'success': False, 'message': 'Unknown action.'}), 400

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    if path != "" and os.path.exists(f"../client/dist/{path}"):
        return send_from_directory("../client/dist", path)
    else:
        return send_from_directory("../client/dist", "index.html")

if __name__ == '__main__':
    app.run(debug=True)