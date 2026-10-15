"""统一错误格式：{"error": {"code": "...", "message": "..."}}，code 供界面判断，message 供展示。"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..app.providers import MissingApiKeyError
from ..app.runs import RunNotFoundError, SessionBusyError, SessionNotFoundError
from ..app.sessions import UnknownProviderError


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# 应用层异常 → (HTTP 状态码, 错误码)
_DOMAIN_ERRORS: dict[type[Exception], tuple[int, str]] = {
    SessionNotFoundError: (404, "session_not_found"),
    RunNotFoundError: (404, "run_not_found"),
    SessionBusyError: (409, "session_busy"),
    MissingApiKeyError: (400, "missing_api_key"),
    UnknownProviderError: (400, "unknown_provider"),
}


def error_response(status: int, code: str, message: str, **extra: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message, **extra}}
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc.status, exc.code, exc.message)

    async def domain_error(request: Request, exc: Exception) -> JSONResponse:
        status, code = _DOMAIN_ERRORS[type(exc)]
        return error_response(status, code, str(exc))

    for exc_type in _DOMAIN_ERRORS:
        app.exception_handler(exc_type)(domain_error)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # 不回显 input（可能是用户提交的密钥）与 ctx（可能含无法序列化的异常对象）
        details = [
            {"loc": e.get("loc"), "type": e.get("type"), "msg": e.get("msg")} for e in exc.errors()
        ]
        return error_response(422, "invalid_request", "请求参数不合法", details=details)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        return error_response(exc.status_code, "http_error", str(exc.detail))
