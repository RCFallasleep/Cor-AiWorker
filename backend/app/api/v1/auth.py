"""用户认证接口：注册、登录、获取当前用户信息。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.core.auth import get_current_user
from app.services.user_service import (
    authenticate_user,
    create_access_token,
    create_user,
)

router = APIRouter(prefix="/auth", tags=["Auth"])


# ── 请求/响应模型 ─────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=32, pattern=r"^[a-zA-Z0-9_\-\u4e00-\u9fa5]+$")
    password: str = Field(..., min_length=6, max_length=64)
    display_name: str = Field(default="", max_length=32)
    email: str | None = Field(default=None)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


# ── 接口 ──────────────────────────────────────────────────────────────────────

@router.post("/register", response_model=TokenResponse, summary="注册新用户")
async def register(body: RegisterRequest):
    user = await create_user(
        username=body.username,
        password=body.password,
        display_name=body.display_name,
        email=body.email,
    )
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="用户名已被占用",
        )
    token = create_access_token(user["id"], user["username"])
    return TokenResponse(access_token=token, user=user)


@router.post("/login", response_model=TokenResponse, summary="用户登录")
async def login(body: LoginRequest):
    user = await authenticate_user(body.username, body.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="用户名或密码错误",
        )
    token = create_access_token(user["id"], user["username"])
    return TokenResponse(access_token=token, user=user)


@router.get("/me", summary="获取当前用户信息")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user
