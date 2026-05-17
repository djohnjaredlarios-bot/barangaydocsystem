$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (Test-Path $venvPython) {
    & $venvPython "$PSScriptRoot\app.py"
} else {
    Write-Host 'Virtual environment not found. Please create and activate .venv first.' -ForegroundColor Yellow
    python "$PSScriptRoot\app.py"
}
