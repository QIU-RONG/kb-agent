"""鉴权与授权。

两层：
1. 认证——你是谁（JWT）
2. 授权——你能看到哪些文档（role → visibility 白名单）

第二层才是内部知识库的关键：权限必须下沉到检索，
否则员工问「年终奖怎么算」，模型会从薪酬文档里检索出片段并念出来。
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import User
from app.db.session import get_db

logger = logging.getLogger(__name__)

# 角色 → 能看到的文档可见性
ROLE_VISIBILITY: dict[str, list[str]] = {
    "employee": ["public"],
    "finance": ["public", "finance"],
    "hr": ["public", "hr"],
    "admin": ["public", "hr", "finance", "admin"],
}

ALL_SCOPES = ["public", "hr", "finance", "admin"]


def visible_scopes(role: str) -> list[str]:
    return ROLE_VISIBILITY.get(role, ["public"])


def can_see(user: User, visibility: str) -> bool:
    return visibility in visible_scopes(user.role)


# ---------------- 密码 ----------------

def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ---------------- JWT ----------------

def create_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.id,
        "username": user.username,
        "role": user.role,
        "iat": int(now.timestamp()),
        "exp": now + timedelta(minutes=settings.token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """所有业务接口都挂这个依赖。没登录一律 401。"""
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = jwt.decode(
            cred.credentials, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(401, "登录已过期，请重新登录") from exc
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "无效的登录凭证") from exc

    user = db.get(User, payload.get("sub"))
    if user is None:
        raise HTTPException(401, "用户不存在")
    return user


def require_roles(*roles: str):
    """需要特定角色的接口，比如只有 hr/admin 能上传敏感文档。"""

    def _dep(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"需要 {', '.join(roles)} 角色")
        return user

    return _dep
