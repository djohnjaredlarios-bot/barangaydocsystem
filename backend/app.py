import os
import json
import sqlite3
import uuid
from flask import Flask, render_template, request, jsonify, session, redirect, url_for, send_from_directory, g, Response, stream_with_context
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
import mimetypes
from datetime import datetime, date, timedelta

# DB type (sqlite or mysql)
DB_TYPE = os.getenv('DB_TYPE', 'sqlite').lower()

static_dir = os.path.join(os.path.dirname(__file__), 'static')
template_dir = os.path.join(os.path.dirname(__file__), 'templates')
app = Flask(__name__, static_folder=None, template_folder=template_dir)

# Serve static assets explicitly so mounted deploy platforms always resolve
# backend/static correctly, even when Flask app roots are proxied or hosted.
@app.route('/static/<path:filename>', endpoint='static')
def serve_static(filename):
    return send_from_directory(static_dir, filename)

app.secret_key = os.getenv('FLASK_SECRET_KEY', 'change-this-secret')
# Limit uploads to 10 MB
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024

# Load .env if present
backend_env = os.path.join(os.path.dirname(__file__), '.env')
workspace_env = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '.env'))
for env_path in [backend_env, workspace_env]:
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as env_file:
            for line in env_file:
                stripped = line.strip()
                if not stripped or stripped.startswith('#'):
                    continue
                if '=' in stripped:
                    key, value = stripped.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    os.environ.setdefault(key, value)

ASSET_VERSION = os.getenv('ASSET_VERSION')
# If not provided via environment, derive asset version from the
# main stylesheet mtime so deployments automatically bust caches
# when static files change.
if not ASSET_VERSION:
    try:
        css_file = os.path.join(static_dir, 'css', 'style.css')
        ASSET_VERSION = str(int(os.path.getmtime(css_file)))
    except Exception:
        ASSET_VERSION = '1'
DB_TYPE = os.getenv('DB_TYPE', 'sqlite').lower()
DATABASE_PATH = os.getenv('SQLITE_DB_PATH', os.path.join(os.path.dirname(__file__), 'barangay_system.db'))
if DB_TYPE == 'mysql':
    SCHEMA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'database', 'mysql_schema.sql'))
else:
    SCHEMA_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'database', 'schema.sql'))
DB_INITIALIZED = False
VALID_REQUEST_STATUSES = {'Pending', 'Processing', 'Approved', 'Ready', 'Rejected'}
UPLOAD_FOLDER = os.path.join(app.root_path, 'uploads', 'digital-documents')
ALLOWED_DIGITAL_EXTENSIONS = {'pdf', 'png', 'jpg', 'jpeg', 'doc', 'docx', 'txt'}


@app.context_processor
def inject_asset_version():
    return {'asset_version': ASSET_VERSION}


class CursorWrapper:
    """Wraps a DB-API cursor to translate sqlite-style '?' placeholders to
    MySQL '%s' placeholders when necessary and to expose a consistent
    interface for the app code.
    """
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql, params=None):
        if DB_TYPE == 'mysql' and params is not None:
            sql = sql.replace('?', '%s')
        return self._cur.execute(sql, params or ())

    def executemany(self, sql, seq_of_params):
        if DB_TYPE == 'mysql':
            sql = sql.replace('?', '%s')
        return self._cur.executemany(sql, seq_of_params)

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def close(self):
        try:
            return self._cur.close()
        except Exception:
            pass

    @property
    def lastrowid(self):
        return getattr(self._cur, 'lastrowid', None)

    @property
    def rowcount(self):
        return getattr(self._cur, 'rowcount', None)


def get_db():
    if 'db' not in g:
        if DB_TYPE == 'mysql':
            try:
                import pymysql
                from pymysql.cursors import DictCursor
            except Exception:
                raise RuntimeError('PyMySQL is required for MySQL support. Install pymysql.')

            host = os.getenv('MYSQL_HOST', 'localhost')
            port = int(os.getenv('MYSQL_PORT', '3306'))
            user = os.getenv('MYSQL_USER', 'root')
            password = os.getenv('MYSQL_PASSWORD', '')
            db = os.getenv('MYSQL_DB', 'barangay_system')
            conn = pymysql.connect(host=host, port=port, user=user, password=password, database=db, cursorclass=DictCursor, autocommit=False)
            # wrap cursor factory to translate parameter styles
            orig_cursor = conn.cursor
            conn.cursor = lambda *args, **kwargs: CursorWrapper(orig_cursor(*args, **kwargs))
            g.db = conn
        else:
            os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
            connection = sqlite3.connect(DATABASE_PATH, detect_types=sqlite3.PARSE_DECLTYPES)
            connection.row_factory = sqlite3.Row
            connection.execute('PRAGMA foreign_keys = ON')
            g.db = connection
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop('db', None)
    if db is not None:
        db.close()


def get_table_columns(table_name):
    cursor = get_db().cursor()
    try:
        if DB_TYPE == 'sqlite':
            cursor.execute(f'PRAGMA table_info({table_name})')
            columns = [row['name'] for row in cursor.fetchall()]
        else:
            cursor.execute(
                'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS '
                'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
                (table_name,)
            )
            columns = [row['COLUMN_NAME'] for row in cursor.fetchall()]
        return columns
    finally:
        cursor.close()


def init_db():
    global DB_INITIALIZED
    if DB_INITIALIZED:
        return
    DB_INITIALIZED = True

    # Create or ensure schema exists depending on DB_TYPE
    if DB_TYPE == 'mysql':
        try:
            import pymysql
        except Exception:
            raise RuntimeError('PyMySQL is required for MySQL support. Install pymysql.')
        host = os.getenv('MYSQL_HOST', 'localhost')
        port = int(os.getenv('MYSQL_PORT', '3306'))
        user = os.getenv('MYSQL_USER', 'root')
        password = os.getenv('MYSQL_PASSWORD', '')
        db = os.getenv('MYSQL_DB', 'barangay_system')
        conn = pymysql.connect(host=host, port=port, user=user, password=password, database=db, autocommit=False)
        try:
            with conn.cursor() as cur:
                with open(SCHEMA_PATH, 'r', encoding='utf-8') as schema_file:
                    sql = schema_file.read()
                # split statements by semicolon and execute
                for stmt in [s.strip() for s in sql.split(';') if s.strip()]:
                    cur.execute(stmt)
            conn.commit()
        finally:
            conn.close()
    else:
        if not os.path.exists(DATABASE_PATH) or os.path.getsize(DATABASE_PATH) == 0:
            os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
            with sqlite3.connect(DATABASE_PATH) as connection:
                connection.execute('PRAGMA foreign_keys = ON')
                with open(SCHEMA_PATH, 'r', encoding='utf-8') as schema_file:
                    connection.executescript(schema_file.read())

    with app.app_context():
        ensure_request_columns()
        ensure_request_status_values()
        ensure_document_columns()
        ensure_request_detail_table()
        ensure_request_attachments_table()
        ensure_requirement_is_file_column()
        ensure_event_announcement_tables()
        ensure_upload_folder()
        seed_documents()
        get_guest_user_id()
        ensure_default_accounts()
        ensure_future_appointment_slots()


