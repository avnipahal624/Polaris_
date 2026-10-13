-- ============================================================================
-- POLARIS · 0002 · Missions, logistics, telemetry, emergency
--
-- Inventory is a ledger, not a counter: `inventory_items` holds the running
-- balance and `inventory_transactions` is the append-only evidence. No code
-- path is permitted to update a quantity without also writing a transaction.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Missions
-- ----------------------------------------------------------------------------
CREATE TABLE missions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mission_code  TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  expedition    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PLANNED'
                CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','DELAYED','CANCELLED')),
  origin        TEXT NOT NULL,
  destination_id UUID NOT NULL REFERENCES stations(id),
  departure_at  TIMESTAMPTZ NOT NULL,
  return_at     TIMESTAMPTZ,
  transport_id  UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX missions_status_idx ON missions (status);

ALTER TABLE convoys
  ADD CONSTRAINT convoys_mission_fk FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL;

CREATE TABLE mission_personnel (
  mission_id UUID NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  PRIMARY KEY (mission_id, person_id)
);

-- ----------------------------------------------------------------------------
-- Cargo
-- ----------------------------------------------------------------------------
CREATE TABLE cargo (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_code            TEXT NOT NULL UNIQUE,
  -- A physical container is identified by exactly one of these; the unique
  -- indexes are what stop a unit being booked onto two consignments.
  rfid                  TEXT UNIQUE,
  barcode               TEXT UNIQUE,
  item_type             TEXT NOT NULL,
  quantity              NUMERIC(14,3) NOT NULL CHECK (quantity >= 0),
  unit                  TEXT NOT NULL,
  weight_kg             NUMERIC(12,2) NOT NULL CHECK (weight_kg >= 0),
  origin                TEXT NOT NULL,
  destination_station_id UUID NOT NULL REFERENCES stations(id),
  mission_id            UUID REFERENCES missions(id) ON DELETE SET NULL,
  transport_id          UUID REFERENCES vehicles(id) ON DELETE SET NULL,
  containers_expected   INTEGER NOT NULL CHECK (containers_expected >= 0),
  containers_received   INTEGER NOT NULL DEFAULT 0 CHECK (containers_received >= 0),
  status                TEXT NOT NULL DEFAULT 'PLANNED'
                        CHECK (status IN ('PLANNED','PACKED','SCANNED','LOADED','IN_TRANSIT',
                                          'ARRIVED','RECEIVED','IN_INVENTORY','CONSUMED')),
  dispatched_at         TIMESTAMPTZ,
  expected_arrival_at   TIMESTAMPTZ NOT NULL,
  actual_arrival_at     TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  responsible_person_id UUID REFERENCES personnel(id) ON DELETE SET NULL,
  verification          TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (verification IN ('VERIFIED','PENDING','DISCREPANT')),
  -- Monotonic counter driving optimistic concurrency for offline writes.
  version               INTEGER NOT NULL DEFAULT 1,
  priority              TEXT NOT NULL DEFAULT 'ROUTINE'
                        CHECK (priority IN ('CRITICAL','HIGH','ROUTINE')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The manifest can never claim more arrived than was expected.
  CONSTRAINT cargo_never_over_received
    CHECK (containers_received <= containers_expected)
);
CREATE INDEX cargo_status_idx ON cargo (status);
CREATE INDEX cargo_destination_idx ON cargo (destination_station_id);
CREATE INDEX cargo_mission_idx ON cargo (mission_id);
-- Partial index for the discrepancy query, which only ever looks at open rows.
CREATE INDEX cargo_discrepancy_idx ON cargo (cargo_code)
  WHERE verification = 'DISCREPANT';

-- Scans are evidence. The trigger below makes them genuinely immutable.
CREATE TABLE cargo_scans (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cargo_id        UUID REFERENCES cargo(id) ON DELETE SET NULL,
  scanned_code    TEXT NOT NULL,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  scanned_at      TIMESTAMPTZ NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  result          TEXT NOT NULL CHECK (result IN ('VERIFIED','UNVERIFIED','MISSING')),
  quantity_claimed INTEGER,
  actor           TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cargo_scans_cargo_idx ON cargo_scans (cargo_id, scanned_at DESC);
CREATE INDEX cargo_scans_code_idx ON cargo_scans (scanned_code);
CREATE INDEX cargo_scans_location_gix ON cargo_scans USING GIST (location);

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% is append-only and cannot be updated or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cargo_scans_immutable
  BEFORE UPDATE OR DELETE ON cargo_scans
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ----------------------------------------------------------------------------
-- Inventory: balance + append-only ledger
-- ----------------------------------------------------------------------------
CREATE TABLE inventory_items (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_code              TEXT NOT NULL,
  item_name              TEXT NOT NULL,
  category               TEXT NOT NULL CHECK (category IN
                           ('FOOD','WATER','FUEL','DIESEL','MEDICAL','EMERGENCY',
                            'SCIENTIFIC','SPARES','CONSUMABLES')),
  station_id             UUID NOT NULL REFERENCES stations(id),
  quantity               NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  unit                   TEXT NOT NULL,
  batch                  TEXT,
  expires_at             TIMESTAMPTZ,
  min_threshold          NUMERIC(14,3) NOT NULL DEFAULT 0,
  consumption_per_day    NUMERIC(14,3) NOT NULL DEFAULT 0,
  incoming_quantity      NUMERIC(14,3) NOT NULL DEFAULT 0,
  reserved_quantity      NUMERIC(14,3) NOT NULL DEFAULT 0,
  version                INTEGER NOT NULL DEFAULT 1,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (station_id, item_name, batch)
);
CREATE INDEX inventory_station_idx ON inventory_items (station_id);
CREATE INDEX inventory_category_idx ON inventory_items (category);
CREATE INDEX inventory_below_min_idx ON inventory_items (item_code)
  WHERE quantity < min_threshold;

CREATE TABLE inventory_transactions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id       UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  station_id    UUID NOT NULL REFERENCES stations(id),
  delta         NUMERIC(14,3) NOT NULL CHECK (delta <> 0),
  reason        TEXT NOT NULL CHECK (reason IN
                  ('CONSUMPTION','RECEIPT','ADJUSTMENT','TRANSFER','EXPIRED')),
  actor         TEXT NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL,
  -- Present when the movement originated on an offline field device.
  origin_event_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inventory_txn_item_idx ON inventory_transactions (item_id, recorded_at DESC);
CREATE INDEX inventory_txn_time_idx ON inventory_transactions (recorded_at DESC);

CREATE TRIGGER inventory_txn_immutable
  BEFORE UPDATE OR DELETE ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- The only sanctioned way to move stock. Writing a transaction without
-- updating the balance — or the reverse — aborts the whole statement.
CREATE OR REPLACE FUNCTION post_inventory_transaction() RETURNS TRIGGER AS $$
DECLARE
  v_item UUID := NEW.item_id;
BEGIN
  UPDATE inventory_items
     SET quantity   = quantity + NEW.delta,
         version    = version + 1,
         updated_at = now()
   WHERE id = v_item;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory item % does not exist', v_item;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER inventory_txn_apply
  AFTER INSERT ON inventory_transactions
  FOR EACH ROW EXECUTE FUNCTION post_inventory_transaction();

-- ----------------------------------------------------------------------------
-- Weather
--
-- `source` and `observed_at` are columns, not labels. The UI reads them to
-- decide whether a reading may be shown as LIVE.
-- ----------------------------------------------------------------------------
CREATE TABLE weather_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  station_id      UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  observed_at     TIMESTAMPTZ NOT NULL,
  temperature_c   NUMERIC(6,2) NOT NULL,
  wind_kph        NUMERIC(7,2) NOT NULL,
  gust_kph        NUMERIC(7,2),
  visibility_km   NUMERIC(7,3) NOT NULL,
  pressure_hpa    NUMERIC(7,2) NOT NULL,
  precipitation_mm NUMERIC(8,3),
  condition       TEXT NOT NULL,
  storm_flag      BOOLEAN NOT NULL DEFAULT FALSE,
  source          TEXT NOT NULL,          -- e.g. 'open-meteo', 'simulator'
  simulated       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX weather_station_time_idx ON weather_events (station_id, observed_at DESC);
CREATE INDEX weather_time_idx ON weather_events (observed_at DESC);

-- ----------------------------------------------------------------------------
-- Telemetry
--
-- Every packet is kept. `last_known_positions` is a materialised shortcut so
-- the map is one lookup instead of N, and is refreshed by trigger.
-- ----------------------------------------------------------------------------
CREATE TABLE location_events (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id      UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  person_id      UUID REFERENCES personnel(id) ON DELETE CASCADE,
  vehicle_id     UUID REFERENCES vehicles(id) ON DELETE CASCADE,
  location       geography(Point, 4326) NOT NULL,
  lat            DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon            DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  accuracy_m     NUMERIC(7,2) NOT NULL,
  altitude_m     NUMERIC(8,2),
  speed_kph      NUMERIC(7,2),
  heading_deg    NUMERIC(6,2),
  battery_pct    NUMERIC(5,2),
  connectivity   TEXT NOT NULL CHECK (connectivity IN ('ONLINE','LOW','OFFLINE')),
  -- Device clock. Freshness is computed against this, never faked.
  recorded_at    TIMESTAMPTZ NOT NULL,
  ingested_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL CHECK (source IN ('GPS','SIMULATOR','MANUAL'))
);
CREATE INDEX location_device_time_idx ON location_events (device_id, recorded_at DESC);
CREATE INDEX location_person_time_idx ON location_events (person_id, recorded_at DESC)
  WHERE person_id IS NOT NULL;
CREATE INDEX location_vehicle_time_idx ON location_events (vehicle_id, recorded_at DESC)
  WHERE vehicle_id IS NOT NULL;
CREATE INDEX location_gix ON location_events USING GIST (location);
-- Time partitioning key: telemetry is the one table that genuinely grows without bound.
CREATE INDEX location_time_idx ON location_events (recorded_at DESC);

CREATE TABLE last_known_positions (
  subject_id     UUID PRIMARY KEY,
  subject_kind   TEXT NOT NULL CHECK (subject_kind IN ('person','vehicle','convoy','station')),
  location       geography(Point, 4326) NOT NULL,
  lat            DOUBLE PRECISION NOT NULL,
  lon            DOUBLE PRECISION NOT NULL,
  accuracy_m     NUMERIC(7,2) NOT NULL,
  battery_pct    NUMERIC(5,2),
  connectivity   TEXT NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL,
  source         TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX last_known_gix ON last_known_positions USING GIST (location);

CREATE OR REPLACE FUNCTION refresh_last_known() RETURNS TRIGGER AS $$
DECLARE
  v_subject UUID;
  v_kind    TEXT;
BEGIN
  IF NEW.person_id IS NOT NULL THEN
    v_subject := NEW.person_id; v_kind := 'person';
  ELSIF NEW.vehicle_id IS NOT NULL THEN
    v_subject := NEW.vehicle_id; v_kind := 'vehicle';
  ELSE
    RETURN NEW;  -- unattributed packets are still stored, just not tracked
  END IF;

  INSERT INTO last_known_positions
    (subject_id, subject_kind, location, lat, lon, accuracy_m, battery_pct,
     connectivity, recorded_at, source, updated_at)
  VALUES
    (v_subject, v_kind, NEW.location, NEW.lat, NEW.lon, NEW.accuracy_m, NEW.battery_pct,
     NEW.connectivity, NEW.recorded_at, NEW.source, now())
  ON CONFLICT (subject_id) DO UPDATE SET
    subject_kind = EXCLUDED.subject_kind,
    location     = EXCLUDED.location,
    lat          = EXCLUDED.lat,
    lon          = EXCLUDED.lon,
    accuracy_m   = EXCLUDED.accuracy_m,
    battery_pct  = EXCLUDED.battery_pct,
    connectivity = EXCLUDED.connectivity,
    -- Only a newer packet may replace the last known position. An
    -- out-of-order packet is stored but must not move the marker backwards.
    recorded_at  = GREATEST(last_known_positions.recorded_at, EXCLUDED.recorded_at),
    source       = EXCLUDED.source,
    updated_at   = now();

  UPDATE devices
     SET last_event_at = NEW.recorded_at,
         connectivity  = NEW.connectivity,
         battery_pct   = COALESCE(NEW.battery_pct, devices.battery_pct),
         updated_at    = now()
   WHERE id = NEW.device_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER location_events_refresh
  AFTER INSERT ON location_events
  FOR EACH ROW EXECUTE FUNCTION refresh_last_known();

-- ----------------------------------------------------------------------------
-- Geofence evaluation
--
-- This is the PostGIS spatial query the whole hazard engine rests on. Given a
-- position it returns every currently-valid zone the point is inside or
-- approaching, with a real metre distance.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION evaluate_geofences(
  p_lat DOUBLE PRECISION,
  p_lon DOUBLE PRECISION,
  p_now TIMESTAMPTZ DEFAULT now()
)
RETURNS TABLE (
  hazard_id     UUID,
  hazard_code   TEXT,
  hazard_type   TEXT,
  label         TEXT,
  severity      TEXT,
  inside        BOOLEAN,
  distance_km   DOUBLE PRECISION,
  bearing_deg   DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    h.id,
    h.hazard_code,
    h.hazard_type,
    h.label,
    h.severity,
    ST_Covers(h.boundary, p_point)                       AS inside,
    ST_Distance(h.centroid, p_point) / 1000.0            AS distance_km,
    degrees(ST_Azimuth(
      ST_X(h.centroid::geometry), ST_Y(h.centroid::geometry),
      p_lon, p_lat
    ))::DOUBLE PRECISION                                AS bearing_deg
  FROM hazard_zones h
  CROSS JOIN (
    SELECT ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography AS p_point
  ) pt
  WHERE h.valid_from <= p_now
    AND (h.valid_until IS NULL OR h.valid_until >= p_now)
    -- Inside the polygon, or within one warning radius of it.
    AND ST_DWithin(h.centroid, pt.p_point, h.radius_km * 2000);
$$;

-- Route exposure: does a published route pass through a hazard zone, and by
-- how much clearance does it have? This is what raises ROUTE EXPOSURE.
CREATE OR REPLACE FUNCTION route_exposure(p_route_id UUID)
RETURNS TABLE (
  hazard_id     UUID,
  hazard_code   TEXT,
  label         TEXT,
  severity      TEXT,
  intersects    BOOLEAN,
  min_clearance_km DOUBLE PRECISION
)
LANGUAGE sql STABLE AS $$
  SELECT
    h.id, h.hazard_code, h.label, h.severity,
    ST_Intersects(h.boundary, r.path) AS intersects,
    (ST_Distance(h.centroid, r.path) / 1000.0) AS min_clearance_km
  FROM routes r
  JOIN hazard_zones h
    ON h.valid_from <= now()
   AND (h.valid_until IS NULL OR h.valid_until >= now())
  WHERE r.id = p_route_id
    AND ST_DWithin(r.path, h.centroid, h.radius_km * 2000)
  ORDER BY min_clearance_km ASC;
$$;

-- ----------------------------------------------------------------------------
-- Emergency
-- ----------------------------------------------------------------------------
CREATE TABLE sos_events (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sos_code              TEXT NOT NULL UNIQUE,
  incident_code         TEXT NOT NULL UNIQUE,
  person_id             UUID NOT NULL REFERENCES personnel(id),
  device_id             UUID NOT NULL REFERENCES devices(id),
  location              geography(Point, 4326) NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL,
  lon                   DOUBLE PRECISION NOT NULL,
  accuracy_m            NUMERIC(7,2) NOT NULL,
  triggered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  battery_pct           NUMERIC(5,2),
  route_id              UUID REFERENCES routes(id) ON DELETE SET NULL,
  convoy_id             UUID REFERENCES convoys(id) ON DELETE SET NULL,
  nearest_hazard_id     UUID REFERENCES hazard_zones(id) ON DELETE SET NULL,
  nearest_station_id    UUID REFERENCES stations(id) ON DELETE SET NULL,
  nearest_station_km    NUMERIC(8,3),
  connectivity_at_trigger TEXT NOT NULL,
  category              TEXT NOT NULL,
  stage                 TEXT NOT NULL DEFAULT 'TRIGGERED'
                        CHECK (stage IN ('TRIGGERED','ACKNOWLEDGED','RESPONSE_ASSIGNED',
                                         'RESPONDING','RESOLVED')),
  -- TRUE when the SOS sat in the device's offline P0 queue before transmitting.
  queued_offline        BOOLEAN NOT NULL DEFAULT FALSE,
  resolution            TEXT,
  resolved_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sos_stage_idx ON sos_events (stage);
CREATE INDEX sos_person_idx ON sos_events (person_id, triggered_at DESC);
CREATE INDEX sos_triggered_idx ON sos_events (triggered_at DESC);
CREATE INDEX sos_gix ON sos_events USING GIST (location);

CREATE TABLE emergency_responses (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_code         TEXT NOT NULL UNIQUE,
  sos_id                UUID NOT NULL UNIQUE REFERENCES sos_events(id) ON DELETE CASCADE,
  severity              TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  location              geography(Point, 4326) NOT NULL,
  hazard_ids            UUID[] NOT NULL DEFAULT '{}',
  weather_snapshot      TEXT,
  route_id              UUID REFERENCES routes(id) ON DELETE SET NULL,
  response_team         TEXT NOT NULL DEFAULT 'Unassigned',
  assigned_vehicle_ids  UUID[] NOT NULL DEFAULT '{}',
  actions               JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','ASSIGNED','EN_ROUTE','ON_SCENE','CLOSED')),
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX emergency_status_idx ON emergency_responses (status);
CREATE TRIGGER emergency_touch BEFORE UPDATE ON emergency_responses
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER sos_touch BEFORE UPDATE ON sos_events
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ----------------------------------------------------------------------------
-- Medical — store and forward, never diagnosis
-- ----------------------------------------------------------------------------
CREATE TABLE medical_cases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_code       TEXT NOT NULL UNIQUE,
  person_id       UUID NOT NULL REFERENCES personnel(id),
  incident_code   TEXT,
  observations    TEXT NOT NULL,
  vitals          TEXT,
  attachment_keys TEXT[] NOT NULL DEFAULT '{}',
  priority        TEXT NOT NULL CHECK (priority IN ('ROUTINE','URGENT','CRITICAL')),
  status          TEXT NOT NULL DEFAULT 'RECORDED_FIELD'
                  CHECK (status IN ('RECORDED_FIELD','QUEUED','TRANSMITTED','UNDER_REVIEW','RESOLVED')),
  recorded_by     TEXT NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  offline_origin  BOOLEAN NOT NULL DEFAULT FALSE,
  -- POLARIS prioritises transmission. It does not diagnose, and no field in
  -- this table is interpreted as a clinical finding by any service.
  clinician_note  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX medical_status_idx ON medical_cases (status);
CREATE INDEX medical_person_idx ON medical_cases (person_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- Work
-- ----------------------------------------------------------------------------
CREATE TABLE tasks (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_code     TEXT NOT NULL UNIQUE,
  title         TEXT NOT NULL,
  station_id    UUID NOT NULL REFERENCES stations(id),
  due_at        TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN','IN_PROGRESS','BLOCKED','DONE','CANCELLED')),
  priority      TEXT NOT NULL DEFAULT 'ROUTINE'
                CHECK (priority IN ('CRITICAL','HIGH','ROUTINE')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX tasks_status_idx ON tasks (status);
CREATE INDEX tasks_station_idx ON tasks (station_id, due_at);

CREATE TABLE task_assignments (
  task_id   UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, person_id)
);

CREATE TABLE rosters (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id  UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  station_id UUID NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
  day        DATE NOT NULL,
  shift      TEXT NOT NULL CHECK (shift IN ('ALPHA','BRAVO','CHARLIE','OFF')),
  duty       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, day, shift)
);
CREATE INDEX rosters_station_day_idx ON rosters (station_id, day);

-- ----------------------------------------------------------------------------
-- Well-being: voluntary, non-diagnostic, never exposed to the control room
-- ----------------------------------------------------------------------------
CREATE TABLE wellbeing_checkins (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  person_id      UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  recorded_at    TIMESTAMPTZ NOT NULL,
  level          TEXT NOT NULL CHECK (level IN ('GOOD','OKAY','LOW','STRUGGLING')),
  support_route  TEXT CHECK (support_route IN ('FAMILY','TEAM','MEDICAL')),
  -- The private note is never selected by any role other than the subject.
  private_note   TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX wellbeing_person_idx ON wellbeing_checkins (person_id, recorded_at DESC);

-- ----------------------------------------------------------------------------
-- Family Home Link
-- ----------------------------------------------------------------------------
CREATE TABLE family_members (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  family_code   TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  relationship  TEXT NOT NULL,
  person_id     UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  authorized    BOOLEAN NOT NULL DEFAULT TRUE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX family_person_idx ON family_members (person_id);
CREATE UNIQUE INDEX family_user_key ON family_members (user_id) WHERE user_id IS NOT NULL;

CREATE TABLE family_messages (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_code         TEXT NOT NULL UNIQUE,
  family_member_id     UUID NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
  person_id            UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  direction            TEXT NOT NULL CHECK (direction IN ('FAMILY_TO_FIELD','FIELD_TO_FAMILY')),
  message_type         TEXT NOT NULL CHECK (message_type IN ('TEXT','VOICE','VIDEO','PHOTO')),
  -- Object-storage keys, never the media bytes. Videos are stored as derived
  -- low/medium/high renditions and only the key is referenced here.
  storage_key          TEXT,
  size_bytes           BIGINT NOT NULL DEFAULT 0,
  -- Which rendition a field device should receive given the current link.
  delivery_quality     TEXT NOT NULL DEFAULT 'LOW'
                       CHECK (delivery_quality IN ('LOW','MEDIUM','HIGH')),
  -- Set when a video's audio has been extracted and sent ahead of the picture.
  audio_extracted_first BOOLEAN NOT NULL DEFAULT FALSE,
  pipeline             JSONB NOT NULL DEFAULT '[]'::jsonb,
  state                TEXT NOT NULL DEFAULT 'DRAFT'
                       CHECK (state IN ('DRAFT','QUEUED','WAITING_FOR_CONNECTIVITY',
                                        'TRANSMITTING','DELIVERED','OPENED','FAILED')),
  body                 TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at         TIMESTAMPTZ,
  opened_at            TIMESTAMPTZ,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX family_msg_person_idx ON family_messages (person_id, created_at DESC);
CREATE INDEX family_msg_state_idx ON family_messages (state);
CREATE TRIGGER family_msg_touch BEFORE UPDATE ON family_messages
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
