from flask import Flask, jsonify, send_file, redirect, send_from_directory
from flask_cors import CORS
import fitz  # PyMuPDF
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import io
import os

app = Flask(__name__)
CORS(app)

# Google Drive API scope
SCOPES = ['https://www.googleapis.com/auth/drive.readonly']

# Credential storage
CREDENTIALS_FILE = 'server/credentials.json'
TOKEN_FILE = 'server/token.json'


def get_drive_service():
    """Return an authenticated Google Drive service without triggering full OAuth."""
    creds = None

    # Load saved credentials if available
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    # Refresh if expired
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())

    # If still no valid creds, user must go to /authorize
    if not creds or not creds.valid:
        raise Exception("No valid credentials. Please visit /authorize to log in.")

    return build('drive', 'v3', credentials=creds)

@app.route("/", defaults={"path": ""})
@app.route("/<path:path>")
def serve_react(path):
    if path != "" and os.path.exists(f"../client/dist/{path}"):
        return send_from_directory("../client/dist", path)
    else:
        return send_from_directory("../client/dist", "index.html")

@app.route('/authorize')
def authorize():
    """Manually trigger OAuth flow and save credentials."""
    flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
    creds = flow.run_local_server(port=0)

    # Save credentials for next time
    with open(TOKEN_FILE, 'w') as token:
        token.write(creds.to_json())

    return redirect("/")  # Change to your frontend URL if needed


@app.route('/list-pdfs/<folder_id>')
def list_pdfs(folder_id):
    """List all PDFs in a Google Drive folder."""
    try:
        service = get_drive_service()
        query = f"'{folder_id}' in parents and mimeType='application/pdf'"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        files = results.get('files', [])
        return jsonify(pdfs=files)
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/view-pdf/<file_id>')
def view_pdf(file_id):
    """Serve a PDF for in-browser viewing."""
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())
        return send_file(file_content, mimetype='application/pdf')
    except Exception as e:
        return jsonify(error=str(e)), 500


@app.route('/download-pdf/<file_id>')
def download_pdf(file_id):
    """Download a PDF by its ID."""
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
    """Return the first page of a PDF as an image for the cover."""
    try:
        service = get_drive_service()
        request = service.files().get_media(fileId=file_id)
        file_content = io.BytesIO(request.execute())

        # Load PDF and first page
        doc = fitz.open(stream=file_content, filetype="pdf")
        page = doc.load_page(0)  # first page
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))  # scale up for quality

        img_bytes = io.BytesIO(pix.tobytes("png"))
        return send_file(img_bytes, mimetype="image/png")
    except Exception as e:
        return jsonify(error=str(e)), 500


if __name__ == '__main__':
    app.run(debug=True)
