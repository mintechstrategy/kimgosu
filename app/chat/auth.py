import os
import re
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer = HTTPBearer(auto_error=False)
USER_ID = re.compile(r"^(?:[a-z][a-z0-9]*_[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$")


def identity(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)) -> dict:
    if credentials is None:
        raise HTTPException(401, "Authentication required", headers={"WWW-Authenticate": "Bearer"})
    try:
        secret = Path(os.environ["JWT_SECRET_FILE"]).read_text().strip()
        claims = jwt.decode(
            credentials.credentials,
            secret,
            algorithms=["HS256"],
            audience="kimgosu-api",
            issuer="kimgosu",
            options={"require": ["sub", "exp", "iat", "iss", "aud"]},
        )
        user_id = claims["sub"]
        if not isinstance(user_id, str) or not USER_ID.fullmatch(user_id):
            raise ValueError("Invalid user ID")
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid access token", headers={"WWW-Authenticate": "Bearer"}) from None
    return {"user_id": user_id, "scopes": set(claims.get("scope", "").split())}


def require_subject_writer(principal: dict = Depends(identity)) -> dict:
    if "chat:subjects:write" not in principal["scopes"]:
        raise HTTPException(403, "Subject registration requires service capability")
    return principal
