-- ============================================================================
-- POLARIS · seed
--
-- Two categories, kept strictly apart:
--
--   REAL       — published station coordinates, ice-shelf geography, camp
--                positions. Sourced from NCPOR / SCAR Composite Gazetteer.
--   SIMULATED  — personnel counts, cargo quantities, fuel, weather, telemetry.
--                Every such row carries operational_data_simulated = TRUE (or
--                simulated = TRUE) so no service can present it as live.
--
-- Operational values are the demonstration payload and are meant to be
-- replaced by real integrations. Reference geography is not.
--
--   npm run db:seed        seed reference + demo data
--   npm run db:seed:ref    seed reference geography only
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Reference geography (REAL)
-- ----------------------------------------------------------------------------
INSERT INTO stations
  (code, name, short_name, kind, lat, lon, location, established, note, status,
   operational_data_simulated, emergency_capability)
VALUES
  ('MTRI', 'Maitri (V83)', 'MAITRI', 'station', -70.7586, 11.7286,
   ST_SetSRID(ST_MakePoint(11.7286, -70.7586), 4326)::geography,
   '1989 · 9th Antarctic station operated by India',
   'Schirmacher Oasis, East Antarctica. Coordinates are published; operational figures below are SIMULATED.',
   'nominal', TRUE, 'Medical officer, 2 × snow vehicle, rotary available'),

  ('BHRT', 'Bharati (V83)', 'BHARATI', 'station', -69.4067, 76.1868,
   ST_SetSRID(ST_MakePoint(76.1868, -69.4067), 4326)::geography,
   '2012 · India''s third research station',
   'Larsemann Hills, East Antarctica. Coordinates are published; operational figures below are SIMULATED.',
   'watch', TRUE, 'Medical officer, 1 × snow vehicle, comms relay to Maitri'),

  ('DGRP', 'Dakshin Gangotri Depot (B03)', 'DG DEPOT', 'depot', -70.4521, 12.0,
   ST_SetSRID(ST_MakePoint(12.0, -70.4521), 4326)::geography,
   '1983 · first Indian station, now a logistics depot',
   'Central ice depot. Coordinates are published; operational figures are SIMULATED.',
   'nominal', TRUE, 'Trailer-mounted shelter, generator, cached fuel'),

  ('SP', 'South Pole Station (AMANDA)', 'SOUTH POLE', 'depot', -90.0, 0.0,
   ST_SetSRID(ST_MakePoint(0.0, -90.0), 4326)::geography,
   'Amundsen–Scott',
   'Geometric pole. Listed for regional completeness; no Indian logistics are scheduled here.',
   'nominal', TRUE, 'Full scientific and medical support')
ON CONFLICT (code) DO NOTHING;

INSERT INTO field_camps (code, name, station_id, lat, lon, location, occupied, capacity)
SELECT
  c.code, c.name, s.id, c.lat, c.lon,
  ST_SetSRID(ST_MakePoint(c.lon, c.lat), 4326)::geography, TRUE, c.cap
FROM (VALUES
  ('CAMP-SUHRID',   'Camp Suhrid',         'MTRI', -71.1,  14.8, 6),
  ('CAMP-PRIYADARSHINI', 'Camp Priyadarshini', 'MTRI', -70.6, 10.2, 8),
  ('CAMP-LARSEMANN-N',  'Camp Larsemann N',  'BHRT', -68.9,  77.5, 5)
) AS c(code, name, st, lat, lon, cap)
JOIN stations s ON s.code = c.st
ON CONFLICT (code) DO NOTHING;

-- Routes carry a real LINESTRING so PostGIS can answer intersection questions.
INSERT INTO routes (name, from_station_id, to_station_id, path, distance_km, status, surface)
SELECT
  r.name, a.id, b.id,
  ST_SetSRID(ST_MakeLine(ARRAY[
    ST_MakePoint(r.lon1, r.lat1), ST_MakePoint(r.lon2, r.lat2),
    ST_MakePoint(r.lon3, r.lat3), ST_MakePoint(r.lon4, r.lat4)
  ]), 4326)::geography,
  ST_Length(ST_SetSRID(ST_MakeLine(ARRAY[
    ST_MakePoint(r.lon1, r.lat1), ST_MakePoint(r.lon2, r.lat2),
    ST_MakePoint(r.lon3, r.lat3), ST_MakePoint(r.lon4, r.lat4)
  ]), 4326)::geography) / 1000.0,
  r.status, r.surface
