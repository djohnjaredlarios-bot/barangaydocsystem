PRAGMA foreign_keys = OFF;

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS user (
    user_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Resident',
    contact_number TEXT,
    address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document (
    document_id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_name TEXT NOT NULL,
    description TEXT,
    is_digital_available INTEGER DEFAULT 0,
    category TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_requirement (
    requirement_id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL,
    requirement_name TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (document_id) REFERENCES document(document_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request (
    request_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    document_id INTEGER NOT NULL,
    request_date DATE NOT NULL,
    delivery_method TEXT NOT NULL DEFAULT 'Physical',
    status TEXT NOT NULL DEFAULT 'Pending',
    staff_id INTEGER,
    requester_name TEXT,
    requester_status TEXT,
    requester_contact TEXT,
    civil_status TEXT,
    age INTEGER,
    claiming_method TEXT,
    visitor_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(user_id) ON DELETE CASCADE,
    FOREIGN KEY (document_id) REFERENCES document(document_id) ON DELETE CASCADE,
    FOREIGN KEY (staff_id) REFERENCES user(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS appointment_slot (
    slot_id INTEGER PRIMARY KEY AUTOINCREMENT,
    date DATE NOT NULL,
    time_slot TEXT NOT NULL,
    is_available INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (date, time_slot)
);

CREATE TABLE IF NOT EXISTS appointment (
    appointment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    appointment_date DATE NOT NULL,
    time_slot TEXT NOT NULL,
    status TEXT DEFAULT 'Scheduled',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_detail (
    detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS request_attachment (
    attachment_id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    requirement_id INTEGER,
    file_path TEXT,
    file_url TEXT,
    original_filename TEXT,
    uploaded_by INTEGER,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE,
    FOREIGN KEY (requirement_id) REFERENCES document_requirement(requirement_id) ON DELETE SET NULL,
    FOREIGN KEY (uploaded_by) REFERENCES user(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS event (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    date DATE NOT NULL,
    time TEXT,
    start_time TEXT,
    end_time TEXT,
    location TEXT,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS announcement (
    announcement_id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS digital_document (
    digital_doc_id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id INTEGER NOT NULL,
    file_path TEXT,
    file_url TEXT,
    download_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_email ON user(email);
CREATE INDEX IF NOT EXISTS idx_user_role ON user(role);
CREATE INDEX IF NOT EXISTS idx_request_status ON request(status);
CREATE INDEX IF NOT EXISTS idx_appointment_date ON appointment(appointment_date);

-- Seed minimal initial data (safe with INSERT OR IGNORE)
INSERT OR IGNORE INTO user (user_id, name, email, password, role, contact_number, address) VALUES
(1, 'Admin User', 'admin@example.com', 'pbkdf2:sha256:600000$ykEiDQHd8VqGnfHj$c4ff9ba01f09be65752d706e7d164dfa5bb56f9e9a3639e4692bade3468665df', 'Admin', '09171234567', 'Barangay Hall'),
(2, 'Staff User', 'staff@example.com', 'pbkdf2:sha256:600000$vECFp7u4IIgjI8Lp$cd0f428461cc8ddf3778885879f987f6b2c2eace5281827f8f8e67f83451f78d', 'Staff', '09179876543', 'Barangay Office'),
(3, 'Resident User', 'resident@example.com', 'pbkdf2:sha256:600000$h68JTTdc5OxtCm0V$1213ca6af89f216f3526cb85ecc3430b2a26dda58d88a5bb4d225716815e1968', 'Resident', '09171239876', '123 Barangay St.');

INSERT OR IGNORE INTO document (document_id, document_name, description, is_digital_available, category) VALUES
(1, 'Certificate of Residency', 'Proof of residence in the barangay', 1, 'Certifications'),
(2, 'Indigency Certificate', 'Certificate for indigent individuals', 1, 'Certifications'),
(3, 'Business Clearance', 'Business clearance request', 0, 'Clearances'),
(4, 'Barangay Clearance', 'Certificate of good moral character', 1, 'Clearances'),
(5, 'Cohabitation', 'Cohabitation certification', 1, 'Certifications'),
(6, 'Solo Parent', 'Solo parent certification', 1, 'Certifications'),
(7, 'Unemployment Certificate', 'Proof of unemployment', 1, 'Certifications'),
(8, 'Barangay Permit', 'Permit issued by barangay', 0, 'Permits'),
(9, 'Travel Permit', 'Permit for travel', 0, 'Permits'),
(10, 'Event Permit', 'Permit for events', 0, 'Permits'),
(11, 'Renovation Permit', 'Permit for renovations', 0, 'Permits'),
(12, 'Business Permit', 'Permit for business operations', 0, 'Permits'),
(13, 'Barangay ID', 'Official barangay identification', 0, 'IDs'),
(14, 'Senior Citizen ID', 'Senior citizen identification card', 0, 'IDs'),
(15, 'Cedula', 'Community tax certificate', 0, 'IDs'),
(16, 'Complaint/Blotter', 'File a blotter or complaint', 0, 'Complaints and Reports'),
(17, 'Incident Report', 'Report an incident', 0, 'Complaints and Reports');

INSERT OR IGNORE INTO document_requirement (requirement_id, document_id, requirement_name, description) VALUES
(1, 1, 'Valid ID', 'Present any government-issued ID.'),
(2, 1, 'Proof of Residency', 'Document showing current address.'),
(3, 2, 'Birth Certificate', 'Provide your birth certificate.'),
(4, 2, '2x2 Photo', 'Two recent passport photos.'),
(5, 3, 'Utility Bill', 'Recent utility bill for address verification.'),
(6, 4, 'Affidavit of Indigency', 'Signed affidavit proving indigent status.'),
(7, 5, 'Business Permit Form', 'Complete business permit application form.');

INSERT OR IGNORE INTO appointment_slot (slot_id, date, time_slot, is_available) VALUES
(1, date('now','+1 day'), '09:00 AM - 10:00 AM', 1),
(2, date('now','+1 day'), '10:00 AM - 11:00 AM', 1),
(3, date('now','+2 day'), '01:00 PM - 02:00 PM', 1),
(4, date('now','+2 day'), '02:00 PM - 03:00 PM', 1);

COMMIT;

PRAGMA foreign_keys = ON;
