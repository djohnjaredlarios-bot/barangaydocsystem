# Deployment to Railway

This project is configured for deployment on Railway.app via GitHub.

## Prerequisites

1. A GitHub repository with this code
2. A Railway account (https://railway.app)
3. A GitHub personal access token or connection to Railway

## Deployment Steps

### Method 1: Using Railway Dashboard (Recommended for first-time setup)

1. Go to [Railway.app](https://railway.app)
2. Sign in with GitHub
3. Click "New Project" → "Deploy from GitHub repo"
4. Select this repository
5. Railway will automatically detect the Python app
6. Configure environment variables in Railway dashboard:
   - `FLASK_SECRET_KEY` - Set a secure random string
   - `DB_TYPE` - Set to 'sqlite' or 'mysql'
   - `MYSQL_*` variables (if using MySQL)
7. Click "Deploy"

### Method 2: Using GitHub Actions (Automatic)

1. In your Railway account, create a new API token:
   - Go to Settings → Tokens
   - Generate a new token
   
2. In GitHub, add the Railway token as a secret:
   - Go to your repo → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `RAILWAY_TOKEN`
   - Value: Paste your Railway API token
   - Click "Add secret"

3. Push to `main` or `master` branch
4. GitHub Actions will automatically deploy your app

## Environment Variables

Create a `.env` file based on `.env.example`:

```
FLASK_SECRET_KEY=your-secure-secret-key
DB_TYPE=sqlite
# For MySQL (optional)
# MYSQL_HOST=your-mysql-host
# MYSQL_USER=your-mysql-user
# MYSQL_PASSWORD=your-mysql-password
# MYSQL_DB=barangay_system
```

## Database

- **Default**: SQLite (database file stored in Railway's ephemeral storage)
  - Note: This will be reset on each deployment. Use MySQL for persistent data.
  
- **Recommended**: MySQL
  1. Add MySQL service in Railway dashboard
  2. Get connection details from Railway
  3. Set `DB_TYPE=mysql` and configure `MYSQL_*` variables

## Post-Deployment

After deployment:

1. Visit your Railway app URL
2. The database schema will be initialized automatically on first run
3. Monitor logs in Railway dashboard: Deployments → View Logs

## Monitoring & Logs

- View logs: Railway Dashboard → Your Project → Deployments
- View metrics: Railway Dashboard → Your Project → Metrics
- SSH into container: Railway Dashboard → Your Project → Shell

## Troubleshooting

- **Port Issues**: Railway sets `PORT` automatically - app is configured to use this
- **Database Connection**: Check `MYSQL_*` variables are set correctly
- **Static Files**: Served from `backend/static/` directory
- **Uploads**: Stored in `backend/uploads/` directory (ephemeral with SQLite)

## Additional Configuration

See `railway.json` and `Dockerfile` for Railway-specific configuration.
