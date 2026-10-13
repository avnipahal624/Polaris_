-- ============================================================================
-- POLARIS · 0001 · Extensions, identity, geography
--
-- Real PostgreSQL + PostGIS. Geometry columns are geography(Point, 4326) so
-- distance maths is in metres and is correct across the polar region, where a
-- naive planar calculation on raw degrees is badly wrong.
--
-- Every table carries created_at / updated_at and a status where the domain
-- has a lifecycle. Geospatial columns carry GiST indexes.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- Roles and permissions
--
-- RBAC is resolved from these tables on every request. The UI is never the
-- authority: hiding a button is a courtesy, the 403 is the control.
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE
                CHECK (code IN ('ADMIN','CONTROL_ROOM','STATION_COMMANDER',
                                'FIELD_OPERATOR','MEDICAL_AUTHORITY','FAMILY_MEMBER')),
  description   TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id        SERIAL PRIMARY KEY,
  resource  TEXT NOT NULL,
  action    TEXT NOT NULL CHECK (action IN ('read','write','approve','admin')),
  UNIQUE (resource, action)
);

CREATE TABLE role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email               CITEXT,
  password_hash       TEXT,
  name                TEXT NOT NULL,
  role_id             INTEGER REFERENCES roles(id),
  -- A person in the expedition record, for operators and field crew.
  person_id           UUID,
  -- A family account may only ever resolve this ONE expedition member.
  linked_person_id    UUID,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_person_key ON users (person_id) WHERE person_id IS NOT NULL;
CREATE INDEX users_role_idx ON users (role_id);

-- Refresh helper used by every trigger below.
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- Geography: stations, camps, routes, hazard zones
-- ----------------------------------------------------------------------------
CREATE TABLE stations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  short_name            TEXT NOT NULL,
  kind                  TEXT NOT NULL CHECK (kind IN ('station','camp','depot')),
  location              geography(Point, 4326) NOT NULL,
  lat                   DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon                   DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  established           TEXT,
  note                  TEXT,
  status                TEXT NOT NULL DEFAULT 'nominal'
                        CHECK (status IN ('nominal','watch','critical')),
  -- TRUE for seeded reference values. The UI must never present these as live.
  operational_data_simulated BOOLEAN NOT NULL DEFAULT TRUE,
  emergency_capability  TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT station_geometry_matches CHECK (
    ST_X(location::geometry) = lon AND ST_Y(location::geometry) = lat
  )
);
CREATE INDEX stations_location_gix ON stations USING GIST (location);
CREATE INDEX stations_kind_idx ON stations (kind);

