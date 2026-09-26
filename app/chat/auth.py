import os
from pathlib import Path
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


bearer = HTTPBearer(auto_error=False)


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
        user_id = UUID(claims["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        raise HTTPException(401, "Invalid access token", headers={"WWW-Authenticate": "Bearer"}) from None
    return {"user_id": user_id, "scopes": set(claims.get("scope", "").split())}


def require_subject_writer(principal: dict = Depends(identity)) -> dict:
    if "chat:subjects:write" not in principal["scopes"]:
        raise HTTPException(403, "Subject registration requires service capability")
    return principal