def ensure_request_columns():
    existing_columns = get_table_columns('request')

    cursor = get_db().cursor()
    try:
        if 'requester_name' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN requester_name TEXT')
        if 'requester_status' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN requester_status TEXT')
        if 'requester_contact' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN requester_contact TEXT')
        if 'civil_status' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN civil_status TEXT')
        if 'age' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN age INTEGER')
        if 'claiming_method' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN claiming_method TEXT')
        if 'visitor_token' not in existing_columns:
            cursor.execute('ALTER TABLE request ADD COLUMN visitor_token TEXT')
        get_db().commit()
    finally:
        cursor.close()


def ensure_request_status_values():
    if DB_TYPE == 'mysql':
        return

    cursor = get_db().cursor()
    cursor.execute("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'request'")
    table = cursor.fetchone()
    if not table or 'Rejected' in table['sql']:
        cursor.close()
        return

    db = get_db()
    db.commit()
    db.execute('PRAGMA foreign_keys = OFF')
    try:
        cursor.execute(
            '''
            CREATE TABLE request_new (
                request_id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                document_id INTEGER NOT NULL,
                request_date DATE NOT NULL,
                delivery_method TEXT NOT NULL DEFAULT 'Physical' CHECK(delivery_method IN ('Physical', 'Digital')),
                status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending', 'Processing', 'Approved', 'Ready', 'Rejected')),
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
            )
            '''
        )
        cursor.execute(
            '''
            INSERT INTO request_new (
                request_id, user_id, document_id, request_date, delivery_method, status,
                staff_id, requester_name, requester_status, requester_contact, civil_status,
                age, claiming_method, visitor_token, created_at, updated_at
            )
            SELECT
                request_id, user_id, document_id, request_date, delivery_method, status,
                staff_id, requester_name, requester_status, requester_contact, civil_status,
                age, claiming_method, visitor_token, created_at, updated_at
            FROM request
            '''
        )
        cursor.execute('DROP TABLE request')
        cursor.execute('ALTER TABLE request_new RENAME TO request')
        cursor.execute('CREATE INDEX IF NOT EXISTS idx_request_status ON request(status)')
        db.commit()
    finally:
        db.execute('PRAGMA foreign_keys = ON')
        cursor.close()


def get_visitor_token():
    if 'visitor_token' not in session:
        session['visitor_token'] = str(uuid.uuid4())
    return session['visitor_token']


def serialize_rows(rows):
    result = []
    for row in rows:
        item = dict(row)
        for k, v in list(item.items()):
            if isinstance(v, datetime):
                item[k] = v.isoformat()
            elif isinstance(v, date):
                item[k] = v.isoformat()
        result.append(item)
    return result


def fetch_request_by_id(request_id):
    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.*, d.document_name, u.name, u.email, a.appointment_date, a.time_slot,
               dd.file_url AS digital_file_url
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        JOIN user u ON r.user_id = u.user_id
        LEFT JOIN appointment a ON a.request_id = r.request_id
        LEFT JOIN digital_document dd ON dd.digital_doc_id = (
            SELECT MAX(digital_doc_id)
            FROM digital_document
            WHERE request_id = r.request_id
        )
        WHERE r.request_id = ?
        ''',
        (request_id,)
    )
    row = cursor.fetchone()
    cursor.close()
    return dict(row) if row else None


def ensure_upload_folder():
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)


def is_allowed_digital_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_DIGITAL_EXTENSIONS


def ensure_document_columns():
    existing_columns = get_table_columns('document')
    if 'category' not in existing_columns:
        cursor = get_db().cursor()
        try:
            cursor.execute('ALTER TABLE document ADD COLUMN category TEXT')
            get_db().commit()
        finally:
            cursor.close()


def ensure_requirement_is_file_column():
    existing = get_table_columns('document_requirement')
    cursor = get_db().cursor()
    try:
        if 'is_file' not in existing:
            cursor.execute('ALTER TABLE document_requirement ADD COLUMN is_file INTEGER DEFAULT 0')
            get_db().commit()

            # Mark common requirements as file-type by default
            file_like = ['Valid ID', 'Proof of Residency', 'Birth Certificate', '2x2 Photo', 'Utility Bill', 'Affidavit of Indigency', 'Business Permit Form']
            for name in file_like:
                try:
                    cursor.execute('UPDATE document_requirement SET is_file = 1 WHERE requirement_name = ?', (name,))
                except Exception:
                    pass
            get_db().commit()
    finally:
        cursor.close()


def ensure_request_detail_table():
    cursor = get_db().cursor()
    try:
        if DB_TYPE == 'mysql':
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS request_detail (
                    detail_id INT AUTO_INCREMENT PRIMARY KEY,
                    request_id INT NOT NULL,
                    field_name TEXT NOT NULL,
                    field_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE
                )
                '''
            )
        else:
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS request_detail (
                    detail_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_id INTEGER NOT NULL,
                    field_name TEXT NOT NULL,
                    field_value TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE
                )
                '''
            )
        get_db().commit()
    finally:
        cursor.close()


def ensure_request_attachments_table():
    cursor = get_db().cursor()
    try:
        if DB_TYPE == 'mysql':
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS request_attachment (
                    attachment_id INT AUTO_INCREMENT PRIMARY KEY,
                    request_id INT NOT NULL,
                    requirement_id INT,
                    file_path TEXT,
                    file_url TEXT,
                    original_filename TEXT,
                    uploaded_by INT,
                    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (request_id) REFERENCES request(request_id) ON DELETE CASCADE,
                    FOREIGN KEY (requirement_id) REFERENCES document_requirement(requirement_id) ON DELETE SET NULL,
                    FOREIGN KEY (uploaded_by) REFERENCES user(user_id) ON DELETE SET NULL
                )
                '''
            )
        else:
            cursor.execute(
                '''
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
                )
                '''
            )
        get_db().commit()
    finally:
        cursor.close()


def ensure_event_announcement_tables():
    cursor = get_db().cursor()
    try:
        if DB_TYPE == 'mysql':
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS event (
                    event_id INT AUTO_INCREMENT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT,
                    date DATE NOT NULL,
                    time TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    location TEXT,
                    created_by INT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                '''
            )
        else:
            cursor.execute(
                '''
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
                '''
            )

        existing_columns = get_table_columns('event')
        if 'start_time' not in existing_columns:
            cursor.execute('ALTER TABLE event ADD COLUMN start_time TEXT')
        if 'end_time' not in existing_columns:
            cursor.execute('ALTER TABLE event ADD COLUMN end_time TEXT')
        if 'created_by' not in existing_columns:
            cursor.execute('ALTER TABLE event ADD COLUMN created_by INTEGER')

        if DB_TYPE == 'mysql':
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS announcement (
                    announcement_id INT AUTO_INCREMENT PRIMARY KEY,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    date DATE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
                '''
            )
        else:
            cursor.execute(
                '''
                CREATE TABLE IF NOT EXISTS announcement (
                    announcement_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    message TEXT NOT NULL,
                    date DATE NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                '''
            )
        get_db().commit()
    finally:
        cursor.close()


