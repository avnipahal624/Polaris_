-- ============================================================================
-- POLARIS · 0003 · Offline sync, conflicts, notifications, AI, audit
--
-- The sync queue is the heart of the offline story. `sync_events.event_id` is
-- the client-generated idempotency key, so a field device that re-uploads after
-- a dropped connection cannot double-apply anything.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS citext;

-- ----------------------------------------------------------------------------
-- Offline sync
-- ----------------------------------------------------------------------------
CREATE TABLE sync_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Client-generated. The unique index below is the idempotency guarantee.
  event_id        TEXT NOT NULL UNIQUE,
  device_id       UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  -- P0 SOS … P5 analytics. Enforced by CHECK so no caller can smuggle a P5
  -- payload through a P0 slot.
  priority        SMALLINT NOT NULL CHECK (priority BETWEEN 0 AND 5),
  recorded_at     TIMESTAMPTZ NOT NULL,
  received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload         JSONB NOT NULL,
  status          TEXT NOT NULL DEFAULT 'QUEUED'
                  CHECK (status IN ('APPLIED','CONFLICT','REJECTED','QUEUED')),
  reason          TEXT,
  applied_table   TEXT,
  applied_id      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_device_idx ON sync_events (device_id, recorded_at DESC);
CREATE INDEX sync_status_idx ON sync_events (status);
-- The upload query always wants highest priority first, then device clock.
CREATE INDEX sync_priority_idx ON sync_events (priority ASC, recorded_at ASC);
CREATE INDEX sync_payload_gin ON sync_events USING GIN (payload);

-- Optimistic concurrency. A field device that edited from version N while the
-- central record reached N+1 is a conflict, never a silent overwrite.
CREATE TABLE sync_conflicts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conflict_code TEXT NOT NULL UNIQUE,
  event_id      TEXT NOT NULL,
  entity        TEXT NOT NULL,
  entity_id     TEXT NOT NULL,
  field_name    TEXT NOT NULL,
  central_value TEXT NOT NULL,
  field_value   TEXT NOT NULL,
  device_id     UUID REFERENCES devices(id) ON DELETE SET NULL,
  field_author  TEXT NOT NULL,
  field_ts      TIMESTAMPTZ NOT NULL,
  central_ts    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','KEEP_CENTRAL','KEEP_FIELD','MERGED')),
  resolved_by   TEXT,
  resolved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sync_conflict_status_idx ON sync_conflicts (status);
CREATE INDEX sync_conflict_entity_idx ON sync_conflicts (entity, entity_id);
CREATE TRIGGER sync_conflict_touch BEFORE UPDATE ON sync_conflicts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- Notifications
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  notification_code TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL,
  severity       TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  title          TEXT NOT NULL,
  detail         TEXT NOT NULL,
  -- Which roles may see it. Enforced on read, not just in the UI.
  audience       TEXT[] NOT NULL,
  channels       TEXT[] NOT NULL DEFAULT '{IN_APP}',
  link_table     TEXT,
  link_id        UUID,
  link_lat       DOUBLE PRECISION,
  link_lon       DOUBLE PRECISION,
  read           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Suppresses duplicate alarms from the same source inside a window.
  dedupe_key     TEXT
);
CREATE INDEX notifications_recent_idx ON notifications (created_at DESC);
CREATE INDEX notifications_severity_idx ON notifications (severity, created_at DESC);
CREATE INDEX notifications_audience_gin ON notifications USING GIN (audience);
CREATE UNIQUE INDEX notifications_dedupe_idx ON notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL AND read = FALSE;
CREATE TRIGGER notifications_touch BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- POLAR INTELLIGENCE
--
-- The engine recommends; it never mutates operational state. status and
-- approved_by are what turn a recommendation into an authorised action.
-- ----------------------------------------------------------------------------
CREATE TABLE ai_recommendations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recommendation_code TEXT NOT NULL UNIQUE,
  module          TEXT NOT NULL CHECK (module IN
                    ('PREDICTION','ANOMALY','RISK','OPTIMIZATION','RECOMMENDATION')),
  title           TEXT NOT NULL,
  recommendation  TEXT NOT NULL,
  -- Why the engine said it, and what it read to reach that conclusion.
  reason          TEXT NOT NULL,
  data_used       JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Evidence strength, never a fabricated probability.
  confidence      TEXT NOT NULL CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  impact          TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','APPROVED','REJECTED','MODIFIED','EXPIRED')),
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  approval_note   TEXT,
  related_entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_status_idx ON ai_recommendations (status, created_at DESC);
CREATE INDEX ai_module_idx ON ai_recommendations (module);
CREATE TRIGGER ai_reco_touch BEFORE UPDATE ON ai_recommendations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- Realtime outbox
--
-- The API writes here inside the same transaction as the business change, and
-- a relay publishes to the WebSocket gateway. The database is therefore never
-- out of step with what subscribers have been told.
-- ----------------------------------------------------------------------------
CREATE TABLE realtime_outbox (
  id         BIGSERIAL PRIMARY KEY,
  event_code TEXT NOT NULL UNIQUE,
  type       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  audience   TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_at TIMESTAMPTZ
);
-- The relay polls precisely this index and nothing else.
CREATE INDEX realtime_unpublished_idx ON realtime_outbox (id)
  WHERE published_at IS NULL;

