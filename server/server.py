from flask import Flask, jsonify, send_file, redirect, send_from_directory, request
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

app = Flask(__name__)
CORS(app)

# Google Drive API scope
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

# Credential storage
CREDENTIALS_FILE = 'server/credentials.json'
TOKEN_FILE = 'server/token.json'

# In-memory user store for prototyping (username: {email, password, backgroundColor, textColor, bookmarks})
users = {}

def _now():
    return datetime.datetime.now().strftime('%Y-%m-%d %H:%M')

# Helper to check for duplicate emails
def email_exists(email):
    for user in users.values():
        if user.get('email') == email:
            return True
    return False

# Helper to hash passwords (not secure, just for demo)
def hash_password(password):
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def get_drive_service():
    """Return an authenticated Google Drive service without triggering full OAuth."""
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
    user.setdefault('notificationHistory', []).append({
        'type': type_,
        'title': title,
        'body': body,
        'timestamp': now,
        'read': False
    })

# --- Example Usage ---
# 1. New book added (call after adding a book)
# for user in users.values():
#     add_notification(user, 'newBook', 'New Book Added!', 'A new book is now available in the library.')
#
# 2. Book in favorites updated (call after updating a book)
# for user in users.values():
#     if 'book123' in user.get('bookmarks', []):
#         add_notification(user, 'bookUpdate', 'Book Updated!', 'A book in your favorites has been updated.')
#
# 3. App update (call after deployment or version bump)
# for user in users.values():
#     add_notification(user, 'appUpdate', 'App Updated!', 'Storyweave Chronicles has been updated!')
#
# 4. Welcome message (call after user registration)
# add_notification(new_user, 'welcome', 'Welcome!', 'Thanks for joining Storyweave Chronicles!')

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
    """Extract all text and images from PDF and return as JSON, always include totalPages and images array."""
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())

        doc = fitz.open(stream=file_content, filetype="pdf")
        pages = []

        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            text = page.get_text("text")
            images = []
            for img_index, img in enumerate(page.get_images(full=True)):
                xref = img[0]
                base_image = doc.extract_image(xref)
                img_bytes = base_image["image"]
                img_ext = base_image["ext"]
                # Encode as base64 data URL
                b64 = base64.b64encode(img_bytes).decode("utf-8")
                data_url = f"data:image/{img_ext};base64,{b64}"
                images.append(data_url)
            pages.append({"page": page_num + 1, "text": text, "images": images})

        return jsonify({"pages": pages, "totalPages": len(doc)})
    except Exception as e:
        return jsonify(error=str(e)), 500



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
    if username in users:
        return jsonify({'success': False, 'message': 'Username already exists.'}), 400
    if email_exists(email):
        return jsonify({'success': False, 'message': 'Email already registered.'}), 400
    users[username] = {
        'email': email,
        'password': hash_password(password),
        'backgroundColor': backgroundColor or '#ffffff',
        'textColor': textColor or '#000000',
        'bookmarks': [],
        'secondaryEmails': [],
        'notificationPrefs': {
            'muteAll': False,
            'newBooks': True,
            'updates': True,
            'announcements': True,
            'channels': ['primary']
        },
        'notificationHistory': []
    }
    # Welcome notification
    add_notification(users[username], 'welcome', 'Welcome!', 'Thanks for joining Storyweave Chronicles!')
# Example: New book added event (call this after adding a book to your system)
# def add_new_book(book_title):
#     for user in users.values():
#         if not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('newBooks', True):
#             add_notification(user, 'newBook', 'New Book Added!', f'A new book "{book_title}" is now available in the library.')

# Example: Book in favorites updated event (call this after updating a book)
# def update_book(book_id, book_title):
#     for user in users.values():
#         if book_id in user.get('bookmarks', []) and not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('updates', True):
#             add_notification(user, 'bookUpdate', 'Book Updated!', f'"{book_title}" in your favorites has been updated.')

# Example: App update event (utility endpoint for demonstration)
# @app.route('/api/notify-app-update', methods=['POST'])
# def notify_app_update():
#     for user in users.values():
#         if not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('announcements', True):
#             add_notification(user, 'appUpdate', 'App Updated!', 'Storyweave Chronicles has been updated!')
#     return jsonify({'success': True, 'message': 'App update notification sent to all users.'})
    return jsonify({'success': True, 'message': 'User registered successfully.', 'username': username, 'email': email, 'backgroundColor': backgroundColor or '#ffffff', 'textColor': textColor or '#000000', 'bookmarks': []})

# Get notification preferences
@app.route('/api/notification-prefs', methods=['POST'])
def get_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    return jsonify({'success': True, 'prefs': user.get('notificationPrefs', {})})

