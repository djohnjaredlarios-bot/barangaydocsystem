# Deployment to Railway

This project is prepped for deployment on Railway.app. The app supports either SQLite (local) or an external MySQL instance. For production use, provision a MySQL plugin on Railway for persistent storage.

## Quick summary

- Railway will use the `Procfile` at repo root to run the app using Gunicorn from the `backend` folder.
- For persistent data, provision a MySQL plugin and set the environment variables listed below.

## Recommended Railway setup (step-by-step)

1. Sign in to Railway (https://railway.app) and click **New Project**.
2. Choose **Deploy from GitHub repo**, select this repository, and connect your GitHub account.
3. Railway detects a Python app. After the initial deploy, open the Project Settings to configure environment variables.

### Add a MySQL database (Railway plugin)

1. In your Railway Project, click **Plugins** → **Add Plugin** → **MySQL** (or **Add a MySQL Database**).
2. Provision the MySQL plugin. Railway will create the database and show connection details.
3. Copy the connection values and add them to Railway environment variables (the names used by this app):
   - `DB_TYPE` set to `mysql`
   - `MYSQL_HOST` (plugin host)
   - `MYSQL_PORT` (plugin port, usually `3306`)
   - `MYSQL_USER` (DB user)
   - `MYSQL_PASSWORD` (DB password)
   - `MYSQL_DB` (database name)
   - `FLASK_SECRET_KEY` (set a secure random secret)

Railway sometimes exposes a single `MYSQL_URL` or `DATABASE_URL` — if so, you can still set the individual variables above using the provided connection string details. The app expects the individual `MYSQL_*` variables.

## Environment variables this app uses

- `DB_TYPE` = `mysql` or `sqlite` (default: `sqlite`)
- `MYSQL_HOST`
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DB`
- `FLASK_SECRET_KEY` (recommended)
- `PORT` (set automatically by Railway)

## What I changed in this repo for Railway readiness

- Removed local sample database files and uploaded test documents to keep the repository clean.
- Added `.gitignore` to avoid committing local `.env` files and the SQLite DB file.
- The app (`backend/app.py`) already reads DB config from environment variables and initializes schema on first run.

## Deploy notes and verification

1. After provisioning the MySQL plugin and adding the environment variables, trigger a deploy (push to repo or redeploy from Railway dashboard).
2. On first run the app will initialize the schema automatically using the `database/mysql_schema.sql` file.
3. Verify logs in Railway Dashboard → Deployments to confirm there are no DB connection errors and tables are created.

## Rollback & local testing

- For local testing, you can keep `DB_TYPE=sqlite` and use the included `database/schema.sql` locally (if needed). For production on Railway, use MySQL.

## Support

If you want, I can also:
- Update the app to prefer `DATABASE_URL` style connection strings (one env var) instead of individual `MYSQL_*` variables.
- Add a tiny Health-check route or a `railway.json` template.