-- ----------------------------------------------------------------------------
-- Audit — append only, never updated
-- ----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor         TEXT NOT NULL,
  actor_role    TEXT NOT NULL,
  action        TEXT NOT NULL,
  target        TEXT NOT NULL,
  ai_recommendation_code TEXT,
  reason        TEXT,
  before_value  TEXT,
  after_value   TEXT,
  result        TEXT NOT NULL,
  metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_time_idx ON audit_logs (created_at DESC);
CREATE INDEX audit_target_idx ON audit_logs (target, created_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor, created_at DESC);
CREATE INDEX audit_ai_idx ON audit_logs (ai_recommendation_code)
  WHERE ai_recommendation_code IS NOT NULL;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ----------------------------------------------------------------------------
-- Connectivity ladder
-- ----------------------------------------------------------------------------
CREATE TABLE connectivity_events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_code TEXT NOT NULL UNIQUE,
  mode       TEXT NOT NULL CHECK (mode IN ('NORMAL','WEAK','VERY_LOW','OFFLINE')),
  note       TEXT,
  actor      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX connectivity_time_idx ON connectivity_events (created_at DESC);

-- ----------------------------------------------------------------------------
-- Family media renditions
--
-- Only keys and sizes live in the database. The bytes are in S3 and are only
-- reachable through a short-lived signed URL.
-- ----------------------------------------------------------------------------
CREATE TABLE family_media_renditions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id    UUID NOT NULL REFERENCES family_messages(id) ON DELETE CASCADE,
  quality       TEXT NOT NULL CHECK (quality IN ('LOW','MEDIUM','HIGH')),
  storage_key   TEXT NOT NULL UNIQUE,
  content_type  TEXT NOT NULL,
  size_bytes    BIGINT NOT NULL,
  duration_ms   INTEGER,
  -- A LOW rendition may be audio-only: the picture is deferred, not lost.
  has_video     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX family_rendition_msg_idx ON family_media_renditions (message_id);

-- ----------------------------------------------------------------------------
-- Device connectivity ladder
-- ----------------------------------------------------------------------------
CREATE TABLE device_connectivity (
  device_id   UUID PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('NORMAL','WEAK','VERY_LOW','OFFLINE')),
  since       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Seeded roles and permissions
-- ----------------------------------------------------------------------------
INSERT INTO roles (code, description) VALUES
  ('ADMIN',            'Full system authority including role assignment and audit export'),
  ('CONTROL_ROOM',     'Missions, cargo, inventory, personnel, GPS, hazards, transport, emergency, AI'),
  ('STATION_COMMANDER','Station inventory, personnel and local missions'),
  ('FIELD_OPERATOR',   'Own location, assigned tasks, cargo scanning, hazards, SOS, offline data'),
  ('MEDICAL_AUTHORITY','Authorised medical records, medical incidents, consultations'),
  ('FAMILY_MEMBER',    'Only their linked expedition member and approved Home Link content');

INSERT INTO permissions (resource, action) VALUES
  ('missions','read'),('missions','write'),
  ('cargo','read'),('cargo','write'),
  ('inventory','read'),('inventory','write'),
  ('personnel','read'),('personnel','write'),
  ('locations','read'),('locations','write'),
  ('hazards','read'),('hazards','write'),
  ('transport','read'),('transport','write'),
  ('emergency','read'),('emergency','write'),
  ('medical','read'),('medical','write'),
  ('ai','read'),('ai','approve'),
  ('family','read'),('family','write'),
  ('wellbeing','read'),('wellbeing','write'),
  ('reports','read'),
  ('audit','read'),
  ('admin','admin');

-- Explicit allow-matrix. Anything absent is denied, so a new role can never
-- silently inherit operational data.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'ADMIN';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON (p.resource, p.action) IN (
  ('missions','read'),('cargo','read'),('cargo','write'),('inventory','read'),('inventory','write'),
  ('personnel','read'),('locations','read'),('locations','write'),('hazards','read'),('hazards','write'),
  ('transport','read'),('transport','write'),('emergency','read'),('emergency','write'),
  ('ai','read'),('ai','approve'),('reports','read'),('wellbeing','read')
)
WHERE r.code = 'CONTROL_ROOM';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON (p.resource, p.action) IN (
  ('missions','read'),('cargo','read'),('inventory','read'),('inventory','write'),
  ('personnel','read'),('locations','read'),('locations','write'),('hazards','read'),
  ('hazards','write'),('emergency','read'),('emergency','write'),('ai','read'),
  ('family','read'),('family','write'),('wellbeing','read'),('wellbeing','write')
)
WHERE r.code = 'STATION_COMMANDER';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON (p.resource, p.action) IN (
  ('missions','read'),('cargo','read'),('cargo','write'),('inventory','read'),('inventory','write'),
  ('locations','read'),('locations','write'),('hazards','read'),('hazards','write'),
  ('transport','read'),('emergency','read'),('emergency','write'),
  ('family','read'),('family','write'),('wellbeing','read'),('wellbeing','write')
)
WHERE r.code = 'FIELD_OPERATOR';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON (p.resource, p.action) IN (
  ('personnel','read'),('medical','read'),('medical','write'),
  ('emergency','read'),('emergency','write'),('wellbeing','read'),('ai','read')
)
WHERE r.code = 'MEDICAL_AUTHORITY';

-- FAMILY_MEMBER: family link only. No map, no cargo, no other personnel,
-- no hazards, no medical, no reports.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r
JOIN permissions p ON (p.resource, p.action) IN (('family','read'),('wellbeing','write'))
WHERE r.code = 'FAMILY_MEMBER';

COMMIT;
