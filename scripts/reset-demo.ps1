# 重置演示数据：清空运行历史，生成一批有代表性的任务
#
# 保留：用户、智能体、技能、工作流版本、告警规则、业务日指标
# 清空：任务、运行、步骤、审批、调度决策、产物、死信、告警事件
#
# 生成：
#   6 条订单异常（已完成）
#   3 条区域履约诊断（已完成）
#   1 条订单异常（停在待审批，供现场演示）
#   1 条订单异常（故障注入，产生死信 + 告警）
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\reset-demo.ps1

param(
    [string]$Base = 'http://127.0.0.1:8000/api/v1',
    [string]$Container = 'agentmatrix-sc-postgres-1'
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

Write-Host '==> 1/3 清空运行数据' -ForegroundColor Cyan
$sql = 'TRUNCATE approvals, run_steps, runs, dispatch_decisions, tasks, artifacts, dead_letters, alert_events CASCADE;'
& wsl -d Ubuntu-AgentMatrix -u root -- docker exec $Container psql -U agentmatrix -d agentmatrix -c $sql | Out-Null
Write-Host '  已清空' -ForegroundColor Green

Write-Host '==> 2/3 登录' -ForegroundColor Cyan
$login = Invoke-RestMethod -Uri "$Base/auth/login" -Method Post `
    -Body @{ username = 'ops@agentmatrix.local'; password = 'AgentMatrix@2026' } `
    -ContentType 'application/x-www-form-urlencoded'
$h = @{ Authorization = "Bearer $($login.access_token)" }

function New-Task([string]$title, [string]$workflow, [hashtable]$payload, [int]$priority, [int]$complexity) {
    $body = @{
        title           = $title
        workflow_code   = $workflow
        priority        = $priority
        complexity_hint = $complexity
        payload         = $payload
    } | ConvertTo-Json -Depth 5
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    Invoke-RestMethod -Uri "$Base/tasks" -Method Post -Body $bytes `
        -ContentType 'application/json; charset=utf-8' -Headers $h
}

function Wait-Terminal([string]$runId, [int]$seconds = 180) {
    $deadline = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $deadline) {
        $run = Invoke-RestMethod -Uri "$Base/runs/$runId" -Headers $h
        if ($run.status -in @('succeeded', 'failed', 'canceled')) { return $run }
        if ($run.status -eq 'waiting_approval') {
            $apps = Invoke-RestMethod -Uri "$Base/approvals" -Headers $h
            # 注意：@() 必须包住整条管道，否则单元素结果会退化成标量，.Count 为 $null
            $mine = @($apps | Where-Object { $_.run_id -eq $runId -and $_.status -eq 'pending' })
            if ($mine.Count -gt 0) {
                $d = @{ decision = 'approved'; comment = '演示数据自动批准' } | ConvertTo-Json
                Invoke-RestMethod -Uri "$Base/approvals/$($mine[0].id)/decision" -Method Post `
                    -Body $d -ContentType 'application/json' -Headers $h | Out-Null
            }
        }
        Start-Sleep -Milliseconds 700
    }
    throw "等待运行终态超时：$runId"
}

Write-Host '==> 3/3 生成演示任务（全部使用 DataCo 真实订单号）' -ForegroundColor Cyan

# 这些订单号来自真实数据集，见 data/dataco_orders.csv；准时单不会触发审批分支
$orders = @(
    @{ id = '10001'; qty = 120; city = 'South America' },
    @{ id = '10003'; qty = 90;  city = 'South America' },
    @{ id = '10008'; qty = 200; city = 'South America' },
    @{ id = '1001';  qty = 60;  city = 'South America' },
    @{ id = '10013'; qty = 150; city = 'South America' },
    @{ id = '10021'; qty = 80;  city = 'South America' }
)

$done = 0
foreach ($o in $orders) {
    $task = New-Task "订单 $($o.id) 延迟异常处理" 'order_delay_exception' `
        @{ order_id = $o.id; quantity = $o.qty; destination = $o.city } 3 3
    $run = Wait-Terminal $task.run_id
    if ($run.status -eq 'succeeded') { $done++ }
}
Write-Host "  订单异常已完成：$done / $($orders.Count)" -ForegroundColor Green

$regions = @('Western Europe', 'South America', 'Eastern Europe')
$done2 = 0
foreach ($r in $regions) {
    $task = New-Task "区域履约诊断：$r" 'fulfillment_review' @{ region = $r } 4 4
    $run = Wait-Terminal $task.run_id 120
    if ($run.status -eq 'succeeded') { $done2++ }
}
Write-Host "  区域履约诊断已完成：$done2 / $($regions.Count)" -ForegroundColor Green

# 停在待审批的一条：真实订单 100 延迟 4 天，影响分 ≥3，必然进审批分支
$pendingTask = New-Task '订单 100 延迟异常处理（待审批）' 'order_delay_exception' `
    @{ order_id = '100'; quantity = 480; destination = 'Caribbean' } 1 5
Write-Host "  待审批任务：$($pendingTask.id.Substring(0,8))" -ForegroundColor Yellow

# 故障注入：产生死信与告警
$deadTask = New-Task '订单 SO-DEAD-DEMO 通知故障演练' 'order_delay_exception' `
    @{ order_id = 'SO-DEAD-DEMO'; quantity = 120 } 3 3
$null = Wait-Terminal $deadTask.run_id 90

Start-Sleep -Seconds 2
$counts = & wsl -d Ubuntu-AgentMatrix -u root -- docker exec $Container psql -U agentmatrix -d agentmatrix -tAc `
    "select (select count(*) from tasks) || ' 任务 / ' || (select count(*) from runs) || ' 运行 / ' || (select count(*) from approvals where status='pending') || ' 待审批 / ' || (select count(*) from dead_letters where status='pending') || ' 死信'"
Write-Host "`n当前数据：$($counts.Trim())" -ForegroundColor Green
Write-Host '演示数据重置完成。' -ForegroundColor Green