def seed_documents():
    docs = [
        ('Certificate of Residency', 'Proof of residency', 1, 'Certifications'),
        ('Indigency Certificate', 'Proof of indigent status', 1, 'Certifications'),
        ('Business Clearance', 'Business clearance request', 0, 'Clearances'),
        ('Barangay Clearance', 'General barangay clearance', 1, 'Clearances'),
        ('Cohabitation', 'Cohabitation certification', 1, 'Certifications'),
        ('Solo Parent', 'Solo parent certification', 1, 'Certifications'),
        ('Unemployment Certificate', 'Proof of unemployment', 1, 'Certifications'),
        ('Barangay Permit', 'Permit issued by barangay', 0, 'Permits'),
        ('Travel Permit', 'Permit for travel', 0, 'Permits'),
        ('Event Permit', 'Permit for events', 0, 'Permits'),
        ('Renovation Permit', 'Permit for renovations', 0, 'Permits'),
        ('Business Permit', 'Permit for business operations', 0, 'Permits'),
        ('Barangay ID', 'Barangay identification card', 0, 'IDs'),
        ('Senior Citizen ID', 'Senior citizen identification card', 0, 'IDs'),
        ('Cedula', 'Community tax certificate', 0, 'IDs'),
        ('Complaint/Blotter', 'File a blotter or complaint', 0, 'Complaints and Reports'),
        ('Incident Report', 'Report an incident', 0, 'Complaints and Reports')
    ]

    cursor = get_db().cursor()
    cursor.execute('SELECT document_name FROM document')
    existing_names = {row['document_name'] for row in cursor.fetchall()}

    for name, description, digital, category in docs:
        if name not in existing_names:
            cursor.execute(
                '''
                INSERT INTO document (document_name, description, is_digital_available, category)
                VALUES (?, ?, ?, ?)
                ''',
                (name, description, digital, category)
            )
    get_db().commit()


def seed_appointment_slots(days=7):
    cursor = get_db().cursor()
    today = datetime.now().date()
    time_slots = [
        '09:00 AM - 10:00 AM',
        '10:00 AM - 11:00 AM',
        '01:00 PM - 02:00 PM',
        '02:00 PM - 03:00 PM'
    ]

    for day_offset in range(1, days + 1):
        slot_date = (today + timedelta(days=day_offset)).isoformat()
        for time_slot in time_slots:
            sql = (
                'INSERT OR IGNORE INTO appointment_slot (date, time_slot, is_available) VALUES (?, ?, 1)'
                if DB_TYPE == 'sqlite'
                else 'INSERT IGNORE INTO appointment_slot (date, time_slot, is_available) VALUES (?, ?, 1)'
            )
            cursor.execute(sql, (slot_date, time_slot))
    get_db().commit()


def ensure_future_appointment_slots(days=7):
    cursor = get_db().cursor()
    DATE_NOW = "date('now')" if DB_TYPE == 'sqlite' else 'CURDATE()'
    cursor.execute(f'''
        SELECT COUNT(*) as count
        FROM appointment_slot
        WHERE is_available = 1 AND date >= {DATE_NOW}
        ''')
    count = cursor.fetchone()['count']
    if count == 0:
        seed_appointment_slots(days)


def get_guest_user_id():
    cursor = get_db().cursor()
    try:
        cursor.execute('SELECT user_id FROM user WHERE email = ?', ('guest@example.com',))
        user = cursor.fetchone()
        if user:
            return user['user_id']

        hashed_password = generate_password_hash('guest')
        # Use DB-specific upsert/ignore to avoid race conditions across processes
        try:
            if DB_TYPE == 'sqlite':
                cursor.execute(
                    '''
                    INSERT OR IGNORE INTO user (name, email, password, role, contact_number, address)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ''' ,
                    ('Guest User', 'guest@example.com', hashed_password, 'Resident', 'N/A', 'N/A')
                )
            else:
                # MySQL: INSERT IGNORE
                cursor.execute(
                    '''
                    INSERT IGNORE INTO user (name, email, password, role, contact_number, address)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    ''',
                    ('Guest User', 'guest@example.com', hashed_password, 'Resident', 'N/A', 'N/A')
                )
            get_db().commit()
        except Exception:
            try:
                get_db().rollback()
            except Exception:
                pass

        # Re-query to fetch id (works whether insert happened here or on another process)
        cursor.execute('SELECT user_id FROM user WHERE email = ?', ('guest@example.com',))
        user = cursor.fetchone()
        if user:
            return user['user_id']
        # As a fallback, raise an error
        raise RuntimeError('Unable to create or locate guest user')
    finally:
        cursor.close()