FROM (VALUES
  ('Maitri → Camp Suhrid',        'MTRI', 'CAMP-SUHRID',
   -70.7586, 11.7286, -70.9, 13.1, -71.05, 14.2, -71.1, 14.8, 'active', 'ice'),
  ('Maitri → Camp Priyadarshini', 'MTRI', 'CAMP-PRIYADARSHINI',
   -70.7586, 11.7286, -70.7, 11.1, -70.65, 10.6, -70.6, 10.2, 'active', 'ice'),
  ('Maitri → Dakshin Gangotri',   'MTRI', 'DGRP',
   -70.7586, 11.7286, -70.6, 11.9, -70.52, 12.0, -70.4521, 12.0, 'active', 'ice'),
  ('Dakshin Gangotri → Bharati',  'DGRP', 'BHRT',
   -70.4521, 12.0, -70.1, 35.0, -69.8, 60.0, -69.4067, 76.1868, 'planned', 'ice'),
  ('Bharati → Camp Larsemann N',  'BHRT', 'CAMP-LARSEMANN-N',
   -69.4067, 76.1868, -69.1, 76.9, -69.0, 77.2, -68.9, 77.5, 'active', 'ice')
) AS r(name, from_code, to_code, lat1, lon1, lat2, lon2, lat3, lon3, lat4, lon4, status, surface)
JOIN stations a ON a.code = r.from_code
JOIN stations b ON b.code = r.to_code
WHERE NOT EXISTS (SELECT 1 FROM routes WHERE routes.name = r.name);

-- Hazard zones. `source` records provenance, which is not the same as
-- simulation: a surveyed crevasse field is real even if it was published by hand.
INSERT INTO hazard_zones
  (hazard_code, hazard_type, label, severity, boundary, centroid, radius_km,
   source, description, valid_from, valid_until)
SELECT
  h.code, h.htype::text, h.label, h.severity,
  ST_Buffer(
    ST_SetSRID(ST_MakePoint(h.lon, h.lat), 4326)::geography,
    h.radius_km * 1000
  )::geography,
  ST_SetSRID(ST_MakePoint(h.lon, h.lat), 4326)::geography,
  h.radius_km, h.source, h.description, now() - (h.age_hours || ' hours')::interval, NULL
FROM (VALUES
  ('HZ-01','CREVASSE','Crevasse Field A — Schirmacher approach','critical',
   -70.92, 12.55, 6.5,'Surveyed aerial photography + ground survey',
   'Transverse crevasse field. Guided passage only; vehicle spacing 50 m.', 720),
  ('HZ-02','BLIZZARD','Katabatic zone — Pronisena flows','critical',
   -71.45, 12.0, 28.0,'Meteorological service advisory',
   'Recurring katabatic outflow. Ground movement suspended above wind gate.', 12),
  ('HZ-03','WHITEOUT','Low visibility — Prydz Bay coast','warning',
   -68.8, 74.8, 30.0,'Surface observation',
   'Visibility below 2 km along the coast. VFR helicopter operations suspended.', 6),
  ('HZ-04','UNSTABLE_ICE','Ice shelf margin — Lazarev','warning',
   -69.9, 15.8, 18.0,'Satellite altimetry',
   'Shelf margin thinning. Keep 3 km clear of the grounding line.', 48),
  ('HZ-05','RESTRICTED_ZONE','Protected area — Larsemann Hills','warning',
   -69.15, 76.75, 9.0,'Antarctic Treaty environmental protocol',
   'Biological research protection. No powered vehicle entry without permit.', 720)
) AS h(code, htype, label, severity, lat, lon, radius_km, source, description, age_hours)
WHERE NOT EXISTS (SELECT 1 FROM hazard_zones WHERE hazard_zones.hazard_code = h.code);

-- ----------------------------------------------------------------------------
-- Personnel (SIMULATED)
-- ----------------------------------------------------------------------------
INSERT INTO personnel
  (polaris_id, name, role, expedition, station_id, team, shift, emergency_contact, blood_group, current_assignment, status)
SELECT
  p.pid, p.name, p.role, p.exp, s.id, p.team, p.shift, p.emergency, p.blood, p.assignment, 'ON_STATION'
