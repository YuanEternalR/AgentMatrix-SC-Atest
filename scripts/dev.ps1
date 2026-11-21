param(
    [Parameter(Position = 0)][string]$Command = 'help',
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$Distro = 'Ubuntu-AgentMatrix'
$RepoRoot = (Split-Path $PSScriptRoot -Parent).TrimEnd('\')

# Windows 路径 -> WSL 路径。不用 wslpath：反斜杠会被 bash 当转义符吃掉。
function ConvertTo-WslPath([string]$WinPath) {
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') {
        return "/mnt/$($Matches[1].ToLower())$($Matches[2])"
    }
    return $p
}

$WslRoot = ConvertTo-WslPath $RepoRoot
$ProjectDir = "$WslRoot/infra"
$PidFile = Join-Path $RepoRoot '.dev-keepalive.pid'

function Invoke-Wsl([string]$BashCommand) {
    & wsl -d $Distro -u root -- bash -lc "cd '$ProjectDir' && $BashCommand"
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# --- 常驻会话 -----------------------------------------------------------
# WSL 在最后一个会话退出时会清理发行版内进程，dockerd 因此被杀并由 systemd 重启，
# 容器跟着重启。保留一个隐藏会话即可让守护进程与容器稳定运行。

function Get-KeepAlivePid {
    if (-not (Test-Path $PidFile)) { return $null }
    $raw = (Get-Content $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    $procId = 0
    if (-not [int]::TryParse($raw, [ref]$procId)) { return $null }
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) { return $procId }
    return $null
}

function Start-KeepAlive {
    if (Get-KeepAlivePid) {
        Write-Host '常驻会话已在运行' -ForegroundColor Yellow
        return
    }
    $proc = Start-Process -FilePath 'wsl.exe' `
        -ArgumentList @('-d', $Distro, '-u', 'root', '--', 'sleep', 'infinity') `
        -WindowStyle Hidden -PassThru
    $proc.Id | Set-Content -Path $PidFile -Encoding ascii
    Write-Host "已启动常驻会话 (PID $($proc.Id))" -ForegroundColor Green
}

function Stop-KeepAlive {
    $procId = Get-KeepAlivePid
    if ($procId) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "已结束常驻会话 (PID $procId)" -ForegroundColor Green
    } else {
        Write-Host '没有运行中的常驻会话' -ForegroundColor Yellow
    }
    Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Show-Help {
    @"
AgentMatrix-SC 开发命令

  dev up            启动服务并保持 WSL 常驻（推荐日常用这个）
  dev down          停止并移除容器（保留数据卷），同时结束常驻会话
  dev ps            查看容器状态与常驻会话
  dev logs [服务]   跟踪日志，默认 api
  dev build         重新构建 api 镜像
  dev migrate       执行数据库迁移到最新
  dev seed          灌入演示种子数据
  dev health        检查 /health
  dev url           打开 API 文档
  dev sh            进入 api 容器 shell
  dev keepalive     仅启动常驻会话
  dev halt          仅结束常驻会话

服务名：api / postgres / redis
"@
}

switch ($Command.ToLower()) {
    'up' {
        Invoke-Wsl 'docker compose up -d'
        Start-KeepAlive
    }
    'down' {
        Stop-KeepAlive
        Invoke-Wsl 'docker compose down'
    }
    'ps' {
        Invoke-Wsl "docker compose ps --format 'table {{.Service}}\t{{.Status}}\t{{.Ports}}'"
        $ka = Get-KeepAlivePid
        if ($ka) { Write-Host "常驻会话：运行中 (PID $ka)" -ForegroundColor Green }
        else { Write-Host '常驻会话：未运行（容器可能在命令间隙重启）' -ForegroundColor Yellow }
    }
    'build'      { Invoke-Wsl 'docker compose build api' }
    'migrate'    { Invoke-Wsl 'docker compose exec -T api alembic upgrade head' }
    'seed'       { Invoke-Wsl 'docker compose exec -T api python -m app.seed' }
    'sh'         { Invoke-Wsl 'docker compose exec api bash' }
    'keepalive'  { Start-KeepAlive }
    'halt'       { Stop-KeepAlive }
    'logs'       {
        $svc = if ($Rest -and $Rest.Count -gt 0) { $Rest[0] } else { 'api' }
        Invoke-Wsl "docker compose logs --tail 100 -f $svc"
    }
    'health'     {
        try {
            $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/health' -UseBasicParsing -TimeoutSec 8
            Write-Host "HTTP $($r.StatusCode)" -ForegroundColor Green
            Write-Host $r.Content
        } catch {
            Write-Host "健康检查失败：$($_.Exception.Message)" -ForegroundColor Red
            exit 1
        }
    }
    'url'        { Start-Process 'http://127.0.0.1:8000/docs' }
    default      { Show-Help }
}
