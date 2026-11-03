-- WappHub Core Next: new schema, not compatible with or imported from legacy Core.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organizations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 display_name text NOT NULL,
 email text NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','supervisor','agent','member')),
 status text NOT NULL CHECK(status IN ('active','invited','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE channels (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 type text NOT NULL CHECK(type IN ('wapphub_internal','external')),
 name text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id)
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 channel_id uuid NOT NULL,
 type text NOT NULL CHECK(type IN ('direct','group','external')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','archived','closed')),
 last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence >= 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id),
 FOREIGN KEY(channel_id,organization_id) REFERENCES channels(id,organization_id)
);
CREATE TABLE conversation_participants (
 organization_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 user_id uuid NOT NULL,
 joined_at timestamptz NOT NULL DEFAULT now(),
 left_at timestamptz,
 PRIMARY KEY(conversation_id,user_id),
 FOREIGN KEY(conversation_id,organization_id) REFERENCES conversations(id,organization_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL,
 conversation_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence>0),
 sender_user_id uuid NOT NULL,
 client_message_id text NOT NULL CHECK(length(client_message_id) BETWEEN 8 AND 128),
 type text NOT NULL CHECK(type IN ('text')),
 body text NOT NULL CHECK(char_length(body) BETWEEN 1 AND 4096),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now(),
 edited_at timestamptz,
 deleted_at timestamptz,
 UNIQUE(conversation_id,sequence),
 UNIQUE(organization_id,sender_user_id,client_message_id),
 UNIQUE(id,organization_id),
 FOREIGN KEY(conversation_id,organization_id) REFERENCES conversations(id,organization_id),
 FOREIGN KEY(organization_id,sender_user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE message_revisions (
 organization_id uuid NOT NULL,
 message_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>=1),
 body text NOT NULL,
 changed_by_user_id uuid NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,revision),
 FOREIGN KEY(message_id,organization_id) REFERENCES messages(id,organization_id),
 FOREIGN KEY(organization_id,changed_by_user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE message_receipts (
 organization_id uuid NOT NULL,
 message_id uuid NOT NULL,
 recipient_user_id uuid NOT NULL,
 delivered_at timestamptz,
 read_at timestamptz,
 PRIMARY KEY(message_id,recipient_user_id),
 FOREIGN KEY(message_id,organization_id) REFERENCES messages(id,organization_id),
 FOREIGN KEY(organization_id,recipient_user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE TABLE outbox_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organizations(id),
 event_type text NOT NULL,
 aggregate_id uuid NOT NULL,
 payload jsonb NOT NULL,
 occurred_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz,
 retry_count integer NOT NULL DEFAULT 0,
 sync_position bigint GENERATED ALWAYS AS IDENTITY UNIQUE
);
CREATE TABLE client_operations (
 organization_id uuid NOT NULL REFERENCES organizations(id),
 user_id uuid NOT NULL,
 operation_id text NOT NULL,
 request_hash text NOT NULL,
 response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id,operation_id),
 FOREIGN KEY(organization_id,user_id) REFERENCES memberships(organization_id,user_id)
);
CREATE INDEX idx_messages_page ON messages(conversation_id,sequence DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_conversations_org ON conversations(organization_id,updated_at DESC);
CREATE INDEX idx_outbox_pending ON outbox_events(occurred_at,id) WHERE published_at IS NULL;
CREATE INDEX idx_outbox_sync ON outbox_events(organization_id,sync_position);
CREATE INDEX idx_receipts_recipient ON message_receipts(recipient_user_id,read_at);
COMMIT;