def ensure_default_accounts():
    cursor = get_db().cursor()
    default_accounts = [
        ('Admin User', 'admin@example.com', 'admin123', 'Admin', '09171234567', 'Barangay Hall'),
        ('Staff User', 'staff@example.com', 'staff123', 'Staff', '09179876543', 'Barangay Office'),
        ('Resident User', 'resident@example.com', 'resident123', 'Resident', '09171239876', '123 Barangay St.')
    ]

    for name, email, password, role, contact, address in default_accounts:
        hashed_password = generate_password_hash(password)
        cursor.execute('SELECT user_id FROM user WHERE email = ?', (email,))
        existing = cursor.fetchone()
        if existing:
            cursor.execute(
                '''
                UPDATE user
                SET name = ?, password = ?, role = ?, contact_number = ?, address = ?
                WHERE user_id = ?
                ''',
                (name, hashed_password, role, contact, address, existing['user_id'])
            )
        else:
            cursor.execute(
                '''
                INSERT INTO user (name, email, password, role, contact_number, address)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (name, email, hashed_password, role, contact, address)
            )
    get_db().commit()
    cursor.close()


# Ensure DB is initialized when running under WSGI (gunicorn, etc.)
# Register initialization to run before the app serves requests. Prefer
# `before_serving` when available (newer Flask versions), fall back to
# `before_request`, and as a last resort call `init_db()` now.
if hasattr(app, 'before_serving'):
    app.before_serving(init_db)
elif hasattr(app, 'before_request'):
    app.before_request(init_db)
else:
    init_db()


# Routes
@app.route('/')
def index():
    # Serve the homepage from Flask templates so `url_for('static', ...)`
    # is used for asset URLs (more robust in production environments).
    return render_template('homepage.html')


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        data = request.json if request.is_json else request.form
        email = data.get('email')
        password = data.get('password')

        cursor = get_db().cursor()
        cursor.execute('SELECT * FROM user WHERE email = ?', (email,))
        user = cursor.fetchone()

        if user and check_password_hash(user['password'], password):
            session['user_id'] = user['user_id']
            session['role'] = user['role']
            session['name'] = user['name']

            redirect_url = url_for('resident_dashboard')
            if user['role'] == 'Admin':
                redirect_url = url_for('admin_dashboard')
            elif user['role'] == 'Staff':
                redirect_url = url_for('staff_dashboard')

            if request.is_json:
                return jsonify({'redirect_to': redirect_url}), 200
            return redirect(redirect_url)
        else:
            return jsonify({'error': 'Invalid credentials'}), 401

    return render_template('login.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        data = request.json if request.is_json else request.form
        name = data.get('name')
        email = data.get('email')
        password = data.get('password')
        contact_number = data.get('contact_number')
        address = data.get('address')

        cursor = get_db().cursor()

        try:
            hashed_password = generate_password_hash(password)
            cursor.execute(
                '''
                INSERT INTO user (name, email, password, role, contact_number, address)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (name, email, hashed_password, 'Resident', contact_number, address)
            )
            get_db().commit()
            return jsonify({'message': 'Registration successful'}), 201
        except sqlite3.IntegrityError:
            return jsonify({'error': 'Email already exists'}), 409
        finally:
            cursor.close()

    return render_template('register.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


# Resident routes
@app.route('/resident/dashboard')
def resident_dashboard():
    if 'user_id' not in session or session.get('role') != 'Resident':
        return redirect(url_for('login'))

    user_id = session['user_id']
    cursor = get_db().cursor()

    cursor.execute(
        '''
        SELECT r.*, d.document_name
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
        ''',
        (user_id,)
    )
    requests = cursor.fetchall()
    cursor.close()
    return render_template('resident_dashboard.html', requests=requests)


@app.route('/resident/submit-request', methods=['POST'])
def submit_request():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    # Support both JSON and multipart/form-data (FormData)
    content_type = request.content_type or ''
    if 'multipart/form-data' in content_type:
        data = request.form
        uploaded_file = request.files.get('digital_document')
    else:
        data = request.json or {}
        uploaded_file = None

    user_id = session['user_id']
    document_id = data.get('document_id')
    delivery_method = data.get('delivery_method', 'Physical')

    if not document_id:
        return jsonify({'error': 'Missing document_id'}), 400

    cursor = get_db().cursor()
    try:
        cursor.execute('SELECT requirement_name FROM document_requirement WHERE document_id = ?', (document_id,))
        required_detail_names = [row['requirement_name'] for row in cursor.fetchall()]

        cursor.execute(
            '''
            INSERT INTO request (user_id, document_id, request_date, delivery_method, status)
            VALUES (?, ?, ?, ?, ?)
            ''',
            (user_id, document_id, datetime.now().date().isoformat(), delivery_method, 'Pending')
        )
        get_db().commit()
        request_id = cursor.lastrowid

        # If a digital file was included, validate and save it
        if uploaded_file and uploaded_file.filename:
            if delivery_method != 'Digital':
                # Treat file upload only for digital requests
                pass
            else:
                if not is_allowed_digital_file(uploaded_file.filename):
                    cursor.close()
                    return jsonify({'error': 'Allowed file types: PDF, PNG, JPG, DOC, DOCX.'}), 400

                ensure_upload_folder()
                original_name = secure_filename(uploaded_file.filename)
                filename = f'{request_id}_{uuid.uuid4().hex}_{original_name}'
                file_path = os.path.join(UPLOAD_FOLDER, filename)
                uploaded_file.save(file_path)
                file_url = url_for('download_digital_document', filename=filename)

                cursor.execute(
                    '''
                    INSERT INTO digital_document (request_id, file_path, file_url)
                    VALUES (?, ?, ?)
                    ''',
                    (request_id, file_path, file_url)
                )
                cursor.execute(
                    '''
                    UPDATE request
                    SET status = 'Ready', updated_at = CURRENT_TIMESTAMP
                    WHERE request_id = ?
                    ''',
                    (request_id,)
                )
                get_db().commit()

        # Save any requirement file uploads (fields named requirement_<id>)
        for field_name, file_obj in request.files.items():
            if not field_name.startswith('requirement_'):
                continue
            if not file_obj or not file_obj.filename:
                continue
            try:
                req_id_part = field_name.split('_', 1)[1]
                requirement_id = int(req_id_part)
            except Exception:
                requirement_id = None

            if not is_allowed_digital_file(file_obj.filename):
                # skip invalid file types for attachments
                continue

            ensure_upload_folder()
            orig_name = secure_filename(file_obj.filename)
            saved_name = f'{request_id}_{requirement_id or "0"}_{uuid.uuid4().hex}_{orig_name}'
            saved_path = os.path.join(UPLOAD_FOLDER, saved_name)
            file_obj.save(saved_path)
            file_url = url_for('download_digital_document', filename=saved_name)

            cursor.execute(
                '''
                INSERT INTO request_attachment (request_id, requirement_id, file_path, file_url, original_filename, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (request_id, requirement_id, saved_path, file_url, orig_name, session.get('user_id'))
            )
            get_db().commit()

        return jsonify({'message': 'Request submitted', 'request_id': request_id}), 201
    finally:
        cursor.close()


@app.route('/api/documents')
def get_documents():
    cursor = get_db().cursor()
    cursor.execute('SELECT * FROM document ORDER BY category, document_name')
    documents = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(documents))


@app.route('/api/document/<int:doc_id>/requirements')
def get_requirements(doc_id):
    cursor = get_db().cursor()
    cursor.execute('SELECT * FROM document_requirement WHERE document_id = ?', (doc_id,))
    requirements = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(requirements))


@app.route('/api/schedule/slots')
def get_available_slots():
    ensure_future_appointment_slots()
    cursor = get_db().cursor()
    DATE_NOW = "date('now')" if DB_TYPE == 'sqlite' else 'CURDATE()'
    cursor.execute(f'''
        SELECT * FROM appointment_slot
        WHERE is_available = 1 AND date >= {DATE_NOW}
        ORDER BY date, time_slot
        ''')
    slots = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(slots))


@app.route('/api/resident/requests')
def get_resident_requests():
    if 'user_id' not in session or session.get('role') != 'Resident':
        return jsonify({'error': 'Unauthorized'}), 401

    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.*, d.document_name, a.appointment_date, a.time_slot,
               dd.file_url AS digital_file_url
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        LEFT JOIN appointment a ON a.request_id = r.request_id
        LEFT JOIN digital_document dd ON dd.digital_doc_id = (
            SELECT MAX(digital_doc_id)
            FROM digital_document
            WHERE request_id = r.request_id
        )
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
        ''',
        (session['user_id'],)
    )
    requests = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(requests))


@app.route('/api/guest-requests')
def get_guest_requests():
    guest_id = get_guest_user_id()
    visitor_token = get_visitor_token()
    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.*, d.document_name, a.appointment_date, a.time_slot,
               dd.file_url AS digital_file_url
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        LEFT JOIN appointment a ON a.request_id = r.request_id
        LEFT JOIN digital_document dd ON dd.digital_doc_id = (
            SELECT MAX(digital_doc_id)
            FROM digital_document
            WHERE request_id = r.request_id
        )
        WHERE r.user_id = ? AND r.visitor_token = ?
        ORDER BY r.created_at DESC
        ''',
        (guest_id, visitor_token)
    )
    requests = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(requests))


@app.route('/api/events')
def get_events():
    cursor = get_db().cursor()
    DATE_NOW = "date('now')" if DB_TYPE == 'sqlite' else 'CURDATE()'
    cursor.execute(f'''
        SELECT event_id, title, description, date, time, start_time, end_time, location, created_by
        FROM event
        WHERE date >= {DATE_NOW}
        ORDER BY date, start_time, end_time
        ''')
    events = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(events))


@app.route('/api/events', methods=['POST'])
@app.route('/api/staff/events', methods=['POST'])
def create_event():
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    app.logger.info('create_event payload: %s', data)
    title = data.get('title')
    description = data.get('description')
    date_value = data.get('date')
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    time_value = data.get('time')
    location = data.get('location')

    if not title or not date_value:
        return jsonify({'error': 'Event title and date are required.'}), 400

    if not time_value and start_time and end_time:
        time_value = f"{start_time} - {end_time}"
    elif start_time and not end_time:
        time_value = start_time

    cursor = get_db().cursor()
    try:
        cursor.execute(
            '''
            INSERT INTO event (title, description, date, time, start_time, end_time, location, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (title, description, date_value, time_value, start_time, end_time, location, session['user_id'])
        )
        get_db().commit()

        event_id = cursor.lastrowid
        cursor.execute(
            '''
            SELECT event_id, title, description, date, time, start_time, end_time, location, created_by
            FROM event
            WHERE event_id = ?
            ''',
            (event_id,)
        )
        return jsonify({'message': 'Event created successfully.', 'event': dict(cursor.fetchone())}), 201
    finally:
        cursor.close()


