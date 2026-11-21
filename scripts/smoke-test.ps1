# AgentMatrix-SC 端到端冒烟测试
#
# 覆盖：登录 → 建任务 → 调度打分 → Worker 执行 → 审批暂停 → 批准恢复 → 运行成功
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\smoke-test.ps1 -ExpectStrategy s4_llm_planner

param(
    [string]$Base = 'http://127.0.0.1:8000/api/v1',
    [string]$Email = 'ops@agentmatrix.local',
    [string]$Password = 'AgentMatrix@2026',
    [string]$ExpectStrategy = '',
    [int]$TimeoutSec = 40
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Assert-True($condition, [string]$message) {
    if (-not $condition) { throw "断言失败：$message" }
    Write-Host "  [OK] $message" -ForegroundColor Green
}

function Step([string]$text) { Write-Host "`n==> $text" -ForegroundColor Cyan }

function Wait-RunStatus($headers, [string]$runId, [string[]]$wanted, [int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        $run = Invoke-RestMethod -Uri "$Base/runs/$runId" -Headers $headers
        if ($wanted -contains $run.status) { return $run }
        Start-Sleep -Milliseconds 700
    }
    throw "等待运行状态超时（期望 $($wanted -join '/')）"
}

Step '1/6 登录'
$login = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post `
    -Body @{ username = $Email; password = $Password } `
    -ContentType 'application/x-www-form-urlencoded'
Assert-True ($null -ne $login.access_token) '拿到访问令牌'
$h = @{ Authorization = "Bearer $($login.access_token)" }
Write-Host "  用户：$($login.user.name)（$($login.user.role)）"

Step '2/6 检查当前调度策略'
$meta = Invoke-RestMethod -Uri "$Base/meta" -Headers $h
$strategy = $meta.dispatch.active_strategy
Write-Host "  策略：$strategy"
if ($ExpectStrategy) { Assert-True ($strategy -eq $ExpectStrategy) "策略为 $ExpectStrategy" }

Step '3/6 创建任务'
$payload = @{
    title          = "冒烟测试 $(Get-Date -Format 'HHmmss') 订单延迟异常"
    workflow_code  = 'order_delay_exception'
    priority       = 1
    complexity_hint = 5
    payload        = @{ order_id = "SO-SMOKE-$(Get-Date -Format 'HHmmss')"; quantity = 420 }
} | ConvertTo-Json -Depth 5

$task = Invoke-RestMethod -Uri "$Base/tasks" -Method Post -Body $payload -ContentType 'application/json' -Headers $h
Assert-True ($null -ne $task.id) '任务已创建'
Assert-True ($null -ne $task.run_id) '运行已创建'
Assert-True ($task.decision.agent_code -ne $null) "任务已派给智能体：$($task.decision.agent_code)"
Assert-True ($task.decision.factors.Count -gt 0) "打分拆解因子数 = $($task.decision.factors.Count)"
Write-Host "  任务 $($task.id) → 智能体 $($task.decision.agent_code)（$($task.decision.strategy)）"

Step '4/6 等待 Worker 执行到暂停点'
$run = Wait-RunStatus $h $task.run_id @('waiting_approval', 'succeeded', 'failed') $TimeoutSec
Assert-True ($run.status -eq 'waiting_approval') "运行停在审批节点（实际 $($run.status)）"
Assert-True ($run.steps.Count -ge 5) "已落库步骤数 = $($run.steps.Count)"

$evalStep = $run.steps | Where-Object { $_.node_id -eq 'evaluate' }
Assert-True ($null -ne $evalStep) '智能体执行步骤存在'
Assert-True ($evalStep.output.resolved_by -like 'dispatch:*') `
    "执行者由调度决策决定（$($evalStep.output.resolved_by)）"

Step '5/6 审批通过'
$approvals = Invoke-RestMethod -Uri "$Base/approvals" -Headers $h
$mine = $approvals | Where-Object { $_.run_id -eq $task.run_id -and $_.status -eq 'pending' }
Assert-True ($null -ne $mine) '存在待审批记录'

$decision = @{ decision = 'approved'; comment = '冒烟测试自动批准' } | ConvertTo-Json
$decided = Invoke-RestMethod -Uri "$Base/approvals/$($mine.id)/decision" -Method Post `
    -Body $decision -ContentType 'application/json' -Headers $h
Assert-True ($decided.status -eq 'approved') '审批已通过'

Step '6/6 等待运行完成'
$final = Wait-RunStatus $h $task.run_id @('succeeded', 'failed') $TimeoutSec
Assert-True ($final.status -eq 'succeeded') "运行成功（成本 $($final.cost_usd)）"

$nodeOrder = ($final.steps | ForEach-Object { $_.node_id }) -join ' → '
Write-Host "`n执行链路：$nodeOrder"
Write-Host "`n全部断言通过，最小闭环可用。" -ForegroundColor Green
