"""Shared FastAPI dependencies: authentication and role checks."""

from __future__ import annotations

from collections.abc import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.security import decode_access_token
from app.db.session import get_db
from app.models import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

# 角色继承：admin 拥有全部权限，其余按需显式列出
ROLE_RANK = {"admin": 100, "developer": 60, "operator": 40, "viewer": 10}


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_error = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="登录状态无效或已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError as exc:
        raise credentials_error from exc

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_error

    user = db.get(User, user_id)
    if user is None or user.status != "active":
        raise credentials_error
    return user


def require_roles(*roles: str) -> Callable[..., User]:
    """Dependency factory: reject users whose role is not in ``roles``.

    ``admin`` always passes, so we never have to enumerate it at call sites.
    """
    allowed = set(roles) | {"admin"}

    def _guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"需要角色 {sorted(allowed)}，当前为 {user.role}",
            )
        return user

    return _guard


def can_publish(user: User) -> bool:
    """Publishing is limited to admin and developer."""
    return user.role in {"admin", "developer"}
