# Barangay Local Dashboard and Document Request System

A Flask-based web application for barangay residents to submit document requests, book appointments, and allow staff/admin to manage requests.

## Project Structure

- `backend/` - Flask application, templates, static assets.
- `database/schema.sql` - SQLite schema and seed data.
- `backend/requirements.txt` - Python dependencies.

## Setup

1. Create and activate a Python virtual environment in the project root.

   ```powershell
   cd c:\Users\MSI\Documents\SOFTDES
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```

2. Install dependencies using the activated virtual environment.

   ```powershell
   cd backend
   pip install -r requirements.txt
   ```

3. Configure optional database settings using environment variables.

   In PowerShell:
   ```powershell
   $env:SQLITE_DB_PATH = 'c:\Users\MSI\Documents\SOFTDES\backend\barangay_system.db'
   $env:FLASK_SECRET_KEY = 'change_this_secret'
   ```

   Alternatively, create `backend\.env` and add the same values there.

   If no `SQLITE_DB_PATH` is provided, the app uses `backend/barangay_system.db` by default.

   You can validate the database connection before starting the app:
   ```powershell
   cd backend
   ..\.venv\Scripts\python.exe db_check.py
   ```

4. Create or initialize the SQLite database.

   The app automatically creates and initializes the SQLite database file from `database/schema.sql` when it first starts if the database file does not already exist.

5. Start the app using the virtual environment interpreter.

   ```powershell
   cd backend
   ..\.venv\Scripts\python.exe app.py
   ```

   Or run the helper script:
   ```powershell
   .\run.ps1
   ```

6. Open your browser to `http://127.0.0.1:5000`.

## Sample Accounts

- Admin: `admin@example.com` / `admin123`
- Staff: `staff@example.com` / `staff123`
- Resident: `resident@example.com` / `resident123`

## Notes

- The app uses Flask templates under `backend/templates` and static assets under `backend/static`.
- The user registration flow creates residents by default. Use the sample accounts above to test Staff and Admin features.
- If you prefer SQLite or a different database adapter, you can convert the app to SQLAlchemy.

## Deployment on Railway

This project is now ready for Railway deployment with the following files added:

- `Procfile`
- `runtime.txt`
- `requirements.txt`
- `backend/requirements.txt`

### Deploy steps

1. Create a Git repository for this project and push it to GitHub, GitLab, or another Git host.
2. Sign in to Railway and connect the repository.
3. Set Railway environment variables:
   - `FLASK_SECRET_KEY`
   - `SQLITE_DB_PATH=/app/backend/barangay_system.db`
4. Deploy the app.

### Notes

- This app uses SQLite and local uploads, which work for a demo.
- For production, consider switching to a managed database and cloud file storage.