FROM (VALUES
  ('P-001','Dr. Ananya Sharma','Expedition Leader','27th IAE','MTRI','Command','ALPHA','+91-98xxx-00001','O+','Expedition command',),
  ('P-002','Cmdr. Vikram Rathore','Station Commander','27th IAE','MTRI','Command','ALPHA','+91-98xxx-00002','A+','Station operations',),
  ('P-003','Dr. Meera Iyer','Medical Officer','27th IAE','MTRI','Medical','BRAVO','+91-98xxx-00003','B+','Medical cover',),
  ('P-004','Sgt. Rohan Patil','Logistics Lead','27th IAE','MTRI','Logistics','BRAVO','+91-98xxx-00004','O-','Resupply coordination',),
  ('P-005','Capt. Nitin Kulkarni','Transport Officer','27th IAE','MTRI','Transport','CHARLIE','+91-98xxx-00005','A-','Convoy movement',),
  ('P-006','Dr. S. Nandi','Medical Officer','27th IAE','BHRT','Medical','ALPHA','+91-98xxx-00006','AB+','Medical cover',),
  ('P-007','Smt. Kavya Menon','Communications Officer','27th IAE','BHRT','Comms','BRAVO','+91-98xxx-00007','O+','Satcom operations',),
  ('P-008','Shri. B. Tudu','Field Engineer','27th IAE','BHRT','Engineering','CHARLIE','+91-98xxx-00008','B-','Power plant upkeep',),
  ('P-009','Dr. A. Bose','Glaciologist','27th IAE','BHRT','Science','ALPHA','+91-98xxx-00009','A+','Ice-core sampling',),
  ('P-010','Shri. D. Singh','Field Technician','27th IAE','MTRI','Engineering','CHARLIE','+91-98xxx-00010','O-','Generator audit',),
  ('P-011','Dr. P. Nair','Medical Officer','27th IAE','MTRI','Medical','CHARLIE','+91-98xxx-00011','A-','Medical cover',),
  ('P-012','Smt. R. Devi','Meteorologist','27th IAE','MTRI','Science','BRAVO','+91-98xxx-00012','B+','Surface meteorology',)
) AS p(pid, name, role, exp, st, team, shift, emergency, blood, assignment)
JOIN stations s ON s.code = p.st
WHERE NOT EXISTS (SELECT 1 FROM personnel WHERE personnel.polaris_id = p.pid);

INSERT INTO devices (device_code, kind, label, person_id, connectivity, battery_pct, simulated)
SELECT
  'DEV-' || replace(p.polaris_id, 'P-', ''), 'PERSONAL', p.name || ' tracker', p.id, 'ONLINE', 100, TRUE
FROM personnel p
WHERE NOT EXISTS (SELECT 1 FROM devices WHERE devices.device_code = 'DEV-' || replace(p.polaris_id, 'P-', ''));

-- ----------------------------------------------------------------------------
-- Vehicles and convoys (SIMULATED)
-- ----------------------------------------------------------------------------
INSERT INTO vehicles
  (vehicle_code, kind, label, call_sign, status, route_id, destination_station_id,
   fuel_pct, capacity_kg)
SELECT
  v.code, v.kind::text, v.label, v.callsign, v.status::text,
  r.id, dest.id, v.fuel, v.cap
FROM (VALUES
  ('MV-APAMA','ship','MV Apama','VIDA','IN_TRANSIT', 'Maitri → Dakshin Gangotri','DGRP', 68, 240000),
  ('H-02','helicopter','Helicopter H-02','SKY02','WEATHER_HOLD','Bharati → Camp Larsemann N','BHRT', 44, 1200),
  ('IA-203','aircraft','Flight IA-203','IA203','SCHEDULED','Maitri → Bharati','BHRT', 92, 1800),
  ('S-04','snow_vehicle','Snow Vehicle S-04','S04','IN_TRANSIT','Maitri → Camp Suhrid','MTRI', 54, 3500),
  ('S-05','snow_vehicle','Snow Vehicle S-05','S05','IN_TRANSIT','Maitri → Camp Suhrid','MTRI', 61, 3500),
  ('S-02','snow_vehicle','Snow Vehicle S-02','S02','SCHEDULED','Maitri → Dakshin Gangotri','DGRP', 88, 3500)
) AS v(code, kind, label, callsign, status, route_name, dest_code, fuel, cap)
JOIN routes r ON r.name = v.route_name
JOIN stations dest ON dest.code = v.dest_code
WHERE NOT EXISTS (SELECT 1 FROM vehicles WHERE vehicles.vehicle_code = v.code);

