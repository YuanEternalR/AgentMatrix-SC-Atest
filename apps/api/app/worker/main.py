"""执行 Worker：从数据库领取运行并推进工作流。

为什么不用 Celery：
1. 运行状态本来就落库，队列再放一份消息会产生"两份真相"，还要处理重复投递；
2. PostgreSQL 的 ``SELECT ... FOR UPDATE SKIP LOCKED`` 已提供可靠领取语义，
   且进程崩溃后任务自动回到可领取状态，无需额外补偿逻辑；
3. 少一个中间件，答辩现场少一个可能起不来的组件。

Redis 仍然保留，用于后续的 SSE 事件广播与缓存。
"""

from __future__ import annotations

import logging
import signal
import sys
import time
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models import Run
from app.services.engine import execute_run
from app.services.llm.gateway import LLMGateway

logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)-7s [worker] %(message)s",
)
logger = logging.getLogger("agentmatrix.worker")

IDLE_SLEEP_SEC = 1.0
_shutdown = False


def _handle_signal(signum, _frame) -> None:
    global _shutdown
    logger.info("收到信号 %s，准备退出", signum)
    _shutdown = True


def claim_run(db: Session) -> Run | None:
    """乐观领取一个待执行的运行；SKIP LOCKED 保证多 Worker 不抢同一条。"""
    run = db.scalars(
        select(Run)
        .where(Run.status == "queued")
        .order_by(Run.created_at.asc())
        .with_for_update(skip_locked=True)
        .limit(1)
    ).first()
    if run is None:
        db.rollback()
        return None

    run.status = "running"
    run.started_at = run.started_at or datetime.now(timezone.utc)
    db.commit()
    db.refresh(run)
    return run


def process_once(gateway: LLMGateway) -> bool:
    """处理一个运行；返回是否真的做了事。"""
    db = SessionLocal()
    try:
        run = claim_run(db)
        if run is None:
            return False

        logger.info("开始执行 run=%s task=%s", run.id, run.task_id)
        outcome = execute_run(db, run, gateway)
        logger.info("运行结束 run=%s status=%s msg=%s", run.id, outcome.status, outcome.message)
        return True
    except Exception:  # noqa: BLE001 - worker 不能因为单次异常退出
        logger.exception("处理运行失败")
        db.rollback()
        return False
    finally:
        db.close()


def main() -> int:
    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    try:
        gateway = LLMGateway(settings.llm_provider)
    except NotImplementedError as exc:
        logger.error("LLM 网关初始化失败：%s", exc)
        return 2

    logger.info(
        "worker 启动：策略=%s provider=%s", settings.dispatch_strategy, settings.llm_provider
    )
    while not _shutdown:
        did_work = process_once(gateway)
        if not did_work:
            time.sleep(IDLE_SLEEP_SEC)

    logger.info("worker 已退出")
    return 0


if __name__ == "__main__":
    sys.exit(main())
