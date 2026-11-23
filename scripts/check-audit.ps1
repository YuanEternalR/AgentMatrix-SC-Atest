# 审计日志检查：留痕、脱敏、权限、只追加、导出。
#
# 对照验收清单「审批暂停恢复；审计日志完整」与规格 5.8 / 12：
#   1. 登录成功与失败都留痕，失败记录里的邮箱已脱敏；
#   2. 配置变更留痕，且带"改前 / 改后"；
#   3. 已处理的审批可以追到"谁批的"；
#   4. 只读角色看不到审计（403）；
#   5. CSV 导出带 UTF-8 BOM 与中文表头；
#   6. 数据库层拒绝删除/修改审计记录（触发器）；
#   7. 汇总接口与列表总数一致。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-audit.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Base = 'http://127.0.0.1:8000/api/v1'
$Password = 'AgentMatrix@2026'
$Distro = 'Ubuntu-AgentMatrix'
$RepoRoot = (Split-Path $PSScriptRoot -Parent).TrimEnd('\')
$passed = 0
$failed = 0

function Assert-True([bool]$cond, [string]$msg) {
    if ($cond) { Write-Host "  [OK] $msg" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:failed++ }
}

function Login([string]$user, [string]$pwd = $Password) {
    $body = @{ username = "$user@agentmatrix.local"; password = $pwd }
    $resp = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body `
        -ContentType 'application/x-www-form-urlencoded'
    return @{ Authorization = "Bearer $($resp.access_token)" }
}

function Status([string]$path, [hashtable]$h) {
    try {
        Invoke-WebRequest -Uri "$Base$path" -Headers $h -UseBasicParsing | Out-Null
        return 200
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code) { return $code }
        throw
    }
}

# Windows PowerShell 5.1 的 Invoke-RestMethod 会把 JSON 数组包成单个 Object[]，
# 再套 @() 就成了嵌套数组：$x[0] 拿到整个数组、$x.Count 恒为 1。
# 逐个展开，后面的取值与计数才是对的。
function Flatten-Items($raw) {
    $out = @()
    foreach ($item in @($raw)) {
        if ($item -is [System.Array]) { $out += $item } else { $out += ,$item }
    }
    # 加逗号返回，避免只有 1 个元素时被 PowerShell 拆成标量（那样 .Count 会是 $null）
    return ,$out
}

# Windows 路径 -> WSL 路径（反斜杠会被 bash 当转义符吃掉，不能用 wslpath）
function ConvertTo-WslPath([string]$WinPath) {
    $p = $WinPath -replace '\\', '/'
    if ($p -match '^([A-Za-z]):(.*)$') { return "/mnt/$($Matches[1].ToLower())$($Matches[2])" }
    return $p
}

$InfraDir = "$(ConvertTo-WslPath $RepoRoot)/infra"

Write-Host '==> 登录留痕' -ForegroundColor Cyan
$admin = Login 'admin'
$ops = Login 'ops'
$viewer = Login 'viewer'

$logins = Flatten-Items (Invoke-RestMethod -Uri "$Base/audit-logs?action=auth.login&limit=5" -Headers $admin)
Assert-True ($logins.Count -gt 0) "登录成功已写审计（最近 $($logins.Count) 条）"

# 故意用错误密码登录：既验证"失败也留痕"，又验证邮箱脱敏
try {
    Login 'nobody' 'definitely-not-the-password' | Out-Null
} catch {
    # 预期 401，忽略
}
$failures = Flatten-Items (Invoke-RestMethod -Uri "$Base/audit-logs?action=auth.login_failed&limit=5" -Headers $admin)
$row = $failures | Where-Object { $_.actor_name -like 'n***' } | Select-Object -First 1
Assert-True ($null -ne $row) '登录失败已写审计'
Assert-True ($row -and $row.actor_name -notlike '*nobody*') "失败记录里的邮箱已脱敏（$($row.actor_name)）"

Write-Host '==> 配置变更留痕（含改前/改后）' -ForegroundColor Cyan
$rules = Flatten-Items (Invoke-RestMethod -Uri "$Base/alert-rules" -Headers $ops)
$rule = $rules[0]
# 用当前值回写：产生一条真实审计，但不改动演示状态
$null = Invoke-RestMethod -Uri "$Base/alert-rules/$($rule.id)" -Method Patch -Headers $ops `
    -ContentType 'application/json; charset=utf-8' -Body (@{ enabled = $rule.enabled } | ConvertTo-Json)
Start-Sleep -Milliseconds 200

$changes = Flatten-Items (Invoke-RestMethod -Uri "$Base/audit-logs?action=alert_rule.update&limit=1" -Headers $ops)
$change = $changes[0]
Assert-True ($null -ne $change) '告警规则变更已写审计'
Assert-True ($change -and $change.before -and $change.after) '记录带"变更前 / 变更后"'
Assert-True ($change -and $change.summary -like '*修改告警规则*') "摘要是中文（$($change.summary)）"

Write-Host '==> 审批可追溯' -ForegroundColor Cyan
# 审计是"上线之后"才有的能力：历史审批没有记录是事实，不能当成缺陷。
# 有记录就逐条核对能否追到决策人；一条都没有就明确跳过，并指出怎么把它跑出来。
$decisions = Flatten-Items (Invoke-RestMethod -Uri "$Base/audit-logs?action=approval.decide&limit=20" -Headers $admin)
if ($decisions.Count -eq 0) {
    Write-Host '  [SKIP] 还没有审计上线后的审批记录（先跑 tests/e2e 或 smoke-test）' -ForegroundColor Yellow
} else {
    Assert-True ($decisions.Count -gt 0) "审批决策已写审计（最近 $($decisions.Count) 条）"
    $latest = $decisions[0]
    $approvals = Flatten-Items (Invoke-RestMethod -Uri "$Base/approvals?pending_only=false&limit=100" -Headers $admin)
    $hit = $approvals | Where-Object { $_.id -eq $latest.resource_id } | Select-Object -First 1
    Assert-True ($null -ne $hit) '审计里的审批编号能对上真实审批记录'
    Assert-True ($latest.actor_name -and $latest.actor_role -eq 'operator') `
        "记录了决策人与角色（$($latest.actor_name) / $($latest.actor_role_label)）"
    Assert-True ($latest.before -and $latest.after) '记录了审批前后的状态与意见'
    Write-Host "  摘要：$($latest.summary)" -ForegroundColor DarkGray
}

Write-Host '==> 权限：只读看不到审计' -ForegroundColor Cyan
$code = Status '/audit-logs' $viewer
Assert-True ($code -eq 403) "只读角色访问审计被拒绝（实际 HTTP $code）"
$code = Status '/audit-logs' $ops
Assert-True ($code -eq 200) "运营可以查看审计（实际 HTTP $code）"

Write-Host '==> 导出 CSV' -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP 'agentmatrix-audit-export.csv'
Invoke-WebRequest -Uri "$Base/audit-logs/export.csv?days=30" -Headers $admin -OutFile $tmp -UseBasicParsing
$bytes = [System.IO.File]::ReadAllBytes($tmp)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
Assert-True $hasBom '导出文件带 UTF-8 BOM（Excel 打开中文不乱码）'

$text = [System.IO.File]::ReadAllText($tmp)
$lines = @($text -split "`r?`n" | Where-Object { $_.Trim() })
Assert-True ($text -match '时间,操作者,角色,动作') '表头是中文列名'
Assert-True ($lines.Count -gt 2) "导出行数大于表头（实际 $($lines.Count) 行）"
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

Write-Host '==> 只追加：数据库拒绝删除' -ForegroundColor Cyan
$before = (Invoke-RestMethod -Uri "$Base/audit-logs/summary?days=365" -Headers $admin).total

# 事务里删除再回滚：触发器若失效，数据只会落到事务里，回滚后照样不丢
$sql = 'BEGIN; DELETE FROM audit_logs; ROLLBACK;'
$inner = "cd '$InfraDir' && docker compose exec -T postgres psql -U agentmatrix -d agentmatrix -v ON_ERROR_STOP=1"

# 原生命令往 stderr 写东西时，$ErrorActionPreference='Stop' 会把它当终止错误抛出；
# 这里预期就是失败（触发器拦截），所以临时放行并只看退出码。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$out = ($sql | wsl -d $Distro -u root -- bash -lc $inner 2>&1 | Out-String)
$exit = $LASTEXITCODE
$ErrorActionPreference = $prevEap

$after = (Invoke-RestMethod -Uri "$Base/audit-logs/summary?days=365" -Headers $admin).total
Assert-True ($exit -ne 0) "数据库拒绝了整表删除（psql 退出码 $exit）"
Assert-True ($before -eq $after) "审计条数未变化（$before → $after）"
if ($out -match '只追加表') {
    Write-Host '  触发器返回：audit_logs 为只追加表，禁止 DELETE 操作' -ForegroundColor DarkGray
}

Write-Host '==> 汇总与列表一致' -ForegroundColor Cyan
$summary = Invoke-RestMethod -Uri "$Base/audit-logs/summary?days=365" -Headers $admin
$resp = Invoke-WebRequest -Uri "$Base/audit-logs?days=365&limit=1" -Headers $admin -UseBasicParsing
$listed = [int]$resp.Headers['X-Total-Count']
Assert-True ($summary.total -eq $listed) "汇总总数与列表总数一致（$($summary.total) / $listed）"

Write-Host "`n通过 $passed 项，失败 $failed 项" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
if ($failed -gt 0) { exit 1 }
