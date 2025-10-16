from googleapiclient.discovery import build
from google.oauth2 import service_account
from dotenv import load_dotenv;
import os

load_dotenv()

SCOPES = ['https://www.googleapis.com/auth/drive']
service_account_info = {
    "type": "service_account",
    "project_id": os.getenv("GOOGLE_PROJECT_ID", "story-weave-chronicles"),
    "private_key_id": os.getenv("GOOGLE_PRIVATE_KEY_ID"),
    "private_key": os.getenv("GOOGLE_PRIVATE_KEY").replace('\\n', '\n').replace('"', '').replace('\n', '\n'),
    "client_email": os.getenv("GOOGLE_CLIENT_EMAIL"),
    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
    "auth_uri": os.getenv("GOOGLE_AUTH_URI"),
    "token_uri": os.getenv("GOOGLE_TOKEN_URI"),
    "auth_provider_x509_cert_url": os.getenv("GOOGLE_AUTH_CERT_URI"),
    "client_x509_cert_url": os.getenv("GOOGLE_CLIENT_X509_CERT_URL"),
}


def setup_drive_webhook(folder_id, webhook_url):
    creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
    service = build('drive', 'v3', credentials=creds)
    pubsub_topic = f'projects/{os.getenv("GOOGLE_PROJECT_ID")}/topics/{os.getenv("PUBSUB_TOPIC_NAME")}'
    body = {
        'id': 'storyweave-drive-channel',  # Unique channel ID
        'type': 'pubsub',
        'address': pubsub_topic,  # Pub/Sub topic resource name, e.g. 'projects/your-project/topics/your-topic'
    }
    response = service.files().watch(fileId=folder_id, body=body).execute()
    print("Drive Pub/Sub webhook registered:", response)

if __name__ == '__main__':
    setup_drive_webhook(os.getenv('GOOGLE_DRIVE_FOLDER_ID'), os.getenv('PUBSUB_AUDIENCE'))