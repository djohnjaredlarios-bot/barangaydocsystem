import os
import sqlite3


def load_env_file():
    env_paths = [
        os.path.join(os.path.dirname(__file__), '.env'),
        os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '.env'))
    ]
    for env_path in env_paths:
        if not os.path.exists(env_path):
            continue
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


def main():
    load_env_file()
    db_path = os.getenv('SQLITE_DB_PATH', os.path.join(os.path.dirname(__file__), 'barangay_system.db'))

    print(f'Connecting to SQLite at {db_path}...')
    try:
        connection = sqlite3.connect(db_path)
        connection.execute('PRAGMA foreign_keys = ON')
        cursor = connection.cursor()
        cursor.execute('SELECT 1 AS ok')
        result = cursor.fetchone()
        print('Connection successful:', result)
    except Exception as exc:
        print('Database connection failed:')
        print(exc)
    finally:
        try:
            connection.close()
        except Exception:
            pass


if __name__ == '__main__':
    main()