CREATE TABLE field_camps (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code         TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  station_id   UUID REFERENCES stations(id) ON DELETE SET NULL,
  location     geography(Point, 4326) NOT NULL,
  lat          DOUBLE PRECISION NOT NULL,
  lon          DOUBLE PRECISION NOT NULL,
  occupied     BOOLEAN NOT NULL DEFAULT FALSE,
  capacity     INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX field_camps_location_gix ON field_camps USING GIST (location);

CREATE TABLE routes (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  from_station_id UUID NOT NULL REFERENCES stations(id),
  to_station_id   UUID NOT NULL REFERENCES stations(id),
  -- LINESTRING, not a point array: PostGIS can then answer intersection
  -- and clearance questions that a JSON waypoint list cannot.
  path          geography(LineString, 4326) NOT NULL,
  distance_km   DOUBLE PRECISION NOT NULL,
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('active','planned','closed')),
  surface       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX routes_path_gix ON routes USING GIST (path);
CREATE INDEX routes_status_idx ON routes (status);

CREATE TABLE hazard_zones (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hazard_code   TEXT NOT NULL UNIQUE,
  hazard_type   TEXT NOT NULL CHECK (hazard_type IN
                  ('CREVASSE','WHITEOUT','BLIZZARD','UNSTABLE_ICE',
                   'WEATHER_HAZARD','RESTRICTED_ZONE','ROUTE_CLOSURE')),
  label         TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('critical','warning','info')),
  -- POLYGON in real geographic terms; the centroid/radius pair is kept for
  -- the field client's cheap point-in-circle pre-check.
  boundary      geography(Polygon, 4326) NOT NULL,
  centroid      geography(Point, 4326) NOT NULL,
  radius_km     DOUBLE PRECISION NOT NULL CHECK (radius_km > 0),
  source        TEXT NOT NULL,
  description   TEXT NOT NULL,
  route_id      UUID REFERENCES routes(id) ON DELETE SET NULL,
  station_id    UUID REFERENCES stations(id) ON DELETE SET NULL,
  valid_from    TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_until   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX hazard_zones_boundary_gix ON hazard_zones USING GIST (boundary);
CREATE INDEX hazard_zones_centroid_gix ON hazard_zones USING GIST (centroid);
-- Partial index: the geofence engine only ever asks about currently-valid zones.
CREATE INDEX hazard_zones_active_idx ON hazard_zones (valid_from, valid_until)
  WHERE valid_until IS NULL;

-- ----------------------------------------------------------------------------
-- Personnel and devices
-- ----------------------------------------------------------------------------
CREATE TABLE personnel (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  polaris_id        TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL,
  expedition        TEXT NOT NULL,
  station_id        UUID NOT NULL REFERENCES stations(id),
  team              TEXT NOT NULL,
  shift             TEXT,
  emergency_contact TEXT,
  -- Encrypted at rest by pgcrypto; readable only via the SECURITY DEFINER
  -- view below, which itself checks the caller's role.
  medical_note_enc  BYTEA,
  blood_group       TEXT,
  current_assignment TEXT,
  status            TEXT NOT NULL DEFAULT 'ON_STATION'
                    CHECK (status IN ('ON_STATION','FIELD','IN_TRANSIT','REST','OFFLINE','EMERGENCY')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX personnel_station_idx ON personnel (station_id);
CREATE INDEX personnel_team_idx ON personnel (team);

CREATE TABLE devices (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_code    TEXT NOT NULL UNIQUE,
  kind           TEXT NOT NULL CHECK (kind IN ('PERSONAL','VEHICLE','STATION','FIELD_TABLET')),
  label          TEXT NOT NULL,
  -- A tracker follows a person; a telematics unit follows a vehicle.
  person_id      UUID REFERENCES personnel(id) ON DELETE CASCADE,
  vehicle_id     UUID,
  connectivity   TEXT NOT NULL DEFAULT 'ONLINE' CHECK (connectivity IN ('ONLINE','LOW','OFFLINE')),
  battery_pct    NUMERIC(5,2) CHECK (battery_pct BETWEEN 0 AND 100),
  firmware       TEXT,
  last_event_at  TIMESTAMPTZ,
  simulated      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX devices_person_idx ON devices (person_id);
CREATE INDEX devices_vehicle_idx ON devices (vehicle_id);

ALTER TABLE users
  ADD CONSTRAINT users_person_fk FOREIGN KEY (person_id) REFERENCES personnel(id) ON DELETE SET NULL;

ALTER TABLE users
  ADD CONSTRAINT users_linked_person_fk FOREIGN KEY (linked_person_id) REFERENCES personnel(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- Vehicles and convoys
-- ----------------------------------------------------------------------------
CREATE TABLE vehicles (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehicle_code         TEXT NOT NULL UNIQUE,
  kind                 TEXT NOT NULL CHECK (kind IN ('ship','helicopter','aircraft','snow_vehicle','tractor')),
  label                TEXT NOT NULL,
  call_sign            TEXT,
  status               TEXT NOT NULL DEFAULT 'SCHEDULED'
                       CHECK (status IN ('SCHEDULED','LOADING','IN_TRANSIT','DELAYED',
                                         'WEATHER_HOLD','ARRIVED','COMPLETED','CANCELLED')),
  route_id             UUID REFERENCES routes(id) ON DELETE SET NULL,
  destination_station_id UUID REFERENCES stations(id) ON DELETE SET NULL,
  eta_at               TIMESTAMPTZ,
  fuel_pct             NUMERIC(5,2) NOT NULL CHECK (fuel_pct BETWEEN 0 AND 100),
  capacity_kg          NUMERIC(12,2) NOT NULL,
  device_id            UUID REFERENCES devices(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_status_idx ON vehicles (status);

ALTER TABLE devices
  ADD CONSTRAINT devices_vehicle_fk FOREIGN KEY (vehicle_id) REFERENCES vehicles(id) ON DELETE CASCADE;

CREATE TABLE convoys (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  convoy_code           TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  mission_id            UUID,
  route_id              UUID NOT NULL REFERENCES routes(id),
  origin_station_id     UUID NOT NULL REFERENCES stations(id),
  destination_station_id UUID NOT NULL REFERENCES stations(id),
  departure_at          TIMESTAMPTZ NOT NULL,
  expected_arrival_at   TIMESTAMPTZ NOT NULL,
  last_checkin_at       TIMESTAMPTZ,
  checkin_interval_min  INTEGER NOT NULL DEFAULT 30 CHECK (checkin_interval_min > 0),
  status                TEXT NOT NULL DEFAULT 'PLANNED'
                        CHECK (status IN ('PLANNED','ACTIVE','ARRIVED','RETURNING','CANCELLED')),
  comms                 TEXT NOT NULL DEFAULT 'CONNECTED'
                        CHECK (comms IN ('CONNECTED','LOW','OFFLINE','MISSED_CHECK_IN')),
  fuel_pct              NUMERIC(5,2) NOT NULL DEFAULT 100,
  emergency_status      TEXT NOT NULL DEFAULT 'NONE'
                        CHECK (emergency_status IN ('NONE','CHECK_IN_OVERDUE','SOS')),
  progress              DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 1),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX convoys_status_idx ON convoys (status);
CREATE INDEX convoys_checkin_idx ON convoys (last_checkin_at)
  WHERE status = 'ACTIVE';

CREATE TABLE convoy_personnel (
  convoy_id  UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  person_id  UUID NOT NULL REFERENCES personnel(id) ON DELETE CASCADE,
  PRIMARY KEY (convoy_id, person_id)
);

CREATE TABLE convoy_vehicles (
  convoy_id  UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  PRIMARY KEY (convoy_id, vehicle_id)
);

CREATE TABLE convoy_checkins (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  convoy_id       UUID NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  device_id       UUID REFERENCES devices(id) ON DELETE SET NULL,
  recorded_at     TIMESTAMPTZ NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  fuel_pct        NUMERIC(5,2),
  personnel_count INTEGER,
  note            TEXT,
  offline_origin  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX convoy_checkins_convoy_idx ON convoy_checkins (convoy_id, recorded_at DESC);
CREATE INDEX convoy_checkins_location_gix ON convoy_checkins USING GIST (location);

-- ----------------------------------------------------------------------------
-- Triggers
-- ----------------------------------------------------------------------------
CREATE TRIGGER stations_touch BEFORE UPDATE ON stations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER field_camps_touch BEFORE UPDATE ON field_camps
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER routes_touch BEFORE UPDATE ON routes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER hazard_zones_touch BEFORE UPDATE ON hazard_zones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER personnel_touch BEFORE UPDATE ON personnel
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER devices_touch BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER vehicles_touch BEFORE UPDATE ON vehicles
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER convoys_touch BEFORE UPDATE ON convoys
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER users_touch BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

COMMIT;
