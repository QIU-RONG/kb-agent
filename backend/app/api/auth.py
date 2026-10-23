"""登录与当前用户。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.security import (
    create_token,
    get_current_user,
    require_roles,
    verify_password,
    visible_scopes,
)
from app.db.models import User
from app.db.session import get_db
from app.schemas import LoginRequest, TokenOut, UserOut

logger = logging.getLogger(__name__)
router = APIRouter(tags=["auth"])


@router.post("/auth/login", response_model=TokenOut)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()

    # 不区分「用户不存在」和「密码错误」——避免被用来枚举用户名
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "用户名或密码错误")

    return TokenOut(access_token=create_token(user), user=_out(user))


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return _out(user)


@router.get("/auth/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db), _: User = Depends(require_roles("admin"))):
    """只有 admin 能看用户列表。演示用，方便切换角色验证权限。"""
    return [_out(u) for u in db.query(User).order_by(User.created_at).all()]


def _out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name or user.username,
        role=user.role,
        scopes=visible_scopes(user.role),
    )
