from flask import Flask, jsonify, send_file, redirect, send_from_directory
from flask_cors import CORS
import fitz  # PyMuPDF
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from google.auth.transport.requests import Request
import io
import os
import base64

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

    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())

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


if __name__ == '__main__':
    app.run(debug=True)