INSERT INTO convoys
  (convoy_code, name, route_id, origin_station_id, destination_station_id,
   departure_at, expected_arrival_at, last_checkin_at, checkin_interval_min,
   status, comms, fuel_pct, emergency_status, progress)
SELECT
  c.code, c.name, r.id, o.id, d.id,
  now() - (c.elapsed_min || ' minutes')::interval,
  now() + (c.remaining_min || ' minutes')::interval,
  now() - (c.since_checkin || ' minutes')::interval,
  c.interval, c.status::text, c.comms::text, c.fuel, 'NONE', c.progress
FROM (VALUES
  ('CV-07','Convoy 07 · resupply run','Maitri → Camp Suhrid','MTRI','CAMP-SUHRID',
   180, 240, 12, 30, 'ACTIVE','CONNECTED',58, 0.34),
  ('CV-03','Convoy 03 · science party','Bharati → Camp Larsemann N','BHRT','CAMP-LARSEMANN-N',
   95,  150, 41, 30, 'ACTIVE','MISSED_CHECK_IN',71, 0.22)
) AS c(code, name, route_name, from_code, to_code, elapsed_min, remaining_min,
       since_checkin, interval, status, comms, fuel, progress)
JOIN routes r ON r.name = c.route_name
JOIN stations o ON o.code = c.from_code
JOIN stations d ON d.code = c.to_code
WHERE NOT EXISTS (SELECT 1 FROM convoys WHERE convoys.convoy_code = c.code);

INSERT INTO convoy_vehicles (convoy_id, vehicle_id)
SELECT c.id, v.id
FROM convoys c
JOIN routes r ON r.id = c.route_id
JOIN vehicles v ON v.route_id = r.id
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- Mission (must exist before cargo references it)
-- ----------------------------------------------------------------------------
INSERT INTO missions (mission_code, name, expedition, status, origin, destination_id, departure_at, return_at)
SELECT 'M-27', '27th Expedition Resupply', '27th IAE', 'ACTIVE', 'Maitri', d.id,
       now() - interval '40 days', now() + interval '120 days'
FROM stations d WHERE d.code = 'BHRT'
ON CONFLICT (mission_code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- Cargo and inventory (SIMULATED)
-- ----------------------------------------------------------------------------
INSERT INTO cargo
  (cargo_code, rfid, barcode, item_type, quantity, unit, weight_kg, origin,
   destination_station_id, mission_id, containers_expected, containers_received,
   status, expected_arrival_at, verification, priority)
SELECT
  'CARGO-' || lpad(gs.n::text, 5, '0'),
  'RFID-' || lpad(gs.n::text, 5, '0'),
  lpad((6200000000000::bigint + gs.n)::text, 13, '0'),
  gs.item, gs.qty, gs.unit, gs.qty, 'India', d.id, m.id,
  gs.expected, gs.received, gs.status::text,
  now() + (gs.eta_days || ' days')::interval, gs.verification::text, gs.priority::text
FROM (VALUES
  (482,'Frozen provisions',240,'kg',100,97,'IN_TRANSIT',21,'DISCREPANT','HIGH'),
  (481,'Diesel',18000,'L',40,40,'ARRIVED',2,'VERIFIED','CRITICAL'),
  (479,'Medical consumables',900,'units',25,25,'RECEIVED',-1,'VERIFIED','CRITICAL'),
  (477,'Scientific equipment',420,'kg',12,12,'IN_INVENTORY',-3,'VERIFIED','ROUTINE'),
  (475,'Spare parts',160,'units',18,16,'ARRIVED',4,'DISCREPANT','ROUTINE')
) AS gs(n, item, qty, unit, expected, received, status, eta_days, verification, priority)
CROSS JOIN stations d
CROSS JOIN missions m
WHERE d.code = 'BHRT' AND m.mission_code = 'M-27'
  AND NOT EXISTS (SELECT 1 FROM cargo WHERE cargo.cargo_code = 'CARGO-' || lpad(gs.n::text, 5, '0'));

INSERT INTO cargo
  (cargo_code, rfid, barcode, item_type, quantity, unit, weight_kg, origin,
   destination_station_id, mission_id, containers_expected, containers_received,
   status, expected_arrival_at, verification, priority)
SELECT
  'CARGO-00480', 'RFID-00480', '6200000000480', 'Kerosene', 6000, 'L', 6000,
  'India', d.id, m.id, 20, 0, 'PLANNED', now() + interval '28 days', 'PENDING', 'ROUTINE'
FROM stations d, missions m
WHERE d.code = 'MTRI' AND m.mission_code = 'M-27'
  AND NOT EXISTS (SELECT 1 FROM cargo WHERE cargo.cargo_code = 'CARGO-00480');

INSERT INTO inventory_items
  (item_code, item_name, category, station_id, quantity, unit, batch,
   min_threshold, consumption_per_day, incoming_quantity, reserved_quantity, expires_at)
SELECT
  'ITM-' || lpad(i.n::text, 4, '0'), i.item, i.cat::text, s.id,
  i.qty, i.unit, i.batch, i.min, i.per_day, i.incoming, i.reserved,
  CASE WHEN i.expiry_days IS NULL THEN NULL ELSE now() + (i.expiry_days || ' days')::interval END
FROM (VALUES
  (1,'Diesel','FUEL','MTRI',4200,'L','B-24A',3000,180,18000,500,NULL),
  (2,'Kerosene','FUEL','MTRI',1400,'L','B-24B',800,55,6000,200,NULL),
  (3,'Frozen provisions','FOOD','MTRI',260,'kg','B-24C',400,9.5,240,120,180),
  (4,'Medical consumables','MEDICAL','MTRI',640,'units','B-24D',300,6,900,80,240),
  (5,'Diesel','FUEL','BHRT',3600,'L','B-24E',2500,150,18000,400,NULL),
  (6,'Frozen provisions','FOOD','BHRT',310,'kg','B-24F',380,8.2,240,100,165),
  (7,'Medical consumables','MEDICAL','BHRT',520,'units','B-24G',280,5.4,900,70,230),
  (8,'Spare parts','SPARES','BHRT',120,'units','B-24H',90,1.2,160,20,NULL),
  (9,'Scientific equipment','SCIENTIFIC','BHRT',300,'kg','B-24I',200,0.8,420,60,NULL)
) AS i(n, item, cat, st, qty, unit, batch, min, per_day, incoming, reserved, expiry_days)
JOIN stations s ON s.code = i.st
WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE inventory_items.item_code = 'ITM-' || lpad(i.n::text, 4, '0'));