@app.route('/dev/create-event', methods=['POST'])
def dev_create_event():
    """Development helper: create an event without authentication (debug only)."""
    if not app.debug:
        return jsonify({'error': 'Not available'}), 404
    data = request.json or {}
    title = data.get('title', 'Dev Event')
    description = data.get('description', '')
    date_value = data.get('date', datetime.utcnow().date().isoformat())
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    time_value = data.get('time')
    location = data.get('location')

    cursor = get_db().cursor()
    try:
        cursor.execute(
            '''
            INSERT INTO event (title, description, date, time, start_time, end_time, location, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (title, description, date_value, time_value, start_time, end_time, location, None)
        )
        get_db().commit()
        event_id = cursor.lastrowid
        cursor.execute(
            '''
            SELECT event_id, title, description, date, time, start_time, end_time, location, created_by
            FROM event
            WHERE event_id = ?
            ''',
            (event_id,)
        )
        row = cursor.fetchone()
        # use serialize_rows to normalize date types
        event_obj = serialize_rows([row])[0] if row else None
        return jsonify({'message': 'Dev event created.', 'event': event_obj}), 201
    finally:
        cursor.close()


@app.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json or {}
    title = data.get('title')
    description = data.get('description')
    date_value = data.get('date')
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    time_value = data.get('time')
    location = data.get('location')

    if not title or not date_value:
        return jsonify({'error': 'Event title and date are required.'}), 400

    cursor = get_db().cursor()
    try:
        # Build fallback time string from start/end if time not provided
        if not time_value and start_time and end_time:
            time_value = f"{start_time} - {end_time}"
        elif start_time and not end_time:
            time_value = start_time

        cursor.execute(
            '''
            UPDATE event
            SET title = ?, description = ?, date = ?, time = ?, start_time = ?, end_time = ?, location = ?
            WHERE event_id = ?
            ''',
            (title, description, date_value, time_value, start_time, end_time, location, event_id)
        )
        if cursor.rowcount == 0:
            return jsonify({'error': 'Event not found.'}), 404

        get_db().commit()
        cursor.execute(
            '''
            SELECT event_id, title, description, date, time, start_time, end_time, location, created_by
            FROM event
            WHERE event_id = ?
            ''',
            (event_id,)
        )
        return jsonify({'message': 'Event updated successfully.', 'event': dict(cursor.fetchone())}), 200
    finally:
        cursor.close()


@app.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    cursor = get_db().cursor()
    try:
        cursor.execute('DELETE FROM event WHERE event_id = ?', (event_id,))
        if cursor.rowcount == 0:
            return jsonify({'error': 'Event not found.'}), 404
        get_db().commit()
        return jsonify({'message': 'Event deleted successfully.'}), 200
    finally:
        cursor.close()


@app.route('/api/announcements')
def get_announcements():
    cursor = get_db().cursor()
    DATE_NOW = "date('now')" if DB_TYPE == 'sqlite' else 'CURDATE()'
    cursor.execute(f'''
        SELECT announcement_id, title, message, date
        FROM announcement
        WHERE date >= {DATE_NOW}
        ORDER BY date
        ''')
    announcements = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(announcements))


@app.route('/debug/status')
def debug_status():
    """Debug endpoint that reports DB and table status. Access is intentionally
    unprotected in this repo for quick diagnosis; remove or protect in prod.
    """
    info = {}
    try:
        info['database_type'] = DB_TYPE
        if DB_TYPE == 'mysql':
            info['database_path'] = None
            info['database_exists'] = True
            info['database_size_bytes'] = None
            cursor = get_db().cursor()
            try:
                cursor.execute(
                    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()'
                )
                table_rows = cursor.fetchall()
                table_names = [r['TABLE_NAME'] for r in table_rows]
                info['tables'] = table_names
            except Exception as e:
                info['tables_error'] = str(e)
                table_names = []

            counts = {}
            for t in table_names:
                try:
                    cursor.execute(f"SELECT COUNT(*) AS cnt FROM `{t}`")
                    counts[t] = cursor.fetchone()['cnt']
                except Exception as e:
                    counts[t] = {'error': str(e)}
            info['counts'] = counts

            # sample recent rows if those tables exist
            def safe_fetch(sql):
                try:
                    cursor.execute(sql)
                    return serialize_rows(cursor.fetchall())
                except Exception:
                    return []

            if 'event' in table_names:
                info['recent_events'] = safe_fetch("SELECT event_id, title, date FROM event ORDER BY date DESC LIMIT 5")
            else:
                info['recent_events'] = []

            if 'request' in table_names:
                info['recent_requests'] = safe_fetch("SELECT request_id, request_date, status FROM request ORDER BY created_at DESC LIMIT 5")
            else:
                info['recent_requests'] = []

            cursor.close()
        else:
            info['database_path'] = DATABASE_PATH
            info['database_exists'] = os.path.exists(DATABASE_PATH)
            try:
                info['database_size_bytes'] = os.path.getsize(DATABASE_PATH) if info['database_exists'] else 0
            except Exception:
                info['database_size_bytes'] = None

            if info['database_exists']:
                cursor = get_db().cursor()
                # list tables from sqlite_master
                try:
                    cursor.execute("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index') ORDER BY type, name")
                    objs = cursor.fetchall()
                    info['sqlite_objects'] = [{'name': r['name'], 'type': r['type'], 'sql': r['sql']} for r in objs]
                except Exception as e:
                    info['sqlite_objects_error'] = str(e)

                # counts for any present tables
                try:
                    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
                    table_rows = cursor.fetchall()
                    table_names = [r['name'] for r in table_rows]
                    info['tables'] = table_names
                except Exception as e:
                    info['tables_error'] = str(e)
                    table_names = []

                counts = {}
                for t in table_names:
                    try:
                        cursor.execute(f"SELECT COUNT(*) as cnt FROM {t}")
                        counts[t] = cursor.fetchone()['cnt']
                    except Exception as e:
                        counts[t] = {'error': str(e)}
                info['counts'] = counts

                # run integrity check
                try:
                    cursor.execute("PRAGMA integrity_check")
                    info['integrity_check'] = [r[0] for r in cursor.fetchall()]
                except Exception as e:
                    info['integrity_check_error'] = str(e)

                # sample recent rows if those tables exist
                def safe_fetch(sql):
                    try:
                        cursor.execute(sql)
                        return serialize_rows(cursor.fetchall())
                    except Exception:
                        return []

                if 'event' in table_names:
                    info['recent_events'] = safe_fetch("SELECT event_id, title, date FROM event ORDER BY date DESC LIMIT 5")
                else:
                    info['recent_events'] = []

                if 'request' in table_names:
                    info['recent_requests'] = safe_fetch("SELECT request_id, request_date, status FROM request ORDER BY created_at DESC LIMIT 5")
                else:
                    info['recent_requests'] = []

                cursor.close()
            else:
                info['message'] = 'Database file does not exist on disk.'
    except Exception as e:
        info['error'] = str(e)

    return jsonify(info)


@app.route('/api/staff/announcements', methods=['POST'])
def create_staff_announcement():
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    title = data.get('title')
    message = data.get('message')
    date_value = data.get('date')

    if not title or not message or not date_value:
        return jsonify({'error': 'Announcement title, message, and date are required.'}), 400

    cursor = get_db().cursor()
    try:
        cursor.execute(
            '''
            INSERT INTO announcement (title, message, date)
            VALUES (?, ?, ?)
            ''',
            (title, message, date_value)
        )
        get_db().commit()
        announcement_id = cursor.lastrowid
        cursor.execute(
            '''
            SELECT announcement_id, title, message, date
            FROM announcement
            WHERE announcement_id = ?
            ''',
            (announcement_id,)
        )
        return jsonify({'message': 'Announcement created successfully.', 'announcement': dict(cursor.fetchone())}), 201
    finally:
        cursor.close()


@app.route('/submit-request', methods=['POST'])
def submit_request_guest():
    content_type = request.content_type or ''
    if 'multipart/form-data' in content_type:
        data = request.form
        try:
            details = json.loads(data.get('details') or '{}')
        except ValueError:
            details = {}
        uploaded_files = request.files
    else:
        data = request.json or {}
        details = data.get('details') or {}
        uploaded_files = {}

    document_id = data.get('document_id')
    requester_name = data.get('requester_name')
    requester_status = data.get('requester_status', 'N/A')
    requester_contact = data.get('requester_contact')
    civil_status = data.get('civil_status')
    age = data.get('age')
    claiming_method = data.get('claiming_method')
    slot_id = data.get('slot_id')
    delivery_method = 'Digital' if claiming_method == 'Digital' else 'Physical'

    if not document_id or not requester_name or not requester_contact or not civil_status or not age or not claiming_method:
        return jsonify({'error': 'Missing required fields'}), 400

    if delivery_method == 'Physical' and not slot_id:
        return jsonify({'error': 'Please choose a pickup schedule slot for physical requests.'}), 400

    user_id = get_guest_user_id()
    visitor_token = get_visitor_token()
    cursor = get_db().cursor()

    try:
        cursor.execute('SELECT requirement_id, requirement_name, is_file FROM document_requirement WHERE document_id = ?', (document_id,))
        requirements = cursor.fetchall()

        missing_requirements = []
        for requirement in requirements:
            if requirement['is_file']:
                input_name = f'requirement_{requirement["requirement_id"]}'
                file_obj = uploaded_files.get(input_name)
                if not file_obj or not file_obj.filename:
                    missing_requirements.append(requirement['requirement_name'])
            else:
                if not str(details.get(requirement['requirement_name'], '')).strip():
                    missing_requirements.append(requirement['requirement_name'])

        if missing_requirements:
            return jsonify({'error': 'Please complete all document-specific requirements: ' + ', '.join(missing_requirements)}), 400

        for field_name, file_obj in uploaded_files.items():
            if not field_name.startswith('requirement_'):
                continue
            if not file_obj or not file_obj.filename:
                continue
            if not is_allowed_digital_file(file_obj.filename):
                return jsonify({'error': 'Allowed file types: PDF, PNG, JPG, DOC, DOCX.'}), 400

        cursor.execute(
            '''
            INSERT INTO request (user_id, document_id, request_date, delivery_method, status, staff_id, requester_name, requester_status, requester_contact, civil_status, age, claiming_method, visitor_token)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''',
            (
                user_id,
                document_id,
                datetime.now().date().isoformat(),
                delivery_method,
                'Pending',
                None,
                requester_name,
                requester_status,
                requester_contact,
                civil_status,
                age,
                claiming_method,
                visitor_token
            )
        )
        request_id = cursor.lastrowid

        for field_name, field_value in details.items():
            cleaned_value = str(field_value).strip()
            if cleaned_value:
                cursor.execute(
                    '''
                    INSERT INTO request_detail (request_id, field_name, field_value)
                    VALUES (?, ?, ?)
                    ''',
                    (request_id, field_name, cleaned_value)
                )

        for field_name, file_obj in uploaded_files.items():
            if not field_name.startswith('requirement_'):
                continue
            if not file_obj or not file_obj.filename:
                continue

            try:
                requirement_id = int(field_name.split('_', 1)[1])
            except ValueError:
                requirement_id = None

            if not is_allowed_digital_file(file_obj.filename):
                cursor.close()
                return jsonify({'error': 'Allowed file types: PDF, PNG, JPG, DOC, DOCX.'}), 400

            ensure_upload_folder()
            orig_name = secure_filename(file_obj.filename)
            saved_name = f'{request_id}_{requirement_id or 0}_{uuid.uuid4().hex}_{orig_name}'
            saved_path = os.path.join(UPLOAD_FOLDER, saved_name)
            file_obj.save(saved_path)
            file_url = url_for('download_digital_document', filename=saved_name)

            cursor.execute(
                '''
                INSERT INTO request_attachment (request_id, requirement_id, file_path, file_url, original_filename, uploaded_by)
                VALUES (?, ?, ?, ?, ?, ?)
                ''',
                (request_id, requirement_id, saved_path, file_url, orig_name, user_id)
            )

        if slot_id:
            cursor.execute('SELECT * FROM appointment_slot WHERE slot_id = ? AND is_available = 1', (slot_id,))
            slot = cursor.fetchone()
            if not slot:
                cursor.close()
                return jsonify({'error': 'Selected schedule slot is unavailable.'}), 400

            cursor.execute(
                '''
                INSERT INTO appointment (request_id, appointment_date, time_slot, status)
                VALUES (?, ?, ?, ?)
                ''',
                (request_id, slot['date'], slot['time_slot'], 'Scheduled')
            )
            cursor.execute('UPDATE appointment_slot SET is_available = 0 WHERE slot_id = ?', (slot_id,))

        get_db().commit()
        return jsonify({'message': 'Request submitted', 'request_id': request_id}), 201
    finally:
        cursor.close()


@app.route('/book-appointment', methods=['POST'])
def book_appointment_guest():
    data = request.json
    request_id = data.get('request_id')
    slot_id = data.get('slot_id')

    if not request_id or not slot_id:
        return jsonify({'error': 'Missing required fields'}), 400

    cursor = get_db().cursor()
    cursor.execute('SELECT * FROM appointment_slot WHERE slot_id = ?', (slot_id,))
    slot = cursor.fetchone()

    if not slot or not slot['is_available']:
        cursor.close()
        return jsonify({'error': 'Slot not available'}), 400

    cursor.execute('SELECT * FROM request WHERE request_id = ?', (request_id,))
    if not cursor.fetchone():
        cursor.close()
        return jsonify({'error': 'Request not found'}), 404

    try:
        cursor.execute(
            '''
            INSERT INTO appointment (request_id, appointment_date, time_slot, status)
            VALUES (?, ?, ?, ?)
            ''',
            (request_id, slot['date'], slot['time_slot'], 'Scheduled')
        )
        cursor.execute('UPDATE appointment_slot SET is_available = 0 WHERE slot_id = ?', (slot_id,))
        get_db().commit()
        return jsonify({'message': 'Appointment booked successfully'}), 201
    finally:
        cursor.close()


@app.route('/resident/book-appointment', methods=['POST'])
def book_appointment():
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    request_id = data.get('request_id')
    slot_id = data.get('slot_id')

    cursor = get_db().cursor()
    cursor.execute('SELECT * FROM appointment_slot WHERE slot_id = ?', (slot_id,))
    slot = cursor.fetchone()

    if not slot or not slot['is_available']:
        return jsonify({'error': 'Slot not available'}), 400

    try:
        cursor.execute(
            '''
            INSERT INTO appointment (request_id, appointment_date, time_slot, status)
            VALUES (?, ?, ?, ?)
            ''',
            (request_id, slot['date'], slot['time_slot'], 'Scheduled')
        )
        cursor.execute('UPDATE appointment_slot SET is_available = 0 WHERE slot_id = ?', (slot_id,))
        get_db().commit()
        return jsonify({'message': 'Appointment booked successfully'}), 201
    finally:
        cursor.close()


# Staff routes
@app.route('/staff/dashboard')
def staff_dashboard():
    if 'user_id' not in session or session.get('role') != 'Staff':
        return render_template('login.html', staff_login=True)

    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.*, d.document_name, u.name, u.email, a.appointment_date, a.time_slot,
               dd.file_url AS digital_file_url,
               CASE WHEN r.delivery_method = 'Digital' AND dd.file_url IS NULL THEN 1 ELSE 0 END AS requires_upload,
               (SELECT COUNT(*) FROM request_attachment ra WHERE ra.request_id = r.request_id) AS attachment_count
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        JOIN user u ON r.user_id = u.user_id
        LEFT JOIN appointment a ON a.request_id = r.request_id
        LEFT JOIN digital_document dd ON dd.digital_doc_id = (
            SELECT MAX(digital_doc_id)
            FROM digital_document
            WHERE request_id = r.request_id
        )
        WHERE r.status != 'Ready'
        ORDER BY r.created_at
        '''
    )
    requests = cursor.fetchall()
    cursor.close()
    return render_template('staff_dashboard.html', requests=requests)


