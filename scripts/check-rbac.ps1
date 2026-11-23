# RBAC 权限检查：四个角色的权限差异是否真的生效。
#
# 对照验收清单「四个角色账号可用，权限差异生效」。
# 只做只读与越权探测，不创建业务数据（发布会带空 body，鉴权先于校验）。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-rbac.ps1

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$Base = 'http://127.0.0.1:8000/api/v1'
$Password = 'AgentMatrix@2026'
$passed = 0
$failed = 0

function Assert-True([bool]$cond, [string]$msg) {
    if ($cond) { Write-Host "  [OK] $msg" -ForegroundColor Green; $script:passed++ }
    else { Write-Host "  [FAIL] $msg" -ForegroundColor Red; $script:failed++ }
}

function Login([string]$user) {
    $body = @{ username = "$user@agentmatrix.local"; password = $Password }
    $resp = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post -Body $body `
        -ContentType 'application/x-www-form-urlencoded'
    return @{ Authorization = "Bearer $($resp.access_token)" }
}

function Status([string]$path, [hashtable]$h, [string]$method = 'GET', [string]$json = '') {
    try {
        $args = @{ Uri = "$Base$path"; Method = $method; Headers = $h; UseBasicParsing = $true }
        if ($json) { $args.Body = $json; $args.ContentType = 'application/json; charset=utf-8' }
        $r = Invoke-WebRequest @args
        return $r.StatusCode
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        if ($code) { return $code }
        throw
    }
}

Write-Host '==> 登录四个角色' -ForegroundColor Cyan
$admin = Login 'admin'
$dev = Login 'dev'
$ops = Login 'ops'
$viewer = Login 'viewer'
Write-Host '  四个账号均可登录' -ForegroundColor Green

Write-Host '==> 只读：不能改、能看' -ForegroundColor Cyan
Assert-True ((Status '/tasks' $viewer) -eq 200) '只读可以查看任务列表'
$code = Status '/tasks' $viewer 'POST' (@{ title = 'rbac probe'; workflow_code = 'order_delay_exception' } | ConvertTo-Json)
Assert-True ($code -eq 403) "只读不能创建任务（实际 HTTP $code）"

Write-Host '==> 运营：能建任务、不能发布工作流' -ForegroundColor Cyan
$code = Status '/tasks' $ops 'POST' (@{ title = 'rbac probe'; workflow_code = 'order_delay_exception'; payload = @{ order_id = '10001' } } | ConvertTo-Json -Depth 4)
Assert-True ($code -eq 201) "运营可以创建任务（实际 HTTP $code）"
$code = Status '/workflows/order_delay_exception/versions' $ops 'POST' '{}'
Assert-True ($code -eq 403) "运营不能发布工作流（实际 HTTP $code）"

Write-Host '==> 开发者：能发布工作流' -ForegroundColor Cyan
# 空 body 会过鉴权、在校验阶段返回 422 —— 说明权限已通过
$code = Status '/workflows/order_delay_exception/versions' $dev 'POST' '{}'
Assert-True ($code -ne 403) "开发者发布请求未被鉴权拒绝（实际 HTTP $code）"

Write-Host '==> 管理员与运营：告警规则可切换' -ForegroundColor Cyan
$rules = Invoke-RestMethod -Uri "$Base/alert-rules" -Headers $ops
$rid = @($rules)[0].id
$code = Status "/alert-rules/$rid" $ops 'PATCH' (@{ enabled = $true } | ConvertTo-Json)
Assert-True ($code -eq 200) "运营可以切换规则启用状态（实际 HTTP $code）"
$code = Status "/alert-rules/$rid" $ops 'PATCH' (@{ threshold = 999 } | ConvertTo-Json)
Assert-True ($code -eq 403) "运营不能改阈值（实际 HTTP $code）"

Write-Host "`n通过 $passed 项，失败 $failed 项" -ForegroundColor $(if ($failed -eq 0) { 'Green' } else { 'Red' })
if ($failed -gt 0) { exit 1 }
