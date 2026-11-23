"""登录与当前用户。"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.security import create_access_token, verify_password
from app.db.session import get_db
from app.models import User
from app.schemas.auth import TokenOut, UserOut
from app.services.audit import AuditCtx, record_and_commit, request_ctx

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenOut)
def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
    ctx: AuditCtx = Depends(request_ctx),
) -> TokenOut:
    user = db.scalars(select(User).where(User.email == form.username)).first()
    # 统一错误信息，避免泄露"该邮箱是否存在"
    if user is None or not verify_password(form.password, user.password_hash):
        # 登录失败也要留痕：连续失败是入侵的第一信号。
        # 这里记的是"尝试者填的邮箱"（已脱敏），而不是"查到的用户"。
        record_and_commit(
            db,
            "auth.login_failed",
            actor_name=form.username,
            resource_type="user",
            summary="登录失败：账号或密码错误",
            after={"reason": "账号或密码错误"},
            ctx=ctx,
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="邮箱或密码错误",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if user.status != "active":
        record_and_commit(
            db,
            "auth.login_failed",
            user=user,
            resource_type="user",
            resource_id=user.id,
            summary=f"登录被拒：{user.name} 账号已停用",
            after={"reason": "账号已停用"},
            ctx=ctx,
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用"
        )

    record_and_commit(
        db,
        "auth.login",
        user=user,
        resource_type="user",
        resource_id=user.id,
        summary=f"{user.name} 登录成功",
        ctx=ctx,
    )

    token = create_access_token(user.id, user.role, {"name": user.name})
    return TokenOut(access_token=token, user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