@app.route('/api/staff/requests')
def get_staff_requests():
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.*, d.document_name, u.name, u.email, a.appointment_date, a.time_slot,
               dd.file_url AS digital_file_url,
               CASE WHEN r.delivery_method = 'Digital' AND dd.file_url IS NULL THEN 1 ELSE 0 END AS requires_upload,
               (SELECT COUNT(*) FROM request_attachment ra WHERE ra.request_id = r.request_id) AS attachment_count
        FROM request r
        JOIN document d ON r.document_id = d.document_id
        JOIN user u ON r.user_id = u.user_id
        LEFT JOIN appointment a ON a.request_id = r.request_id
        LEFT JOIN digital_document dd ON dd.digital_doc_id = (
            SELECT MAX(digital_doc_id)
            FROM digital_document
            WHERE request_id = r.request_id
        )
        WHERE r.status != 'Ready'
        ORDER BY r.created_at
        '''
    )
    requests = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(requests))


@app.route('/api/staff/pickup-appointments')
def get_staff_pickup_appointments():
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT a.appointment_id, a.request_id, a.appointment_date, a.time_slot, a.status AS appointment_status,
               r.delivery_method, r.status AS request_status, r.claiming_method,
               d.document_name, u.name AS resident_name
        FROM appointment a
        JOIN request r ON a.request_id = r.request_id
        JOIN document d ON r.document_id = d.document_id
        JOIN user u ON r.user_id = u.user_id
        WHERE r.delivery_method = 'Physical' AND r.claiming_method = 'In-Person Pick up'
        ORDER BY a.appointment_date, a.time_slot
        '''
    )
    pickups = cursor.fetchall()
    cursor.close()
    return jsonify(serialize_rows(pickups))


