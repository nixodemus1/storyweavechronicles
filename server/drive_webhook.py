from googleapiclient.discovery import build
from google.oauth2 import service_account
from dotenv import load_dotenv;
import os
import argparse
import uuid

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


def setup_drive_webhook(folder_id, webhook_url, channel_id=None):
    creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
    service = build('drive', 'v3', credentials=creds)
    # Prefer Pub/Sub integration when available, but fall back to webhook delivery
    # using Drive's web_hook channel type. The webhook will include an
    # X-Goog-Channel-Token header containing the provided token so the server
    # can verify the request came from a previously-registered watch.
    pubsub_topic = f'projects/{os.getenv("GOOGLE_PROJECT_ID")}/topics/{os.getenv("PUBSUB_TOPIC_NAME")}'
    channel_id = channel_id or os.getenv('DRIVE_CHANNEL_ID', 'storyweave-drive-channel')
    drive_watch_token = os.getenv('DRIVE_WEBHOOK_TOKEN')
    # Default to pubsub registration body; some Drive installations do not
    # accept 'pubsub' as a channel type -- in that case we'll try web_hook.
    body_pubsub = {
        'id': channel_id,
        'type': 'pubsub',
        'address': pubsub_topic,
    }
    body_webhook = {
        'id': channel_id,
        'type': 'web_hook',
        'address': webhook_url,
    }
    # Include token in webhook body if available so Drive will send X-Goog-Channel-Token
    if drive_watch_token:
        body_webhook['token'] = drive_watch_token

    # First try Pub/Sub-style watch (preferred). If that fails with a 400
    # reporting unknown channel type, fall back to a web_hook watch.
    try:
        response = service.files().watch(fileId=folder_id, body=body_pubsub).execute()
        print("Drive Pub/Sub webhook registered:", response)
        return response
    except Exception as e:
        # If Drive doesn't support 'pubsub' channel type in this project, try web_hook
        print(f"Pub/Sub watch failed, falling back to web_hook: {e}")
        try:
            response = service.files().watch(fileId=folder_id, body=body_webhook).execute()
            print("Drive webhook (web_hook) registered:", response)
            return response
        except Exception as e2:
            print(f"Failed to register Drive webhook (web_hook): {e2}")
            raise

def stop_drive_channel(channel_id, resource_id):
    """Stop an existing Drive push channel by `id` and `resourceId`.

    Drive requires both the channel `id` (the one passed when creating the
    channel) and the `resourceId` returned by Drive to stop it.
    """
    creds = service_account.Credentials.from_service_account_info(service_account_info, scopes=SCOPES)
    service_local = build('drive', 'v3', credentials=creds)
    body = {'id': channel_id, 'resourceId': resource_id}
    try:
        service_local.channels().stop(body=body).execute()
        print(f"Stopped channel id={channel_id} resourceId={resource_id}")
    except Exception as e:
        print(f"Failed to stop channel id={channel_id} resourceId={resource_id}: {e}")
        raise

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Register or stop a Drive push watch')
    parser.add_argument('--stop', action='store_true', help='Stop an existing channel (requires --resource-id)')
    parser.add_argument('--channel-id', help='Channel id to use (defaults to DRIVE_CHANNEL_ID or storyweave-drive-channel)')
    parser.add_argument('--resource-id', help='ResourceId returned by Drive when the channel was created (required for --stop)')
    parser.add_argument('--webhook-url', help='Webhook URL or PUBSUB_AUDIENCE for registration (defaults to PUBSUB_AUDIENCE env var)')
    args = parser.parse_args()

    channel_id = args.channel_id or os.getenv('DRIVE_CHANNEL_ID', 'storyweave-drive-channel')
    webhook_url = args.webhook_url or os.getenv('PUBSUB_AUDIENCE')

    if args.stop:
        if not args.resource_id:
            print('Stopping a channel requires --resource-id (or set DRIVE_CHANNEL_RESOURCE_ID env var)')
            raise SystemExit(1)
        stop_drive_channel(channel_id, args.resource_id)
    else:
        # If the default channel id is used and previously created, create a unique id
        # to avoid channelIdNotUnique errors unless the user explicitly set one.
        if channel_id == 'storyweave-drive-channel':
            channel_id = f"storyweave-drive-channel-{uuid.uuid4().hex[:8]}"
        setup_drive_webhook(os.getenv('GOOGLE_DRIVE_FOLDER_ID'), webhook_url, channel_id=channel_id)