# Update notification preferences
@app.route('/api/update-notification-prefs', methods=['POST'])
def update_notification_prefs():
    data = request.get_json()
    username = data.get('username')
    prefs = data.get('prefs')
    user = users.get(username)
    if not user or not isinstance(prefs, dict):
        return jsonify({'success': False, 'message': 'Invalid request.'}), 400
    user['notificationPrefs'] = prefs
    return jsonify({'success': True, 'message': 'Notification preferences updated.'})

# Get notification history
@app.route('/api/notification-history', methods=['POST'])
def get_notification_history():
    data = request.get_json()
    username = data.get('username')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    return jsonify({'success': True, 'history': user.get('notificationHistory', [])})

# Login endpoint

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json()
    identifier = data.get('username')  # could be username or email
    password = data.get('password')
    if not identifier or not password:
        return jsonify({'success': False, 'message': 'Username/email and password required.'}), 400

    # Try to find user by username first
    user = users.get(identifier)
    # If not found, try to find by email
    if not user:
        for uname, u in users.items():
            if u.get('email') == identifier:
                user = u
                identifier = uname
                break
    # --- BEGIN: DELETE THIS BLOCK WHEN USING SQL ---
    # If still not found, auto-register user for dev convenience
    if not user:
        # Use email as username if possible
        email = identifier if '@' in identifier else None
        username = identifier if '@' not in identifier else None
        if not username:
            username = email.split('@')[0] if email else 'user'
        # If email is missing, try to extract from identifier or leave blank
        if not email and '@' in username:
            email = username
        users[username] = {
            'email': email or '',
            'password': hash_password(password),
            'backgroundColor': '#ffffff',
            'textColor': '#000000',
            'bookmarks': [],
            'secondaryEmails': [],
            'notificationPrefs': {
                'muteAll': False,
                'newBooks': True,
                'updates': True,
                'announcements': True,
                'channels': ['primary']
            },
            'notificationHistory': []
        }
        add_notification(users[username], 'welcome', 'Welcome!', 'Thanks for joining Storyweave Chronicles!')
        user = users[username]
        identifier = username
    # --- END: DELETE THIS BLOCK WHEN USING SQL ---
    if not user or user['password'] != hash_password(password):
        return jsonify({'success': False, 'message': 'Invalid username/email or password.'}), 401
    # Return color preferences as part of login response
    found_username = identifier
    return jsonify({
        'success': True,
        'message': 'Login successful.',
        'username': found_username,
        'email': user.get('email'),
        'backgroundColor': user.get('backgroundColor', '#ffffff'),
        'textColor': user.get('textColor', '#000000'),
        'bookmarks': user.get('bookmarks', []),
        'secondaryEmails': user.get('secondaryEmails', [])
    })