-- The ledger must reconstruct the balances above, so seed it as the opening
-- position of each line rather than leaving stock unexplained.
INSERT INTO inventory_transactions (item_id, station_id, delta, reason, actor, recorded_at, origin_event_id)
SELECT it.id, it.station_id, it.quantity, 'RECEIPT', 'system:db:seed', it.created_at, 'seed:opening-balance'
FROM inventory_items it
WHERE NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE inventory_transactions.item_id = it.id);

-- ----------------------------------------------------------------------------
-- Weather (SIMULATED — no live Antarctic feed connected)
-- ----------------------------------------------------------------------------
INSERT INTO weather_events
  (station_id, observed_at, temperature_c, wind_kph, gust_kph, visibility_km,
   pressure_hpa, precipitation_mm, condition, storm_flag, source, simulated)
SELECT
  s.id, now() - (w.ago_min || ' minutes')::interval,
  w.temp, w.wind, w.gust, w.vis, w.press, w.precip, w.cond, w.storm, 'simulator', TRUE
FROM (VALUES
  ('MTRI', 12, -18.4, 22, 31, 6.0, 992, 0.4, 'Light snow', FALSE),
  ('BHRT', 18, -24.1, 58, 74, 1.2, 981, 0.9, 'Blowing snow', TRUE),
  ('DGRP', 25, -26.7, 17, 24, 9.5, 998, 0.0, 'Clear', FALSE)
) AS w(st, ago_min, temp, wind, gust, vis, press, precip, cond, storm)
JOIN stations s ON s.code = w.st
WHERE NOT EXISTS (
  SELECT 1 FROM weather_events we
  WHERE we.station_id = s.id AND we.observed_at > now() - interval '1 hour'
);

-- ----------------------------------------------------------------------------
-- Family, well-being, medical, tasks (SIMULATED)
-- ----------------------------------------------------------------------------
INSERT INTO family_members (family_code, name, relationship, person_id, authorized)
SELECT f.code, f.name, f.rel, p.id, TRUE
FROM (VALUES
  ('FAM-01','Sunita Sharma','Spouse','P-001'),
  ('FAM-02','Arjun Rathore','Son','P-002'),
  ('FAM-03','Lakshmi Iyer','Daughter','P-003'),
  ('FAM-04','Rohan Patil Sr.','Father','P-004')
) AS f(code, name, rel, pid)
JOIN personnel p ON p.polaris_id = f.pid
ON CONFLICT (family_code) DO NOTHING;