@app.route('/api/requests/<int:req_id>/files')
def get_request_files(req_id):
    cursor = get_db().cursor()
    cursor.execute('SELECT * FROM request WHERE request_id = ?', (req_id,))
    req = cursor.fetchone()
    if not req:
        cursor.close()
        return jsonify({'error': 'Request not found'}), 404

    is_staff = session.get('role') == 'Staff'
    is_owner = session.get('user_id') == req['user_id']
    is_guest_owner = req['visitor_token'] and session.get('visitor_token') == req['visitor_token']
    if not (is_staff or is_owner or is_guest_owner):
        cursor.close()
        return jsonify({'error': 'Unauthorized'}), 401

    cursor.execute('SELECT digital_doc_id, file_url, file_path, created_at FROM digital_document WHERE request_id = ?', (req_id,))
    digital_docs = [dict(row) for row in cursor.fetchall()]
    cursor.execute('SELECT attachment_id, requirement_id, file_url, file_path, original_filename, uploaded_by, upload_date FROM request_attachment WHERE request_id = ?', (req_id,))
    attachments = [dict(row) for row in cursor.fetchall()]
    cursor.close()
    return jsonify({'digital_documents': digital_docs, 'attachments': attachments})


@app.route('/api/staff/requests/<int:req_id>/digital-document', methods=['POST'])
def upload_digital_document(req_id):
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    uploaded_file = request.files.get('digital_document')
    if not uploaded_file or not uploaded_file.filename:
        return jsonify({'error': 'Please choose a file to upload.'}), 400

    if not is_allowed_digital_file(uploaded_file.filename):
        return jsonify({'error': 'Allowed file types: PDF, PNG, JPG, DOC, DOCX.'}), 400

    cursor = get_db().cursor()
    cursor.execute('SELECT request_id, delivery_method, user_id, staff_id FROM request WHERE request_id = ?', (req_id,))
    request_row = cursor.fetchone()
    if not request_row:
        cursor.close()
        return jsonify({'error': 'Request not found'}), 404
    if request_row['delivery_method'] != 'Digital':
        cursor.close()
        return jsonify({'error': 'Digital document uploads are only for digital requests.'}), 400

    is_staff = session.get('role') == 'Staff' and 'user_id' in session
    is_owner = session.get('user_id') == request_row['user_id']
    if not (is_staff or is_owner):
        cursor.close()
        return jsonify({'error': 'Unauthorized'}), 401

    ensure_upload_folder()
    original_name = secure_filename(uploaded_file.filename)
    filename = f'{req_id}_{uuid.uuid4().hex}_{original_name}'
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    uploaded_file.save(file_path)
    file_url = url_for('download_digital_document', filename=filename)

    try:
        cursor.execute(
            '''
            INSERT INTO digital_document (request_id, file_path, file_url)
            VALUES (?, ?, ?)
            ''',
            (req_id, file_path, file_url)
        )
        cursor.execute(
            '''
            UPDATE request
            SET status = 'Ready', staff_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
            ''',
            (session['user_id'] if is_staff else request_row['staff_id'], req_id)
        )
        get_db().commit()
        return jsonify({
            'message': 'Digital document uploaded.',
            'request': fetch_request_by_id(req_id)
        }), 201
    finally:
        cursor.close()


