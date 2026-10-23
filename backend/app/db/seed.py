"""演示用户。第一次启动时自动创建，已存在则跳过。"""

from __future__ import annotations

import logging

from app.core.security import hash_password
from app.db.models import User
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

# 演示账号。真实项目里绝不能这样建用户（弱密码 + 明文写在代码里）
DEMO_USERS = [
    ("admin", "admin123", "管理员", "admin"),
    ("hr", "hr123", "HR 专员", "hr"),
    ("fin", "fin123", "财务专员", "finance"),
    ("emp", "emp123", "普通员工", "employee"),
]


def seed_users() -> None:
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            return
        for username, password, display, role in DEMO_USERS:
            db.add(
                User(
                    username=username,
                    password_hash=hash_password(password),
                    display_name=display,
                    role=role,
                )
            )
        db.commit()
        logger.info("seeded %d demo users", len(DEMO_USERS))
    finally:
        db.close()
