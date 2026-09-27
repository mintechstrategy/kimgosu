$ErrorActionPreference = 'Stop'

$deployDir = 'G:\docker\kimgosu'
$requiredPaths = @(
    (Join-Path $deployDir 'secrets\db_password.txt'),
    (Join-Path $deployDir 'secrets\jwt_secret.txt'),
    (Join-Path $deployDir 'secrets\ci_lookup_key.txt'),
    'G:\shared_storage\kimgosu\postgres',
    'G:\shared_storage\kimgosu\redis',
    'G:\shared_storage\kimgosu\uploads',
    'G:\shared_storage\kimgosu\scheduler'
)
foreach ($path in $requiredPaths) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required deployment path is missing: $path" }
}
if ($env:BACKEND_IMAGE -notmatch '^ghcr\.io/mintechstrategy/kimgosu-backend:[a-f0-9]{40}$') {
    throw 'BACKEND_IMAGE must be the published commit SHA tag.'
}
if (-not $env:GHCR_USERNAME -or -not $env:GHCR_TOKEN) { throw 'GHCR login credentials are missing.' }

$dockerConfig = Join-Path $deployDir 'docker-auth-temp'
New-Item -ItemType Directory -Force -Path $dockerConfig | Out-Null
try {
    $env:GHCR_TOKEN | docker --config $dockerConfig login ghcr.io -u $env:GHCR_USERNAME --password-stdin
    if ($LASTEXITCODE -ne 0) { throw 'GHCR login failed.' }
    docker --config $dockerConfig pull $env:BACKEND_IMAGE
    if ($LASTEXITCODE -ne 0) { throw 'Image pull failed.' }

    New-Item -ItemType Directory -Force -Path (Join-Path $deployDir 'deploy') | Out-Null
    Copy-Item -LiteralPath './docker-compose.yml' -Destination (Join-Path $deployDir 'docker-compose.yml') -Force
    Copy-Item -LiteralPath './deploy/nginx.conf' -Destination (Join-Path $deployDir 'deploy\nginx.conf') -Force
    Copy-Item -LiteralPath './DOCKER.md' -Destination (Join-Path $deployDir 'DOCKER.md') -Force

    $envPath = Join-Path $deployDir '.env'
    if (-not (Test-Path -LiteralPath $envPath)) { throw 'Deployment .env is missing.' }
    $content = @(Get-Content -LiteralPath $envPath | Where-Object { $_ -notmatch '^BACKEND_IMAGE=' })
    $content = @("BACKEND_IMAGE=$($env:BACKEND_IMAGE)") + $content
    [System.IO.File]::WriteAllLines($envPath, $content)

    Push-Location $deployDir
    try {
        docker compose config --quiet
        if ($LASTEXITCODE -ne 0) { throw 'Compose validation failed.' }
        docker compose up -d --wait db redis
        if ($LASTEXITCODE -ne 0) { throw 'Database or Redis failed.' }
        docker compose run --rm migrate
        if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }
        docker compose up -d --no-deps --wait api worker scheduler
        if ($LASTEXITCODE -ne 0) { throw 'Application containers failed.' }
        docker compose up -d --no-deps --force-recreate --wait proxy
        if ($LASTEXITCODE -ne 0) { throw 'Proxy failed.' }
        $status = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/health/ready' -TimeoutSec 15
        if ($status.status -ne 'ready') { throw 'Readiness smoke test failed.' }
        Write-Host "Deployed $($env:BACKEND_IMAGE)"
    } finally {
        Pop-Location
    }
} finally {
    docker --config $dockerConfig logout ghcr.io | Out-Null
    Remove-Item -LiteralPath $dockerConfig -Recurse -Force -ErrorAction SilentlyContinue
}