@app.route('/api/requests/<int:req_id>/digital-document', methods=['POST'])
def upload_resident_digital_document(req_id):
    if 'user_id' not in session:
        return jsonify({'error': 'Unauthorized'}), 401

    uploaded_file = request.files.get('digital_document')
    if not uploaded_file or not uploaded_file.filename:
        return jsonify({'error': 'Please choose a file to upload.'}), 400

    if not is_allowed_digital_file(uploaded_file.filename):
        return jsonify({'error': 'Allowed file types: PDF, PNG, JPG, DOC, DOCX.'}), 400

    cursor = get_db().cursor()
    cursor.execute('SELECT request_id, delivery_method, user_id, staff_id FROM request WHERE request_id = ?', (req_id,))
    request_row = cursor.fetchone()
    if not request_row:
        cursor.close()
        return jsonify({'error': 'Request not found'}), 404
    if request_row['delivery_method'] != 'Digital':
        cursor.close()
        return jsonify({'error': 'Digital document uploads are only for digital requests.'}), 400

    is_staff = session.get('role') == 'Staff' and 'user_id' in session
    is_owner = session.get('user_id') == request_row['user_id']
    if not (is_staff or is_owner):
        cursor.close()
        return jsonify({'error': 'Unauthorized'}), 401

    ensure_upload_folder()
    original_name = secure_filename(uploaded_file.filename)
    filename = f'{req_id}_{uuid.uuid4().hex}_{original_name}'
    file_path = os.path.join(UPLOAD_FOLDER, filename)
    uploaded_file.save(file_path)
    file_url = url_for('download_digital_document', filename=filename)

    try:
        cursor.execute(
            '''
            INSERT INTO digital_document (request_id, file_path, file_url)
            VALUES (?, ?, ?)
            ''',
            (req_id, file_path, file_url)
        )
        cursor.execute(
            '''
            UPDATE request
            SET status = 'Ready', staff_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
            ''',
            (session['user_id'] if is_staff else request_row['staff_id'], req_id)
        )
        get_db().commit()
        return jsonify({
            'message': 'Digital document uploaded.',
            'request': fetch_request_by_id(req_id)
        }), 201
    finally:
        cursor.close()


@app.route('/uploads/digital-documents/<path:filename>')
def download_digital_document(filename):
    file_url = url_for('download_digital_document', filename=filename)
    cursor = get_db().cursor()
    cursor.execute(
        '''
        SELECT r.user_id, r.visitor_token
        FROM request r
        WHERE r.request_id IN (
            SELECT request_id FROM digital_document WHERE file_url = ?
            UNION
            SELECT request_id FROM request_attachment WHERE file_url = ?
        )
        ''',
        (file_url, file_url)
    )
    document = cursor.fetchone()
    cursor.close()

    if not document:
        return jsonify({'error': 'File not found'}), 404

    is_staff = session.get('role') == 'Staff'
    is_owner = session.get('user_id') == document['user_id']
    is_guest_owner = document['visitor_token'] and session.get('visitor_token') == document['visitor_token']
    if not (is_staff or is_owner or is_guest_owner):
        return jsonify({'error': 'Unauthorized'}), 401

    # Stream the file manually to avoid gunicorn/sendfile issues on non-blocking sockets
    full_path = os.path.join(UPLOAD_FOLDER, filename)
    if not os.path.exists(full_path):
        return jsonify({'error': 'File not found'}), 404

    mime_type, _ = mimetypes.guess_type(full_path)
    if not mime_type:
        mime_type = 'application/octet-stream'

    def generate():
        with open(full_path, 'rb') as fh:
            while True:
                chunk = fh.read(8192)
                if not chunk:
                    break
                yield chunk

    headers = {
        'Content-Disposition': f'attachment; filename="{os.path.basename(full_path)}"'
    }
    return Response(stream_with_context(generate()), mimetype=mime_type, headers=headers)


@app.route('/staff/process-request/<int:req_id>', methods=['POST'])
def process_request(req_id):
    if 'user_id' not in session or session.get('role') != 'Staff':
        return jsonify({'error': 'Unauthorized'}), 401

    data = request.json
    status = data.get('status')

    if status not in VALID_REQUEST_STATUSES:
        return jsonify({'error': 'Invalid request status'}), 400

    cursor = get_db().cursor()
    try:
        cursor.execute('SELECT delivery_method FROM request WHERE request_id = ?', (req_id,))
        req_row = cursor.fetchone()
        if not req_row:
            return jsonify({'error': 'Request not found'}), 404

        if req_row['delivery_method'] == 'Digital' and status in ('Processing', 'Approved', 'Ready'):
            cursor.execute('SELECT 1 FROM digital_document WHERE request_id = ? LIMIT 1', (req_id,))
            if cursor.fetchone() is None:
                return jsonify({'error': 'Please upload the digital document before processing a digital request.'}), 400

        cursor.execute(
            '''
            UPDATE request
            SET status = ?, staff_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE request_id = ?
            ''',
            (status, session['user_id'], req_id)
        )
        if cursor.rowcount == 0:
            return jsonify({'error': 'Request not found'}), 404
        get_db().commit()
        return jsonify({'message': 'Request updated', 'request': fetch_request_by_id(req_id)}), 200
    finally:
        cursor.close()


# Admin routes
@app.route('/admin/dashboard')
def admin_dashboard():
    if 'user_id' not in session or session.get('role') != 'Admin':
        return redirect(url_for('login'))

    cursor = get_db().cursor()
    cursor.execute('SELECT COUNT(*) as total_users FROM user WHERE role = ?', ('Resident',))
    total_residents = cursor.fetchone()['total_users']
    cursor.execute('SELECT COUNT(*) as total_requests FROM request')
    total_requests = cursor.fetchone()['total_requests']
    cursor.execute('SELECT COUNT(*) as pending FROM request WHERE status = ?', ('Pending',))
    pending = cursor.fetchone()['pending']
    cursor.close()

    metrics = {
        'total_residents': total_residents,
        'total_requests': total_requests,
        'pending_requests': pending
    }

    return render_template('admin_dashboard.html', metrics=metrics)


@app.route('/api/admin/metrics')
def get_metrics():
    cursor = get_db().cursor()
    cursor.execute('SELECT COUNT(*) as total FROM user WHERE role = ?', ('Resident',))
    residents = cursor.fetchone()['total']
    cursor.execute('SELECT COUNT(*) as total FROM request')
    requests = cursor.fetchone()['total']
    cursor.execute('SELECT COUNT(*) as total FROM request WHERE status = ?', ('Pending',))
    pending = cursor.fetchone()['total']
    cursor.close()

    return jsonify({
        'total_residents': residents,
        'total_requests': requests,
        'pending_requests': pending
    })


if __name__ == '__main__':
    init_db()
    port = int(os.getenv('PORT', 5000))
    app.run(debug=False, host='0.0.0.0', port=port)