INSERT INTO wellbeing_checkins (person_id, recorded_at, level, support_route)
SELECT p.id, now() - (w.ago_h || ' hours')::interval, w.lvl::text, w.route::text
FROM (VALUES
  ('P-001', 2, 'GOOD', NULL), ('P-002', 3, 'OKAY', NULL), ('P-003', 5, 'GOOD', NULL),
  ('P-004', 4, 'OKAY', NULL), ('P-005', 26, 'LOW', 'TEAM'), ('P-006', 6, 'GOOD', NULL),
  ('P-007', 8, 'GOOD', NULL), ('P-008', 7, 'OKAY', NULL), ('P-009', 9, 'GOOD', NULL),
  ('P-010', 11, 'GOOD', NULL), ('P-011', 5, 'GOOD', NULL), ('P-012', 6, 'OKAY', NULL)
) AS w(pid, ago_h, lvl, route)
JOIN personnel p ON p.polaris_id = w.pid
WHERE NOT EXISTS (SELECT 1 FROM wellbeing_checkins b WHERE b.person_id = p.id);

INSERT INTO medical_cases
  (case_code, person_id, observations, vitals, priority, status, recorded_by, recorded_at, offline_origin)
SELECT 'MED-0001', p.id,
  'Field dressing applied for a superficial laceration sustained while securing cargo. No neurovascular involvement observed by the reporting officer.',
  'BP 128/82, pulse 88, temp 36.8', 'ROUTINE', 'TRANSMITTED', 'P-011', now() - interval '2 days', TRUE
FROM personnel p WHERE p.polaris_id = 'P-010'
ON CONFLICT (case_code) DO NOTHING;

INSERT INTO tasks (task_code, title, station_id, due_at, status, priority)
SELECT 'T-101', 'Generator B audit', s.id, now() + interval '2 days', 'IN_PROGRESS', 'HIGH'
FROM stations s WHERE s.code = 'MTRI'
ON CONFLICT (task_code) DO NOTHING;

INSERT INTO tasks (task_code, title, station_id, due_at, status, priority)
SELECT 'T-102', 'Fuel dip reconciliation — depot', s.id, now() + interval '1 day', 'OPEN', 'CRITICAL'
FROM stations s WHERE s.code = 'MTRI'
ON CONFLICT (task_code) DO NOTHING;

INSERT INTO notifications (notification_code, kind, severity, title, detail, audience, channels, dedupe_key)
VALUES
  ('NTF-SEED-01','CARGO_DISCREPANCY','warning','CARGO DISCREPANCY — CARGO-00482 short 3 container(s)',
   'Expected 100, received 97. POLARIS does not overwrite offline counts; an authorised operator must resolve.',
   ARRAY['ADMIN','CONTROL_ROOM'], ARRAY['IN_APP','PUSH'], 'seed:cargo:482'),
  ('NTF-SEED-02','CHECK_IN_OVERDUE','warning','CHECK-IN OVERDUE — CV-03',
   'Last check-in 41 minutes ago against a 30 minute cadence. Investigate; this is not classified as an emergency.',
   ARRAY['ADMIN','CONTROL_ROOM','STATION_COMMANDER'], ARRAY['IN_APP','PUSH'], 'seed:cv03:overdue'),
  ('NTF-SEED-03','INVENTORY_LOW','critical','Fuel projected below reserve threshold',
   'Diesel at Maitri is 4200 L against a 3000 L minimum and 180 L/day draw, with an inbound leg already in transit.',
   ARRAY['ADMIN','CONTROL_ROOM'], ARRAY['IN_APP','PUSH'], 'seed:fuel:mtri')
ON CONFLICT (notification_code) DO NOTHING;

INSERT INTO audit_logs (actor, actor_role, action, target, result, metadata)
VALUES
  ('system:db:seed','ADMIN','Reference and demonstration data loaded','database:seed','OK',
   '{"real":["station coordinates","camp positions","route geometry","hazard boundaries"],"simulated":["personnel","cargo","inventory","weather","telemetry"]}'::jsonb);

COMMIT;