# Update user color preferences
@app.route('/api/update-colors', methods=['POST'])
def update_colors():
    data = request.get_json()
    username = data.get('username')
    backgroundColor = data.get('backgroundColor')
    textColor = data.get('textColor')
    if not username or not backgroundColor or not textColor:
        return jsonify({'success': False, 'message': 'Username, backgroundColor, and textColor required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    user['backgroundColor'] = backgroundColor
    user['textColor'] = textColor
    return jsonify({'success': True, 'message': 'Colors updated.'})

# Update user font and timezone preferences
@app.route('/api/update-profile-settings', methods=['POST'])
def update_profile_settings():
    data = request.get_json()
    username = data.get('username')
    font = data.get('font')
    timezone = data.get('timezone')
    if not username:
        return jsonify({'success': False, 'message': 'Username required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if font is not None:
        user['font'] = font
    if timezone is not None:
        user['timezone'] = timezone
    return jsonify({'success': True, 'message': 'Profile settings updated.'})

# Change password endpoint
@app.route('/api/change-password', methods=['POST'])
def change_password():
    data = request.get_json()
    username = data.get('username')
    current_password = data.get('currentPassword')
    new_password = data.get('newPassword')
    if not username or not current_password or not new_password:
        return jsonify({'success': False, 'message': 'All fields are required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user['password'] != hash_password(current_password):
        return jsonify({'success': False, 'message': 'Current password is incorrect.'}), 401
    user['password'] = hash_password(new_password)
    return jsonify({'success': True, 'message': 'Password changed successfully.'})

# Add secondary email endpoint
@app.route('/api/add-secondary-email', methods=['POST'])
def add_secondary_email():
    data = request.get_json()
    username = data.get('username')
    new_email = data.get('email')
    if not username or not new_email:
        return jsonify({'success': False, 'message': 'Username and email required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if new_email == user['email'] or new_email in user.get('secondaryEmails', []):
        return jsonify({'success': False, 'message': 'Email already associated with account.'}), 400
    if email_exists(new_email):
        return jsonify({'success': False, 'message': 'Email already registered to another account.'}), 400
    user.setdefault('secondaryEmails', []).append(new_email)
    return jsonify({'success': True, 'message': 'Secondary email added.', 'secondaryEmails': user['secondaryEmails']})

# Remove secondary email endpoint
@app.route('/api/remove-secondary-email', methods=['POST'])
def remove_secondary_email():
    data = request.get_json()
    username = data.get('username')
    email_to_remove = data.get('email')
    if not username or not email_to_remove:
        return jsonify({'success': False, 'message': 'Username and email required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if email_to_remove not in user.get('secondaryEmails', []):
        return jsonify({'success': False, 'message': 'Email not found in secondary emails.'}), 400
    user['secondaryEmails'].remove(email_to_remove)
    return jsonify({'success': True, 'message': 'Secondary email removed.', 'secondaryEmails': user['secondaryEmails']})

# Delete account endpoint
@app.route('/api/delete-account', methods=['POST'])
def delete_account():
    data = request.get_json()
    username = data.get('username')
    password = data.get('password')
    if not username or not password:
        return jsonify({'success': False, 'message': 'Username and password required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if user['password'] != hash_password(password):
        return jsonify({'success': False, 'message': 'Password incorrect.'}), 401
    del users[username]
    return jsonify({'success': True, 'message': 'Account deleted.'})


# DEVELOPMENT ONLY: Seed notifications for testing notification history UI
# Remove this endpoint before deploying to production!
@app.route('/api/seed-notifications', methods=['POST'])
def seed_notifications():
    data = request.get_json()
    username = data.get('username')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    import datetime
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    user['notificationHistory'] = [
        {'type': 'newBook', 'title': 'New Book Added!', 'body': 'Check out "The Lost Tome" in your library.', 'timestamp': now, 'read': False},
        {'type': 'update', 'title': 'App Update', 'body': 'We have improved the reading experience.', 'timestamp': now, 'read': True},
        {'type': 'announcement', 'title': 'Welcome!', 'body': 'Thanks for joining Storyweave Chronicles.', 'timestamp': now, 'read': True}
    ]
    return jsonify({'success': True, 'message': 'Notifications seeded.', 'history': user['notificationHistory']})

# --- Notification Event Endpoints (for testing/demo) ---
# Remove or secure these before production!

# Notify all users of a new book
@app.route('/api/notify-new-book', methods=['POST'])
def notify_new_book():
    data = request.get_json()
    book_title = data.get('book_title', 'Untitled Book')
    for user in users.values():
        if not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('newBooks', True):
            add_notification(user, 'newBook', 'New Book Added!', f'A new book "{book_title}" is now available in the library.')
    return jsonify({'success': True, 'message': f'Notification sent for new book: {book_title}.'})

# Notify users with a book in favorites of an update
@app.route('/api/notify-book-update', methods=['POST'])
def notify_book_update():
    data = request.get_json()
    book_id = data.get('book_id')
    book_title = data.get('book_title', 'A book in your favorites')
    count = 0
    for user in users.values():
        if book_id in user.get('bookmarks', []) and not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('updates', True):
            add_notification(user, 'bookUpdate', 'Book Updated!', f'"{book_title}" in your favorites has been updated.')
            count += 1
    return jsonify({'success': True, 'message': f'Notification sent to {count} users for book update.'})

# Notify all users of an app update
@app.route('/api/notify-app-update', methods=['POST'])
def notify_app_update():
    for user in users.values():
        if not user.get('notificationPrefs', {}).get('muteAll', False) and user.get('notificationPrefs', {}).get('announcements', True):
            add_notification(user, 'appUpdate', 'App Updated!', 'Storyweave Chronicles has been updated!')
    return jsonify({'success': True, 'message': 'App update notification sent to all users.'})

# --- Google Drive Webhook Endpoint ---
# This endpoint receives push notifications from Google Drive about file changes.
@app.route('/api/drive-webhook', methods=['POST'])
def drive_webhook():
    # Google sends a POST with headers and sometimes an empty body
    channel_id = request.headers.get('X-Goog-Channel-ID')
    resource_id = request.headers.get('X-Goog-Resource-ID')
    resource_state = request.headers.get('X-Goog-Resource-State')
    changed = request.headers.get('X-Goog-Changed')
    # Optionally, validate channel/resource IDs here
    # For now, just log and trigger notification if resource_state is 'update'
    print(f"[Drive Webhook] Channel: {channel_id}, Resource: {resource_id}, State: {resource_state}, Changed: {changed}")
    if resource_state == 'update':
        # TODO: Lookup which book this resource_id maps to, and trigger notification
        # For now, just call the notification util for all users
        # You should implement notify_all_users_of_book_update(resource_id) or similar
        pass
    return '', 200

# --- Enhanced Bookmarks Endpoints ---
@app.route('/api/get-bookmarks', methods=['GET'])
def get_bookmarks():
    username = request.args.get('username')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    return jsonify({'success': True, 'bookmarks': user.get('bookmarks', [])})

@app.route('/api/add-bookmark', methods=['POST'])
def add_bookmark():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    if not username or not book_id:
        return jsonify({'success': False, 'message': 'Username and book_id required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # Bookmarks now store metadata: {id, last_updated, unread, last_page}
    if 'bookmarks' not in user:
        user['bookmarks'] = []
    # Check if already bookmarked
    for bm in user['bookmarks']:
        if bm['id'] == book_id:
            return jsonify({'success': True, 'message': 'Already bookmarked.', 'bookmarks': user['bookmarks']})
    # Add new bookmark
    import datetime
    now = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
    user['bookmarks'].append({'id': book_id, 'last_page': 1, 'last_updated': now, 'unread': False})
    return jsonify({'success': True, 'message': 'Bookmarked.', 'bookmarks': user['bookmarks']})

@app.route('/api/remove-bookmark', methods=['POST'])
def remove_bookmark():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    if not book_id:
        return jsonify({'success': False, 'message': 'Book ID missing.'}), 400
    if 'bookmarks' not in user:
        user['bookmarks'] = []
    before = len(user['bookmarks'])
    user['bookmarks'] = [bm for bm in user['bookmarks'] if bm['id'] != book_id]
    after = len(user['bookmarks'])
    if before == after:
        return jsonify({'success': False, 'message': 'Bookmark not found.', 'bookmarks': user['bookmarks']})
    return jsonify({'success': True, 'message': 'Bookmark removed.', 'bookmarks': user['bookmarks']})
# Endpoint to set/change primary email
@app.route('/api/set-primary-email', methods=['POST'])
def set_primary_email():
    data = request.get_json()
    username = data.get('username')
    email = data.get('email')
    user = users.get(username)
    if not user or not email:
        return jsonify({'success': False, 'message': 'User or email missing.'}), 400
    # Check for duplicate email
    for uname, u in users.items():
        if uname != username and u.get('email') == email:
            return jsonify({'success': False, 'message': 'Email already registered to another account.'}), 400
    user['email'] = email
    return jsonify({'success': True, 'message': 'Primary email updated.', 'email': email})
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    return jsonify({'success': True, 'bookmarks': user.get('bookmarks', [])})

# Update bookmark metadata (last_page, unread)
@app.route('/api/update-bookmark-meta', methods=['POST'])
def update_bookmark_meta():
    data = request.get_json()
    username = data.get('username')
    book_id = data.get('book_id')
    last_page = data.get('last_page')
    unread = data.get('unread')
    if not username or not book_id:
        return jsonify({'success': False, 'message': 'Username and book_id required.'}), 400
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    updated = False
    for bm in user.get('bookmarks', []):
        if bm['id'] == book_id:
            if last_page is not None:
                bm['last_page'] = last_page
            if unread is not None:
                bm['unread'] = unread
            import datetime
            bm['last_updated'] = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')
            updated = True
    if not updated:
        return jsonify({'success': False, 'message': 'Bookmark not found.'}), 404
    return jsonify({'success': True, 'message': 'Bookmark updated.', 'bookmarks': user['bookmarks']})

# Get user profile by username
@app.route('/api/get-user', methods=['POST'])
def get_user():
    data = request.get_json()
    username = data.get('username')
    user = users.get(username)
    if not user:
        return jsonify({'success': False, 'message': 'User not found.'}), 404
    # If primary email is blank, use first secondary email if available
    email = user.get('email')
    if not email:
        secondary = user.get('secondaryEmails', [])
        if secondary and len(secondary) > 0:
            email = secondary[0]
    return jsonify({
        'success': True,
        'username': username,
        'email': email,
        'backgroundColor': user.get('backgroundColor', '#ffffff'),
        'textColor': user.get('textColor', '#000000'),
        'bookmarks': user.get('bookmarks', []),
        'secondaryEmails': user.get('secondaryEmails', []),
        'font': user.get('font', ''),
        'timezone': user.get('timezone', 'UTC'),
        'notificationPrefs': user.get('notificationPrefs', {}),
        'notificationHistory': user.get('notificationHistory', [])
    })

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    if path != "" and os.path.exists(f"../client/dist/{path}"):
        return send_from_directory("../client/dist", path)
    else:
        return send_from_directory("../client/dist", "index.html")

if __name__ == '__main__':
    app.run(debug=True)