from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, WebSocket, WebSocketDisconnect, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from datetime import datetime, timedelta
from bson import ObjectId
from typing import List, Optional
import os
import logging
import jwt
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, field_validator
import secrets
import hashlib
import hmac
import base64
import json
import smtplib
from email.message import EmailMessage
import httpx
import boto3
import time

R2_ACCOUNT_ID = os.getenv("R2_ACCOUNT_ID")
R2_ACCESS_KEY_ID = os.getenv("R2_ACCESS_KEY_ID")
R2_SECRET_ACCESS_KEY = os.getenv("R2_SECRET_ACCESS_KEY")
R2_BUCKET = os.getenv("R2_BUCKET")
R2_PUBLIC_BASE_URL = os.getenv("R2_PUBLIC_BASE_URL")


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.getenv("MONGO_URL")
db_name = os.getenv("DB_NAME")
if not mongo_url or not db_name:
    raise RuntimeError("Missing required env vars: MONGO_URL and/or DB_NAME")
client = AsyncIOMotorClient(mongo_url)
db = client[db_name]

# Security
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()
SECRET_KEY = os.getenv("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("Missing required env var: SECRET_KEY")
ALGORITHM = "HS256"

MAX_PAGE_LIMIT = 50
MAX_PRICE = 1_000_000_000.0
MAX_TEXT_LEN = 5000
MAX_MESSAGE_TEXT_LEN = 500
MAX_IMAGE_CHARS = 12_000_000
MAX_IMAGES = 10

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "0") or "0")
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_FROM = os.getenv("SMTP_FROM")
APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL")

PAYTR_MERCHANT_ID = os.getenv("PAYTR_MERCHANT_ID")
PAYTR_MERCHANT_KEY = os.getenv("PAYTR_MERCHANT_KEY")
PAYTR_MERCHANT_SALT = os.getenv("PAYTR_MERCHANT_SALT")
PAYTR_OK_URL = os.getenv("PAYTR_OK_URL") or (f"{APP_PUBLIC_URL.rstrip('/')}/payment/success" if APP_PUBLIC_URL else None)
PAYTR_FAIL_URL = os.getenv("PAYTR_FAIL_URL") or (f"{APP_PUBLIC_URL.rstrip('/')}/payment/fail" if APP_PUBLIC_URL else None)
PAYTR_TEST_MODE = os.getenv("PAYTR_TEST_MODE", "1")

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


def clamp_pagination(skip: int, limit: int) -> tuple[int, int]:
    s = max(0, int(skip or 0))
    l = int(limit or 0)
    if l <= 0:
        l = 20
    l = min(l, MAX_PAGE_LIMIT)
    return s, l


class RateLimiter:
    def __init__(self) -> None:
        self._buckets: dict[str, list[float]] = {}

    def allow(self, key: str, limit: int, window_seconds: int) -> bool:
        import time

        now = time.time()
        start = now - window_seconds
        hits = [t for t in self._buckets.get(key, []) if t >= start]
        if len(hits) >= limit:
            self._buckets[key] = hits
            return False
        hits.append(now)
        self._buckets[key] = hits
        return True


rate_limiter = RateLimiter()

# Small in-memory cache to reduce hot-path Mongo counts.
# Key: user_id string -> (ts_epoch_seconds, total_unread)
_unread_count_cache: dict[str, tuple[float, int]] = {}
_UNREAD_COUNT_TTL_SECONDS = 2.0


def _invalidate_unread_cache(user_ids: list[str]) -> None:
    for uid in user_ids:
        if isinstance(uid, str):
            _unread_count_cache.pop(uid, None)


def _client_ip(req: Request) -> str:
    # Trust reverse proxy headers only if you control them; keep simple.
    host = req.client.host if req.client else "unknown"
    return host or "unknown"


async def fetch_users_map(user_ids: list[ObjectId]) -> dict[ObjectId, dict]:
    uniq: list[ObjectId] = list({uid for uid in user_ids if isinstance(uid, ObjectId)})
    if not uniq:
        return {}
    users = await db.users.find({"_id": {"$in": uniq}}).to_list(len(uniq))
    return {u["_id"]: u for u in users}


async def ensure_indexes() -> None:
    # listings
    await db.listings.create_index([("status", 1), ("createdAt", -1)])
    await db.listings.create_index([("sellerId", 1), ("createdAt", -1)])
    await db.listings.create_index([("favorites", 1)])
    await db.listings.create_index([("location.city", 1)])
    await db.listings.create_index([("location.district", 1)])
    await db.listings.create_index([("category", 1), ("status", 1), ("createdAt", -1)])
    await db.listings.create_index([("condition", 1), ("status", 1), ("createdAt", -1)])
    await db.listings.create_index([("price", 1)])
    await db.listings.create_index([("title", "text"), ("description", "text")], name="listings_text")
    await db.listings.create_index([("location.geo", "2dsphere")], name="listings_geo")

    # messages
    await db.messages.create_index([("listingId", 1), ("createdAt", 1)])
    await db.messages.create_index([("receiverId", 1), ("isRead", 1)])

    # purchase_requests
    await db.purchase_requests.create_index([("listingId", 1), ("status", 1)])
    await db.purchase_requests.create_index([("sellerId", 1), ("status", 1), ("createdAt", -1)])
    await db.purchase_requests.create_index([("buyerId", 1), ("status", 1), ("createdAt", -1)])

    # password_resets
    await db.password_resets.create_index([("expiresAt", 1)], expireAfterSeconds=0)
    await db.password_resets.create_index([("userId", 1), ("expiresAt", -1)])
    await db.password_resets.create_index([("tokenHash", 1)])

    # push_tokens
    await db.push_tokens.create_index([("userId", 1), ("updatedAt", -1)])
    await db.push_tokens.create_index([("expoPushToken", 1)], unique=True)

    # promotions
    await db.promotions.create_index([("listingId", 1), ("status", 1), ("endsAt", -1)])
    await db.promotions.create_index([("sellerId", 1), ("createdAt", -1)])
    await db.promotions.create_index([("merchantOid", 1)], unique=True)

    # stories
    await db.stories.create_index([("expiresAt", 1)], expireAfterSeconds=0)
    await db.stories.create_index([("createdAt", -1)])

    # questions (Q&A)
    await db.questions.create_index([("listingId", 1), ("createdAt", -1)])
    await db.questions.create_index([("sellerId", 1), ("createdAt", -1)])
    await db.questions.create_index([("askerId", 1), ("createdAt", -1)])


class ConnectionManager:
    def __init__(self) -> None:
        self._by_user: dict[str, set[WebSocket]] = {}

    async def connect(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._by_user.setdefault(user_id, set()).add(websocket)

    def disconnect(self, user_id: str, websocket: WebSocket) -> None:
        conns = self._by_user.get(user_id)
        if not conns:
            return
        conns.discard(websocket)
        if not conns:
            self._by_user.pop(user_id, None)

    async def send_to_user(self, user_id: str, payload: dict) -> None:
        conns = list(self._by_user.get(user_id, set()))
        if not conns:
            return
        stale: list[WebSocket] = []
        for ws in conns:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.disconnect(user_id, ws)

    async def send_to_users(self, user_ids: list[str], payload: dict) -> None:
        for uid in set(user_ids):
            await self.send_to_user(uid, payload)


ws_manager = ConnectionManager()

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

ANDROID_APP_LINK_SHA256 = os.getenv("ANDROID_APP_LINK_SHA256")  # comma-separated SHA256 fingerprints
ANDROID_APP_LINK_PACKAGE = os.getenv("ANDROID_APP_LINK_PACKAGE") or "com.aaksoyyyy.ikinciel"

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

@app.middleware("http")
async def request_timing_middleware(request: Request, call_next):
    rid = secrets.token_hex(8)
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        elapsed_ms = int((time.perf_counter() - start) * 1000)
        logger.exception("request_error rid=%s method=%s path=%s ms=%s", rid, request.method, request.url.path, elapsed_ms)
        raise
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    if elapsed_ms >= 500:
        logger.info("slow_request rid=%s method=%s path=%s status=%s ms=%s", rid, request.method, request.url.path, response.status_code, elapsed_ms)
    response.headers["X-Request-Id"] = rid
    return response


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4401)
        return
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if not isinstance(user_id, str) or not ObjectId.is_valid(user_id):
            await websocket.close(code=4401)
            return
    except Exception:
        await websocket.close(code=4401)
        return

    await ws_manager.connect(user_id, websocket)
    try:
        await websocket.send_json({"type": "hello"})
        while True:
            # Client->server messages are optional for now; we keep the socket open.
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(user_id, websocket)
    except Exception:
        ws_manager.disconnect(user_id, websocket)


# ==================== PYDANTIC MODELS ====================

class UserRegister(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6, max_length=200)
    name: str = Field(..., min_length=2, max_length=80)
    phone: Optional[str] = Field(default=None, max_length=30)

    @field_validator("name")
    @classmethod
    def _name_trim(cls, v: str) -> str:
        s = (v or "").strip()
        if not s:
            raise ValueError("Invalid name")
        return s

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class ForgotPasswordBody(BaseModel):
    email: EmailStr

class ResetPasswordBody(BaseModel):
    token: str
    newPassword: str = Field(..., min_length=6, max_length=200)

class PushRegisterBody(BaseModel):
    expoPushToken: str
    platform: Optional[str] = None


class UploadPresignBody(BaseModel):
    contentType: str = Field(..., min_length=3, max_length=100)
    sizeBytes: int = Field(..., ge=1, le=10_000_000)


class MessageReadBody(BaseModel):
    listingId: str
    otherUserId: str

class UserResponse(BaseModel):
    id: str
    email: str
    name: str
    phone: Optional[str] = None
    avatar: Optional[str] = None
    location: Optional[dict] = None
    rating: dict = {"average": 0, "count": 0}
    createdAt: datetime

class UserUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    avatar: Optional[str] = None
    location: Optional[dict] = None

class ListingCreate(BaseModel):
    title: str = Field(..., min_length=3, max_length=120)
    description: str = Field(..., min_length=0, max_length=MAX_TEXT_LEN)
    price: float = Field(..., ge=0, le=MAX_PRICE)
    category: str = Field(..., min_length=1, max_length=60)
    condition: str = Field(..., min_length=1, max_length=60)
    images: List[str] = Field(default_factory=list)  # base64 images, max 10
    location: Optional[dict] = None

    @field_validator("title", "description", "category", "condition")
    @classmethod
    def _trim_strings(cls, v: str) -> str:
        s = (v or "").strip()
        return s

    @field_validator("title")
    @classmethod
    def _title_has_letter(cls, v: str) -> str:
        if not any(ch.isalpha() for ch in v):
            raise ValueError("Title must include a letter")
        return v

    @field_validator("images")
    @classmethod
    def _images_limit(cls, v: List[str]) -> List[str]:
        if v is None:
            return []
        if len(v) > MAX_IMAGES:
            raise ValueError("Maximum 10 images allowed")
        for img in v:
            if not isinstance(img, str):
                raise ValueError("Invalid image")
            if len(img) > MAX_IMAGE_CHARS:
                raise ValueError("Image too large")
            if not (img.startswith("data:image/") or img.startswith("http://") or img.startswith("https://")):
                raise ValueError("Invalid image format")
        return v

class ListingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=120)
    description: Optional[str] = Field(default=None, min_length=0, max_length=MAX_TEXT_LEN)
    price: Optional[float] = Field(default=None, ge=0, le=MAX_PRICE)
    category: Optional[str] = Field(default=None, min_length=1, max_length=60)
    condition: Optional[str] = Field(default=None, min_length=1, max_length=60)
    images: Optional[List[str]] = None
    location: Optional[dict] = None
    status: Optional[str] = Field(default=None, max_length=30)

    @field_validator("title", "description", "category", "condition", "status")
    @classmethod
    def _trim_opt_strings(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = v.strip()
        return s

    @field_validator("title")
    @classmethod
    def _title_has_letter_opt(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        if not any(ch.isalpha() for ch in v):
            raise ValueError("Title must include a letter")
        return v

    @field_validator("images")
    @classmethod
    def _images_limit_opt(cls, v: Optional[List[str]]) -> Optional[List[str]]:
        if v is None:
            return None
        return ListingCreate._images_limit(v)

class ListingResponse(BaseModel):
    id: str
    sellerId: str
    sellerName: str
    sellerAvatar: Optional[str] = None
    sellerRating: dict
    title: str
    description: str
    price: float
    category: str
    condition: str
    images: List[str]
    location: Optional[dict]
    status: str
    views: int
    favoriteCount: int
    isFavorited: bool = False
    isPromoted: bool = False
    createdAt: datetime
    updatedAt: datetime


class ListingPinResponse(BaseModel):
    id: str
    title: str
    price: float
    lat: float
    lng: float
    image: Optional[str] = None
    distanceMeters: Optional[float] = None


class PaytrTokenBody(BaseModel):
    listingId: str
    packageId: str


class PaytrPromoConfirmBody(BaseModel):
    merchantOid: str = Field(..., min_length=8, max_length=120)


class StoryCreateBody(BaseModel):
    listingId: str
    videoUrl: str
    thumbUrl: Optional[str] = None


class QuestionAskBody(BaseModel):
    listingId: str
    text: str = Field(..., min_length=2, max_length=400)


class QuestionAnswerBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=800)

class MessageCreate(BaseModel):
    listingId: str
    receiverId: str
    text: str = Field(default="", max_length=MAX_MESSAGE_TEXT_LEN)
    image: Optional[str] = None  # data URL veya https URL

    @field_validator("text")
    @classmethod
    def _msg_text_trim(cls, v: str) -> str:
        return (v or "").strip()

    @field_validator("image")
    @classmethod
    def _msg_image_limits(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        s = v.strip()
        if not s:
            return None
        if len(s) > MAX_IMAGE_CHARS:
            raise ValueError("Image too large")
        if not (s.startswith("data:image/") or s.startswith("http://") or s.startswith("https://")):
            raise ValueError("Invalid image format")
        return s


class MessageResponse(BaseModel):
    id: str
    listingId: str
    senderId: str
    receiverId: str
    text: str
    image: Optional[str] = None
    isRead: bool
    createdAt: datetime

class ConversationResponse(BaseModel):
    listingId: str
    listingTitle: str
    listingImage: Optional[str]
    otherUserId: str
    otherUserName: str
    otherUserAvatar: Optional[str]
    lastMessage: str
    lastMessageTime: datetime
    unreadCount: int

class RatingCreate(BaseModel):
    userId: str
    rating: int  # 1-5
    comment: Optional[str] = None
    listingId: Optional[str] = None

class RatingResponse(BaseModel):
    id: str
    userId: str
    reviewerId: str
    reviewerName: str
    rating: int
    comment: Optional[str]
    listingId: Optional[str]
    createdAt: datetime
    replyText: Optional[str] = None
    replyAt: Optional[datetime] = None
    replyAuthorId: Optional[str] = None

class ReportCreate(BaseModel):
    listingId: str
    reason: str
    description: Optional[str] = None


class PurchaseRequestResponse(BaseModel):
    id: str
    listingId: str
    listingTitle: str
    buyerId: str
    buyerName: str
    status: str
    createdAt: datetime


class BuyerSaleNotificationResponse(BaseModel):
    """Satıcı alıcıyı seçtiğinde alıcıya gösterilir (profil bildirimleri)."""
    id: str
    listingId: str
    listingTitle: str
    listingImage: Optional[str] = None
    sellerId: str
    sellerName: str
    createdAt: datetime


class BuyerPurchaseHistoryItemResponse(BaseModel):
    """Alicinin onaylanmis (confirmed) satin alimlari."""
    id: str
    listingId: str
    listingTitle: str
    listingImage: Optional[str] = None
    sellerId: str
    sellerName: str
    confirmedAt: datetime


class MyPurchaseStatusResponse(BaseModel):
    status: str  # none | pending | pending_buyer_confirmation | confirmed | declined
    requestId: Optional[str] = None
    canRate: bool = False


class MessagePartnerResponse(BaseModel):
    userId: str
    name: str
    avatar: Optional[str] = None
    lastMessageAt: datetime


class InitiateSoldToBody(BaseModel):
    buyerId: str


class RatingReplyBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)


# ==================== HELPER FUNCTIONS ====================

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(days=30)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("user_id")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        
        user = await db.users.find_one({"_id": ObjectId(user_id)})
        if user is None:
            raise HTTPException(status_code=401, detail="User not found")
        
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

def serialize_user(user: dict) -> UserResponse:
    return UserResponse(
        id=str(user["_id"]),
        email=user["email"],
        name=user["name"],
        phone=user.get("phone"),
        avatar=user.get("avatar"),
        location=user.get("location"),
        rating=user.get("rating", {"average": 0, "count": 0}),
        createdAt=user["createdAt"]
    )


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _paytr_require_config() -> tuple[str, bytes, str, str, str, str]:
    ok = (PAYTR_OK_URL or "").strip() if isinstance(PAYTR_OK_URL, str) else ""
    fail = (PAYTR_FAIL_URL or "").strip() if isinstance(PAYTR_FAIL_URL, str) else ""
    if not (PAYTR_MERCHANT_ID and PAYTR_MERCHANT_KEY and PAYTR_MERCHANT_SALT and ok and fail):
        raise HTTPException(status_code=500, detail="PayTR is not configured")
    # PayTR requires full URLs (http/https)
    if not (ok.startswith("http://") or ok.startswith("https://")):
        raise HTTPException(status_code=500, detail="PayTR OK URL is invalid")
    if not (fail.startswith("http://") or fail.startswith("https://")):
        raise HTTPException(status_code=500, detail="PayTR FAIL URL is invalid")
    return (
        PAYTR_MERCHANT_ID,
        PAYTR_MERCHANT_KEY.encode("utf-8"),
        PAYTR_MERCHANT_SALT,
        ok,
        fail,
        str(PAYTR_TEST_MODE or "1"),
    )


def _paytr_make_token(
    *,
    merchant_id: str,
    merchant_key_b: bytes,
    merchant_salt: str,
    user_ip: str,
    merchant_oid: str,
    email: str,
    payment_amount_kurus: int,
    user_basket_b64: str,
    no_installment: str,
    max_installment: str,
    currency: str,
    test_mode: str,
) -> str:
    hash_str = (
        merchant_id
        + user_ip
        + merchant_oid
        + email
        + str(payment_amount_kurus)
        + user_basket_b64
        + no_installment
        + max_installment
        + currency
        + test_mode
    )
    mac = hmac.new(merchant_key_b, (hash_str + merchant_salt).encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(mac).decode("ascii")


def _paytr_verify_notify_hash(*, merchant_key_b: bytes, merchant_salt: str, merchant_oid: str, status: str, total_amount: str, hash_value: str) -> bool:
    paytr_token = f"{merchant_oid}{merchant_salt}{status}{total_amount}"
    mac = hmac.new(merchant_key_b, paytr_token.encode("utf-8"), hashlib.sha256).digest()
    expect = base64.b64encode(mac).decode("ascii")
    return hmac.compare_digest(expect, str(hash_value or ""))


def _ascii_sanitize(s: str, max_len: int) -> str:
    # Keep response ASCII-only to avoid unicode issues in files/clients.
    out = []
    for ch in (s or ""):
        if 32 <= ord(ch) <= 126:
            out.append(ch)
        elif ch in "\n\r\t":
            out.append(" ")
        else:
            out.append(" ")
        if len(out) >= max_len:
            break
    return " ".join("".join(out).split()).strip()


def _tr_sanitize(s: str, max_len: int) -> str:
    """
    Allow Turkish letters in title/description while keeping output safe.
    We avoid embedding Turkish characters in source literals; allow by codepoint.
    """
    allow_extra = {
        0x00C7,  # C cedilla
        0x00E7,  # c cedilla
        0x011E,  # G breve
        0x011F,  # g breve
        0x0130,  # I with dot
        0x0131,  # dotless i
        0x00D6,  # O umlaut
        0x00F6,  # o umlaut
        0x015E,  # S cedilla
        0x015F,  # s cedilla
        0x00DC,  # U umlaut
        0x00FC,  # u umlaut
    }
    out = []
    for ch in (s or ""):
        o = ord(ch)
        if 32 <= o <= 126 or o in allow_extra:
            out.append(ch)
        elif ch in "\n\r\t":
            out.append(" ")
        else:
            out.append(" ")
        if len(out) >= max_len:
            break
    return " ".join("".join(out).split()).strip()


def _get_r2_client():
    if not (R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY):
        raise RuntimeError("R2 is not configured (R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY)")
    endpoint = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=R2_ACCESS_KEY_ID,
        aws_secret_access_key=R2_SECRET_ACCESS_KEY,
        region_name="auto",
    )


def _require_r2_bucket_and_public_url() -> tuple[str, str]:
    if not R2_BUCKET:
        raise RuntimeError("R2 is not configured (R2_BUCKET)")
    if not R2_PUBLIC_BASE_URL:
        raise RuntimeError("R2 is not configured (R2_PUBLIC_BASE_URL)")
    return R2_BUCKET, R2_PUBLIC_BASE_URL.rstrip("/")


async def _send_email(to_email: str, subject: str, body: str) -> None:
    if not SMTP_HOST or not SMTP_PORT or not SMTP_FROM:
        raise RuntimeError("SMTP is not configured (SMTP_HOST/SMTP_PORT/SMTP_FROM)")
    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to_email
    msg["Subject"] = subject
    msg.set_content(body)

    def _send() -> None:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            smtp.ehlo()
            try:
                smtp.starttls()
                smtp.ehlo()
            except Exception:
                # If server does not support STARTTLS, keep going.
                pass
            if SMTP_USER and SMTP_PASS:
                smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(msg)

    import asyncio

    await asyncio.to_thread(_send)


async def _send_expo_push(expo_tokens: list[str], title: str, body: str, data: dict) -> None:
    tokens = [t for t in expo_tokens if isinstance(t, str) and t.startswith("ExponentPushToken[")]
    if not tokens:
        return
    payload = [{"to": t, "title": title, "body": body, "data": data} for t in tokens]
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(EXPO_PUSH_URL, json=payload)


async def finalize_listing_sale(pr: dict) -> None:
    """Satışı onayla: bu talebi confirmed yap, diğer bekleyenleri reddet, ilanı satıldı yap."""
    now = datetime.utcnow()
    lid = pr["listingId"]
    rid = pr["_id"]
    await db.purchase_requests.update_one(
        {"_id": rid},
        {"$set": {"status": "confirmed", "updatedAt": now}},
    )
    await db.purchase_requests.update_many(
        {
            "listingId": lid,
            "status": {"$in": ["pending", "pending_buyer_confirmation"]},
            "_id": {"$ne": rid},
        },
        {"$set": {"status": "declined", "updatedAt": now}},
    )
    await db.listings.update_one(
        {"_id": lid},
        {"$set": {"status": "satıldı", "updatedAt": now}},
    )
    # Stop active promotions for sold listings so they don't appear as promoted anymore.
    await db.promotions.update_many(
        {"listingId": lid, "status": "active", "endsAt": {"$gt": now}},
        {"$set": {"status": "ended", "endsAt": now, "updatedAt": now}},
    )


# ==================== AUTH ENDPOINTS ====================

@api_router.post("/auth/register")
async def register(user_data: UserRegister):
    # Check if user exists
    existing_user = await db.users.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user_dict = {
        "email": user_data.email,
        "password": hash_password(user_data.password),
        "name": user_data.name,
        "phone": user_data.phone,
        "avatar": None,
        "location": None,
        "rating": {"average": 0, "count": 0},
        "createdAt": datetime.utcnow()
    }
    
    result = await db.users.insert_one(user_dict)
    user_dict["_id"] = result.inserted_id
    
    # Create token
    token = create_access_token({"user_id": str(result.inserted_id)})
    
    return {
        "token": token,
        "user": serialize_user(user_dict)
    }

@api_router.post("/auth/login")
async def login(credentials: UserLogin, request: Request):
    ip = _client_ip(request)
    if not rate_limiter.allow(f"login:{ip}", limit=10, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests")
    user = await db.users.find_one({"email": credentials.email})
    if not user or not verify_password(credentials.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    token = create_access_token({"user_id": str(user["_id"])})
    
    return {
        "token": token,
        "user": serialize_user(user)
    }

@api_router.get("/auth/me")
async def get_me(current_user = Depends(get_current_user)):
    return serialize_user(current_user)


@api_router.post("/auth/forgot-password")
async def forgot_password(body: ForgotPasswordBody, request: Request):
    ip = _client_ip(request)
    if not rate_limiter.allow(f"forgot:{ip}", limit=5, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests")
    # Always return success to avoid account enumeration.
    user = await db.users.find_one({"email": body.email})
    if not user:
        return {"ok": True}
    if not APP_PUBLIC_URL:
        raise HTTPException(status_code=500, detail="APP_PUBLIC_URL is not configured")

    token = secrets.token_urlsafe(32)
    token_hash = _sha256_hex(token)
    expires_at = datetime.utcnow() + timedelta(minutes=45)
    await db.password_resets.insert_one(
        {
            "userId": user["_id"],
            "tokenHash": token_hash,
            "expiresAt": expires_at,
            "usedAt": None,
            "createdAt": datetime.utcnow(),
        }
    )

    reset_link = f"{APP_PUBLIC_URL.rstrip('/')}/auth/reset?token={token}"
    subject = "Password reset"
    msg = (
        "A password reset was requested for your account.\n\n"
        f"Open this link to set a new password:\n{reset_link}\n\n"
        "If you did not request this, you can ignore this email.\n"
    )
    await _send_email(body.email, subject, msg)
    return {"ok": True}


@api_router.post("/auth/reset-password")
async def reset_password(body: ResetPasswordBody):
    token = (body.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Invalid token")
    token_hash = _sha256_hex(token)
    pr = await db.password_resets.find_one(
        {"tokenHash": token_hash, "usedAt": None, "expiresAt": {"$gt": datetime.utcnow()}},
        sort=[("createdAt", -1)],
    )
    if not pr:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    new_hash = hash_password(body.newPassword)
    await db.users.update_one({"_id": pr["userId"]}, {"$set": {"password": new_hash}})
    await db.password_resets.update_one({"_id": pr["_id"]}, {"$set": {"usedAt": datetime.utcnow()}})
    return {"ok": True}


# ==================== USER ENDPOINTS ====================

@api_router.get("/users/{user_id}")
async def get_user(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return serialize_user(user)

@api_router.put("/users/profile")
async def update_profile(update_data: UserUpdate, current_user = Depends(get_current_user)):
    update_dict = {k: v for k, v in update_data.dict().items() if v is not None}
    
    if update_dict:
        await db.users.update_one(
            {"_id": current_user["_id"]},
            {"$set": update_dict}
        )
    
    updated_user = await db.users.find_one({"_id": current_user["_id"]})
    return serialize_user(updated_user)


# ==================== PUSH TOKENS ====================

@api_router.post("/push/register")
async def push_register(body: PushRegisterBody, current_user = Depends(get_current_user)):
    token = (body.expoPushToken or "").strip()
    if not token.startswith("ExponentPushToken[") or not token.endswith("]"):
        raise HTTPException(status_code=400, detail="Invalid expoPushToken")
    now = datetime.utcnow()
    await db.push_tokens.update_one(
        {"expoPushToken": token},
        {
            "$set": {
                "userId": current_user["_id"],
                "expoPushToken": token,
                "platform": body.platform,
                "updatedAt": now,
            }
        },
        upsert=True,
    )
    return {"ok": True}


@api_router.post("/push/unregister")
async def push_unregister(body: PushRegisterBody, current_user = Depends(get_current_user)):
    token = (body.expoPushToken or "").strip()
    if not token:
        return {"ok": True}
    await db.push_tokens.delete_one({"expoPushToken": token, "userId": current_user["_id"]})
    return {"ok": True}


# ==================== UPLOADS (R2) ====================

@api_router.post("/uploads/presign")
async def uploads_presign(body: UploadPresignBody, request: Request, current_user = Depends(get_current_user)):
    ip = _client_ip(request)
    if not rate_limiter.allow(f"presign:{ip}", limit=30, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests")
    ct = (body.contentType or "").strip().lower()
    if not (ct.startswith("image/") and ct in {"image/jpeg", "image/png", "image/webp"}):
        raise HTTPException(status_code=400, detail="Unsupported content type")
    bucket, public_base = _require_r2_bucket_and_public_url()

    # Key format: uploads/<userId>/<yyyy>/<mm>/<rand>.<ext>
    ext = "jpg" if ct == "image/jpeg" else "png" if ct == "image/png" else "webp"
    now = datetime.utcnow()
    key = f"uploads/{str(current_user['_id'])}/{now.year:04d}/{now.month:02d}/{secrets.token_hex(16)}.{ext}"

    s3 = _get_r2_client()
    put_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": ct},
        ExpiresIn=60 * 10,
        HttpMethod="PUT",
    )
    public_url = f"{public_base}/{key}"
    return {"key": key, "uploadUrl": put_url, "publicUrl": public_url, "contentType": ct}


@api_router.post("/uploads/presign-video")
async def uploads_presign_video(body: UploadPresignBody, request: Request, current_user=Depends(get_current_user)):
    ip = _client_ip(request)
    if not rate_limiter.allow(f"presign_video:{ip}", limit=15, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests")
    ct = (body.contentType or "").strip().lower()
    if ct != "video/mp4":
        raise HTTPException(status_code=400, detail="Unsupported content type")
    # max 15MB
    if not body.sizeBytes or body.sizeBytes <= 0 or body.sizeBytes > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Invalid size")
    bucket, public_base = _require_r2_bucket_and_public_url()
    now = datetime.utcnow()
    key = f"stories/{str(current_user['_id'])}/{now.year:04d}/{now.month:02d}/{secrets.token_hex(16)}.mp4"
    s3 = _get_r2_client()
    put_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": key, "ContentType": ct},
        ExpiresIn=60 * 10,
        HttpMethod="PUT",
    )
    public_url = f"{public_base}/{key}"
    return {"key": key, "uploadUrl": put_url, "publicUrl": public_url, "contentType": ct}


# ==================== LISTING ENDPOINTS ====================

@api_router.post("/listings")
async def create_listing(listing_data: ListingCreate, current_user = Depends(get_current_user)):
    # Validate max 10 images
    if len(listing_data.images) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images allowed")
    
    loc = listing_data.location or None
    geo = None
    try:
        if isinstance(loc, dict) and isinstance(loc.get("lat"), (int, float)) and isinstance(loc.get("lng"), (int, float)):
            lat = float(loc["lat"])
            lng = float(loc["lng"])
            if -90 <= lat <= 90 and -180 <= lng <= 180:
                geo = {"type": "Point", "coordinates": [lng, lat]}
    except Exception:
        geo = None

    listing_dict = {
        "sellerId": current_user["_id"],
        "title": listing_data.title,
        "description": listing_data.description,
        "price": listing_data.price,
        "category": listing_data.category,
        "condition": listing_data.condition,
        "images": listing_data.images,
        "location": (loc if isinstance(loc, dict) else None),
        **({"location": {**loc, "geo": geo}} if isinstance(loc, dict) and geo else {}),
        "status": "aktif",
        "views": 0,
        "favorites": [],
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow()
    }
    
    result = await db.listings.insert_one(listing_dict)
    listing_dict["_id"] = result.inserted_id
    
    return {"id": str(result.inserted_id), "message": "Listing created successfully"}

@api_router.get("/listings")
async def get_listings(
    category: Optional[str] = None,
    search: Optional[str] = None,
    minPrice: Optional[float] = None,
    maxPrice: Optional[float] = None,
    city: Optional[str] = None,
    district: Optional[str] = None,
    condition: Optional[str] = None,
    skip: int = 0,
    limit: int = 20,
    current_user = Depends(get_current_user)
):
    query = {"status": "aktif"}
    skip, limit = clamp_pagination(skip, limit)
    
    if category:
        query["category"] = category
    
    if search:
        # Prefer text index for performance
        query["$text"] = {"$search": search}
    
    if minPrice is not None or maxPrice is not None:
        query["price"] = {}
        if minPrice is not None:
            query["price"]["$gte"] = minPrice
        if maxPrice is not None:
            query["price"]["$lte"] = maxPrice
    
    if city:
        query["location.city"] = city

    if district:
        query["location.district"] = district
    
    if condition:
        query["condition"] = condition
    
    cursor = db.listings.find(query)
    if search:
        cursor = cursor.sort([("score", {"$meta": "textScore"}), ("createdAt", -1)])
    else:
        cursor = cursor.sort("createdAt", -1)
    listings = await cursor.skip(skip).limit(limit).to_list(limit)
    promoted = await fetch_active_promotions_set([l.get("_id") for l in listings if isinstance(l.get("_id"), ObjectId)])
    if promoted:
        listings.sort(key=lambda x: (0 if x.get("_id") in promoted else 1, -(x.get("createdAt").timestamp() if x.get("createdAt") else 0.0)))

    sellers_map = await fetch_users_map([l.get("sellerId") for l in listings])

    result = []
    for listing in listings:
        seller = sellers_map.get(listing.get("sellerId"))
        result.append(ListingResponse(
            id=str(listing["_id"]),
            sellerId=str(listing["sellerId"]),
            sellerName=seller["name"] if seller else "Unknown",
            sellerAvatar=seller.get("avatar") if seller else None,
            sellerRating=seller.get("rating", {"average": 0, "count": 0}) if seller else {"average": 0, "count": 0},
            title=listing["title"],
            description=listing["description"],
            price=listing["price"],
            category=listing["category"],
            condition=listing["condition"],
            images=listing["images"],
            location=listing.get("location"),
            status=listing["status"],
            views=listing["views"],
            favoriteCount=len(listing.get("favorites", [])),
            isFavorited=current_user["_id"] in listing.get("favorites", []),
            isPromoted=listing.get("_id") in promoted,
            createdAt=listing["createdAt"],
            updatedAt=listing["updatedAt"]
        ))
    
    return result


@api_router.get("/listings/nearby")
async def get_listings_nearby(
    lat: float,
    lng: float,
    radiusKm: float = 10.0,
    skip: int = 0,
    limit: int = 20,
    current_user=Depends(get_current_user),
):
    skip, limit = clamp_pagination(skip, limit)
    r_m = max(100.0, min(200_000.0, float(radiusKm) * 1000.0))
    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [float(lng), float(lat)]},
                "distanceField": "distanceMeters",
                "maxDistance": r_m,
                "spherical": True,
                "query": {"status": "aktif"},
            }
        },
        {"$skip": skip},
        {"$limit": limit},
    ]
    rows = await db.listings.aggregate(pipeline).to_list(limit)
    promoted = await fetch_active_promotions_set([r.get("_id") for r in rows if isinstance(r.get("_id"), ObjectId)])
    if promoted:
        rows.sort(key=lambda x: (0 if x.get("_id") in promoted else 1, float(x.get("distanceMeters") or 0.0)))
    sellers_map = await fetch_users_map([r.get("sellerId") for r in rows])
    out = []
    for listing in rows:
        seller = sellers_map.get(listing.get("sellerId"))
        out.append(
            {
                **ListingResponse(
                    id=str(listing["_id"]),
                    sellerId=str(listing["sellerId"]),
                    sellerName=seller["name"] if seller else "Unknown",
                    sellerAvatar=seller.get("avatar") if seller else None,
                    sellerRating=seller.get("rating", {"average": 0, "count": 0}) if seller else {"average": 0, "count": 0},
                    title=listing["title"],
                    description=listing["description"],
                    price=listing["price"],
                    category=listing["category"],
                    condition=listing["condition"],
                    images=listing.get("images", []),
                    location=listing.get("location"),
                    status=listing["status"],
                    views=listing.get("views", 0),
                    favoriteCount=len(listing.get("favorites", [])),
                    isFavorited=current_user["_id"] in listing.get("favorites", []),
                    isPromoted=listing.get("_id") in promoted,
                    createdAt=listing["createdAt"],
                    updatedAt=listing["updatedAt"],
                ).dict(),
                "distanceMeters": float(listing.get("distanceMeters") or 0.0),
            }
        )
    return out


async def fetch_active_promotions_set(listing_ids: list[ObjectId]) -> set[ObjectId]:
    if not listing_ids:
        return set()
    now = datetime.utcnow()
    rows = await db.promotions.find(
        {"listingId": {"$in": listing_ids}, "status": "active", "endsAt": {"$gt": now}},
        {"listingId": 1},
    ).to_list(len(listing_ids))
    s: set[ObjectId] = set()
    for r in rows:
        lid = r.get("listingId")
        if isinstance(lid, ObjectId):
            s.add(lid)
    return s


@api_router.get("/listings/map", response_model=List[ListingPinResponse])
async def get_listings_map(
    lat: float,
    lng: float,
    radiusKm: float = 10.0,
    limit: int = 200,
    current_user=Depends(get_current_user),
):
    # Pins only; allow larger limit but clamp.
    _, limit = clamp_pagination(0, limit)
    limit = min(200, limit)
    r_m = max(100.0, min(200_000.0, float(radiusKm) * 1000.0))
    pipeline = [
        {
            "$geoNear": {
                "near": {"type": "Point", "coordinates": [float(lng), float(lat)]},
                "distanceField": "distanceMeters",
                "maxDistance": r_m,
                "spherical": True,
                "query": {"status": "aktif"},
            }
        },
        {
            "$project": {
                "_id": 1,
                "title": 1,
                "price": 1,
                "images": 1,
                "location.lat": 1,
                "location.lng": 1,
                "distanceMeters": 1,
            }
        },
        {"$limit": limit},
    ]
    rows = await db.listings.aggregate(pipeline).to_list(limit)
    pins: list[ListingPinResponse] = []
    for r in rows:
        loc = r.get("location") or {}
        lat_v = loc.get("lat")
        lng_v = loc.get("lng")
        if not isinstance(lat_v, (int, float)) or not isinstance(lng_v, (int, float)):
            continue
        imgs = r.get("images") or []
        first_img = imgs[0] if isinstance(imgs, list) and imgs else None
        pins.append(
            ListingPinResponse(
                id=str(r["_id"]),
                title=str(r.get("title") or ""),
                price=float(r.get("price") or 0.0),
                lat=float(lat_v),
                lng=float(lng_v),
                image=first_img if isinstance(first_img, str) else None,
                distanceMeters=float(r.get("distanceMeters") or 0.0),
            )
        )
    return pins


# ==================== PAYMENTS (PAYTR) ====================

PAYTR_PACKAGES: dict[str, dict] = {
    "boost_1h_category": {"hours": 1, "scope": "category", "amountKurus": 9900},
    "boost_6h_category": {"hours": 6, "scope": "category", "amountKurus": 29900},
    "boost_24h_category": {"hours": 24, "scope": "category", "amountKurus": 49900},
    "boost_24h_city": {"hours": 24, "scope": "city", "amountKurus": 69900},
    "boost_72h_city": {"hours": 72, "scope": "city", "amountKurus": 129900},
    "boost_7d_global": {"hours": 24 * 7, "scope": "global", "amountKurus": 199900},
}


@api_router.post("/payments/paytr/token")
async def paytr_token(body: PaytrTokenBody, request: Request, current_user=Depends(get_current_user)):
    if body.packageId not in PAYTR_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid package")
    if not ObjectId.is_valid(body.listingId):
        raise HTTPException(status_code=400, detail="Invalid ID")
    listing = await db.listings.find_one({"_id": ObjectId(body.listingId)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.get("sellerId") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    merchant_id, merchant_key_b, merchant_salt, ok_url, fail_url, test_mode = _paytr_require_config()
    user_ip = _client_ip(request)
    merchant_oid = f"promo_{secrets.token_hex(12)}"
    pkg = PAYTR_PACKAGES[body.packageId]
    amount_kurus = int(pkg["amountKurus"])

    # Basket: one item
    basket = [["Promotion", f"{amount_kurus/100:.2f}", 1]]
    user_basket_b64 = base64.b64encode(json.dumps(basket, ensure_ascii=True).encode("utf-8")).decode("ascii")

    paytr_token_v = _paytr_make_token(
        merchant_id=merchant_id,
        merchant_key_b=merchant_key_b,
        merchant_salt=merchant_salt,
        user_ip=user_ip,
        merchant_oid=merchant_oid,
        email=str(current_user.get("email") or "user@example.com"),
        payment_amount_kurus=amount_kurus,
        user_basket_b64=user_basket_b64,
        no_installment="1",
        max_installment="0",
        currency="TL",
        test_mode=test_mode,
    )

    now = datetime.utcnow()
    await db.promotions.insert_one(
        {
            "listingId": ObjectId(body.listingId),
            "sellerId": current_user["_id"],
            "packageId": body.packageId,
            "scope": pkg["scope"],
            "startsAt": None,
            "endsAt": None,
            "status": "pending",
            "merchantOid": merchant_oid,
            "paymentStatus": None,
            "amountKurus": amount_kurus,
            "createdAt": now,
            "updatedAt": now,
        }
    )

    payload = {
        "merchant_id": merchant_id,
        "user_ip": user_ip,
        "merchant_oid": merchant_oid,
        "email": str(current_user.get("email") or "user@example.com"),
        "payment_amount": str(amount_kurus),
        "paytr_token": paytr_token_v,
        "user_basket": user_basket_b64,
        "no_installment": "1",
        "max_installment": "0",
        "user_name": str(current_user.get("name") or "User"),
        "user_address": "N/A",
        "user_phone": str(current_user.get("phone") or "0000000000"),
        "merchant_ok_url": ok_url,
        "merchant_fail_url": fail_url,
        "timeout_limit": "30",
        "currency": "TL",
        "test_mode": test_mode,
        "debug_on": "0",
    }

    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post("https://www.paytr.com/odeme/api/get-token", data=payload)
        try:
            data = r.json()
        except Exception:
            logger.warning("paytr_get_token_bad_json status=%s snippet=%s", r.status_code, (r.text or "")[:400])
            await db.promotions.update_one(
                {"merchantOid": merchant_oid},
                {"$set": {"status": "failed", "updatedAt": datetime.utcnow(), "paymentStatus": {"parseError": True}}},
            )
            raise HTTPException(status_code=502, detail="PayTR invalid response")
    if not isinstance(data, dict) or data.get("status") != "success":
        reason = ""
        if isinstance(data, dict):
            reason = str(data.get("reason") or data.get("err_msg") or data.get("failed_reason_code") or "").strip()
        logger.warning(
            "paytr_get_token_failed merchant_oid=%s paytr_status=%s reason=%s",
            merchant_oid,
            isinstance(data, dict) and data.get("status"),
            reason or (list(data.keys()) if isinstance(data, dict) else str(type(data))),
        )
        await db.promotions.update_one({"merchantOid": merchant_oid}, {"$set": {"status": "failed", "updatedAt": datetime.utcnow(), "paymentStatus": data if isinstance(data, dict) else {"raw": str(data)[:800]}}})
        detail_msg = f"PayTR: {reason}" if reason else "PayTR token failed"
        if len(detail_msg) > 280:
            detail_msg = detail_msg[:277] + "..."
        raise HTTPException(status_code=400, detail=detail_msg)
    return {"iframeToken": data.get("token"), "merchantOid": merchant_oid, "amountKurus": amount_kurus}


@api_router.post("/payments/paytr/notify")
async def paytr_notify(request: Request):
    # PayTR sends form-encoded callback. Must return "OK" on success.
    merchant_id, merchant_key_b, merchant_salt, _ok_url, _fail_url, _test_mode = _paytr_require_config()
    form = await request.form()
    merchant_oid = str(form.get("merchant_oid") or "")
    status_v = str(form.get("status") or "")
    total_amount = str(form.get("total_amount") or "")
    hash_value = str(form.get("hash") or "")

    if not merchant_oid or not status_v or not total_amount or not hash_value:
        raise HTTPException(status_code=400, detail="Invalid notify")
    if not _paytr_verify_notify_hash(
        merchant_key_b=merchant_key_b,
        merchant_salt=merchant_salt,
        merchant_oid=merchant_oid,
        status=status_v,
        total_amount=total_amount,
        hash_value=hash_value,
    ):
        raise HTTPException(status_code=400, detail="Invalid hash")

    promo = await db.promotions.find_one({"merchantOid": merchant_oid})
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")

    now = datetime.utcnow()
    if status_v == "success":
        if promo.get("status") == "active":
            return Response(content="OK", media_type="text/plain")
        pkg = PAYTR_PACKAGES.get(promo.get("packageId") or "")
        hours = int(pkg["hours"]) if pkg else 24
        starts = now
        ends = now + timedelta(hours=hours)
        await db.promotions.update_one(
            {"merchantOid": merchant_oid},
            {"$set": {"status": "active", "paymentStatus": "success", "startsAt": starts, "endsAt": ends, "updatedAt": now}},
        )
    else:
        await db.promotions.update_one(
            {"merchantOid": merchant_oid},
            {"$set": {"status": "failed", "paymentStatus": status_v, "updatedAt": now}},
        )

    return Response(content="OK", media_type="text/plain")


def _paytr_test_mode_enabled() -> bool:
    tm = str(PAYTR_TEST_MODE or "1").strip().lower()
    return tm in ("1", "true", "yes", "on")


@api_router.post("/payments/paytr/promo/confirm")
async def paytr_promo_confirm(body: PaytrPromoConfirmBody, current_user=Depends(get_current_user)):
    """
    Test odemelerinde PayTR notify bazen gecikir veya gelmeyebilir; WebView basari URL'sine
    donunce istemci bu endpoint ile (sadece test_mode acikken) promosyonu aktive eder.
    Canli odemelerde notify tek kaynak olmali; bu route test modunda devre disi birakilabilir.
    """
    if not _paytr_test_mode_enabled():
        raise HTTPException(status_code=403, detail="Promo confirm only when PayTR test mode is on")
    mo = (body.merchantOid or "").strip()
    if not mo.startswith("promo_"):
        raise HTTPException(status_code=400, detail="Invalid merchantOid")
    promo = await db.promotions.find_one({"merchantOid": mo})
    if not promo:
        raise HTTPException(status_code=404, detail="Promotion not found")
    if promo.get("sellerId") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if promo.get("status") == "active":
        return {"ok": True, "alreadyActive": True}
    if promo.get("status") == "failed":
        raise HTTPException(status_code=400, detail="Promotion payment failed")
    if promo.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Invalid promotion state")
    now = datetime.utcnow()
    pkg = PAYTR_PACKAGES.get(promo.get("packageId") or "")
    hours = int(pkg["hours"]) if pkg else 24
    starts = now
    ends = now + timedelta(hours=hours)
    await db.promotions.update_one(
        {"merchantOid": mo},
        {
            "$set": {
                "status": "active",
                "paymentStatus": "success_test_client",
                "startsAt": starts,
                "endsAt": ends,
                "updatedAt": now,
            }
        },
    )
    return {"ok": True}


# ==================== STORIES ====================

@api_router.post("/stories")
async def create_story(body: StoryCreateBody, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(body.listingId):
        raise HTTPException(status_code=400, detail="Invalid ID")
    listing = await db.listings.find_one({"_id": ObjectId(body.listingId)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.get("sellerId") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    video = (body.videoUrl or "").strip()
    if not (video.startswith("http://") or video.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid url")
    thumb = (body.thumbUrl or "").strip() if body.thumbUrl else None
    if thumb and not (thumb.startswith("http://") or thumb.startswith("https://")):
        raise HTTPException(status_code=400, detail="Invalid url")

    now = datetime.utcnow()
    expires = now + timedelta(hours=24)
    doc = {
        "listingId": ObjectId(body.listingId),
        "sellerId": current_user["_id"],
        "videoUrl": video,
        "thumbUrl": thumb,
        "createdAt": now,
        "expiresAt": expires,
    }
    ins = await db.stories.insert_one(doc)
    return {"id": str(ins.inserted_id), "expiresAt": expires}


@api_router.get("/stories")
async def get_stories(current_user=Depends(get_current_user)):
    now = datetime.utcnow()
    rows = await db.stories.find({"expiresAt": {"$gt": now}}).sort("createdAt", -1).limit(50).to_list(50)
    listing_ids = [r.get("listingId") for r in rows if isinstance(r.get("listingId"), ObjectId)]
    listings = await db.listings.find({"_id": {"$in": listing_ids}}, {"title": 1, "images": 1}).to_list(len(listing_ids))
    lmap = {l["_id"]: l for l in listings if isinstance(l.get("_id"), ObjectId)}
    out = []
    for r in rows:
        lid = r.get("listingId")
        lst = lmap.get(lid) if isinstance(lid, ObjectId) else None
        out.append(
            {
                "id": str(r["_id"]),
                "listingId": str(lid) if isinstance(lid, ObjectId) else "",
                "sellerId": str(r.get("sellerId")) if isinstance(r.get("sellerId"), ObjectId) else "",
                "videoUrl": r.get("videoUrl"),
                "thumbUrl": r.get("thumbUrl") or (lst.get("images")[0] if lst and lst.get("images") else None),
                "listingTitle": lst.get("title") if lst else None,
                "expiresAt": r.get("expiresAt"),
            }
        )
    return out


# ==================== QUESTIONS (Q&A) ====================

@api_router.get("/listings/{listing_id}/questions")
async def list_questions(listing_id: str, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    rows = await db.questions.find({"listingId": ObjectId(listing_id)}).sort("createdAt", -1).limit(100).to_list(100)
    asker_ids = []
    for q in rows:
        aid = q.get("askerId")
        if isinstance(aid, ObjectId):
            asker_ids.append(aid)
    asker_map: dict[str, dict] = {}
    if asker_ids:
        uniq = []
        seen = set()
        for x in asker_ids:
            sx = str(x)
            if sx not in seen:
                seen.add(sx)
                uniq.append(x)
        users = await db.users.find({"_id": {"$in": uniq}}, {"name": 1, "avatar": 1}).to_list(len(uniq))
        for u in users:
            if isinstance(u.get("_id"), ObjectId):
                asker_map[str(u["_id"])] = {"name": u.get("name"), "avatar": u.get("avatar")}
    out = []
    for q in rows:
        asker = asker_map.get(str(q.get("askerId") or ""))
        out.append(
            {
                "id": str(q["_id"]),
                "listingId": str(q["listingId"]),
                "askerId": str(q["askerId"]),
                "askerName": asker.get("name") if isinstance(asker, dict) else None,
                "askerAvatar": asker.get("avatar") if isinstance(asker, dict) else None,
                "sellerId": str(q["sellerId"]),
                "text": q.get("text"),
                "answerText": q.get("answerText"),
                "createdAt": q.get("createdAt"),
                "answeredAt": q.get("answeredAt"),
            }
        )
    return out


@api_router.post("/questions")
async def ask_question(body: QuestionAskBody, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(body.listingId):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    listing = await db.listings.find_one({"_id": ObjectId(body.listingId)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing.get("status") != "aktif":
        raise HTTPException(status_code=400, detail="Q&A is closed")
    seller_id = listing.get("sellerId")
    if not isinstance(seller_id, ObjectId):
        raise HTTPException(status_code=400, detail="Invalid listing")
    if seller_id == current_user["_id"]:
        raise HTTPException(status_code=400, detail="Cannot ask your own listing")
    text = _tr_sanitize(body.text, 400)
    if len(text) < 2:
        raise HTTPException(status_code=400, detail="Invalid text")
    now = datetime.utcnow()
    doc = {
        "listingId": ObjectId(body.listingId),
        "askerId": current_user["_id"],
        "sellerId": seller_id,
        "text": text,
        "answerText": None,
        "createdAt": now,
        "answeredAt": None,
    }
    ins = await db.questions.insert_one(doc)
    qid = str(ins.inserted_id)
    await ws_manager.send_to_users([str(seller_id)], {"type": "question_new", "listingId": body.listingId, "questionId": qid})
    return {"id": qid, "ok": True}


@api_router.post("/questions/{question_id}/answer")
async def answer_question(question_id: str, body: QuestionAnswerBody, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    q = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if q.get("sellerId") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    lid = q.get("listingId")
    if isinstance(lid, ObjectId):
        listing = await db.listings.find_one({"_id": lid}, {"status": 1})
        if listing and listing.get("status") != "aktif":
            raise HTTPException(status_code=400, detail="Q&A is closed")
    if q.get("answerText"):
        return {"ok": True}
    text = _tr_sanitize(body.text, 800)
    if not text:
        raise HTTPException(status_code=400, detail="Invalid text")
    now = datetime.utcnow()
    await db.questions.update_one({"_id": ObjectId(question_id)}, {"$set": {"answerText": text, "answeredAt": now}})
    await ws_manager.send_to_users(
        [str(q.get("askerId")), str(q.get("sellerId"))],
        {"type": "question_update", "listingId": str(q.get("listingId")), "questionId": question_id},
    )
    return {"ok": True}


@api_router.delete("/questions/{question_id}")
async def delete_question(question_id: str, current_user=Depends(get_current_user)):
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    q = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    if q.get("sellerId") != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    await db.questions.delete_one({"_id": ObjectId(question_id)})
    lid = q.get("listingId")
    lid_str = str(lid) if isinstance(lid, ObjectId) else ""
    await ws_manager.send_to_users(
        [str(q.get("askerId")), str(q.get("sellerId"))],
        {"type": "question_update", "listingId": lid_str, "questionId": question_id},
    )
    return {"ok": True}

@api_router.get("/listings/{listing_id}")
async def get_listing(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")

    st = listing["status"]
    uid = current_user["_id"]
    seller_id = listing["sellerId"]
    if st == "kaldırıldı":
        if seller_id != uid:
            raise HTTPException(status_code=404, detail="İlan bulunamadı")
    elif st != "aktif":
        if seller_id != uid:
            confirmed_buyer = await db.purchase_requests.find_one({
                "listingId": listing["_id"],
                "buyerId": uid,
                "status": "confirmed",
            })
            if not confirmed_buyer:
                raise HTTPException(status_code=404, detail="İlan bulunamadı")
    
    # Increment views
    await db.listings.update_one(
        {"_id": ObjectId(listing_id)},
        {"$inc": {"views": 1}}
    )
    listing["views"] += 1
    
    seller = await db.users.find_one({"_id": listing["sellerId"]})
    promo_active = False
    now = datetime.utcnow()
    promo = await db.promotions.find_one(
        {"listingId": listing["_id"], "status": "active", "endsAt": {"$gt": now}},
        {"_id": 1},
        sort=[("endsAt", -1)],
    )
    if promo:
        promo_active = True
    if listing.get("status") != "aktif":
        promo_active = False
    
    return ListingResponse(
        id=str(listing["_id"]),
        sellerId=str(listing["sellerId"]),
        sellerName=seller["name"] if seller else "Unknown",
        sellerAvatar=seller.get("avatar") if seller else None,
        sellerRating=seller.get("rating", {"average": 0, "count": 0}) if seller else {"average": 0, "count": 0},
        title=listing["title"],
        description=listing["description"],
        price=listing["price"],
        category=listing["category"],
        condition=listing["condition"],
        images=listing["images"],
        location=listing.get("location"),
        status=listing["status"],
        views=listing["views"],
        favoriteCount=len(listing.get("favorites", [])),
        isFavorited=current_user["_id"] in listing.get("favorites", []),
        isPromoted=promo_active,
        createdAt=listing["createdAt"],
        updatedAt=listing["updatedAt"]
    )


@api_router.get("/listings/{listing_id}/my-purchase", response_model=MyPurchaseStatusResponse)
async def get_my_purchase_for_listing(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    pr = await db.purchase_requests.find_one(
        {"listingId": ObjectId(listing_id), "buyerId": current_user["_id"]},
        sort=[("createdAt", -1)],
    )
    if not pr:
        return MyPurchaseStatusResponse(status="none", canRate=False)
    can_rate = pr["status"] == "confirmed" and not pr.get("ratingSubmitted", False)
    return MyPurchaseStatusResponse(
        status=pr["status"],
        requestId=str(pr["_id"]),
        canRate=can_rate,
    )


@api_router.get("/listings/{listing_id}/message-partners", response_model=List[MessagePartnerResponse])
async def get_listing_message_partners(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Yalnızca ilan sahibi görebilir")

    seller_id = listing["sellerId"]
    messages = await (
        db.messages.find(
            {"listingId": ObjectId(listing_id)},
            projection={"senderId": 1, "receiverId": 1, "createdAt": 1},
        )
        .sort("createdAt", -1)
        .limit(500)
        .to_list(500)
    )

    partners: dict = {}
    for msg in messages:
        if msg["senderId"] == seller_id:
            other = msg["receiverId"]
        elif msg["receiverId"] == seller_id:
            other = msg["senderId"]
        else:
            continue
        key = str(other)
        t = msg["createdAt"]
        if key not in partners or t > partners[key]["lastAt"]:
            partners[key] = {"userId": other, "lastAt": t}

    sorted_partners = sorted(partners.values(), key=lambda x: x["lastAt"], reverse=True)
    users_map = await fetch_users_map([p.get("userId") for p in sorted_partners])
    result = []
    for p in sorted_partners:
        u = users_map.get(p.get("userId"))
        if u:
            result.append(
                MessagePartnerResponse(
                    userId=str(u["_id"]),
                    name=u["name"],
                    avatar=u.get("avatar"),
                    lastMessageAt=p["lastAt"],
                )
            )
    return result


@api_router.post("/listings/{listing_id}/initiate-sold-to")
async def initiate_sold_to_buyer(
    listing_id: str,
    body: InitiateSoldToBody,
    current_user = Depends(get_current_user),
):
    if not ObjectId.is_valid(listing_id) or not ObjectId.is_valid(body.buyerId):
        raise HTTPException(status_code=400, detail="Geçersiz ID")
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if listing["status"] != "aktif":
        raise HTTPException(status_code=400, detail="İlan aktif değil")

    buyer_oid = ObjectId(body.buyerId)
    if buyer_oid == current_user["_id"]:
        raise HTTPException(status_code=400, detail="Kendinizi seçemezsiniz")

    msgs = await db.messages.find({"listingId": ObjectId(listing_id)}).to_list(2000)
    valid = False
    for msg in msgs:
        if msg["senderId"] == current_user["_id"] and msg["receiverId"] == buyer_oid:
            valid = True
            break
        if msg["receiverId"] == current_user["_id"] and msg["senderId"] == buyer_oid:
            valid = True
            break
    if not valid:
        raise HTTPException(status_code=400, detail="Bu kullanıcı ile bu ilan için mesaj geçmişi yok")

    existing_conf = await db.purchase_requests.find_one(
        {"listingId": ObjectId(listing_id), "status": "confirmed"}
    )
    if existing_conf:
        raise HTTPException(status_code=400, detail="Bu ilan için satış zaten tamamlanmış")

    now = datetime.utcnow()
    await db.purchase_requests.update_many(
        {
            "listingId": ObjectId(listing_id),
            "status": {"$in": ["pending", "pending_buyer_confirmation"]},
        },
        {"$set": {"status": "declined", "updatedAt": now}},
    )

    doc = {
        "listingId": ObjectId(listing_id),
        "buyerId": buyer_oid,
        "sellerId": current_user["_id"],
        "status": "pending_buyer_confirmation",
        "initiatedBy": "seller",
        "ratingSubmitted": False,
        "createdAt": now,
        "updatedAt": now,
    }
    ins = await db.purchase_requests.insert_one(doc)
    await ws_manager.send_to_user(str(buyer_oid), {"type": "refresh_buyer_sales"})
    try:
        tokens_docs = await db.push_tokens.find({"userId": buyer_oid}).to_list(20)
        expo_tokens = [d.get("expoPushToken") for d in tokens_docs if isinstance(d.get("expoPushToken"), str)]
        listing_title = listing.get("title") or "Listing"
        seller_name = current_user.get("name") or "Seller"
        await _send_expo_push(
            expo_tokens,
            title=str(seller_name),
            body=f"Sale confirmation: {str(listing_title)[:80]}",
            data={
                "type": "buyer_sale_confirmation",
                "listingId": str(listing.get("_id")),
                "requestId": str(ins.inserted_id),
            },
        )
    except Exception:
        pass
    return {"message": "Alıcıya satış onayı gönderildi", "requestId": str(ins.inserted_id), "status": "pending_buyer_confirmation"}


@api_router.post("/listings/{listing_id}/purchase-request")
async def create_purchase_request(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    if listing["sellerId"] == current_user["_id"]:
        raise HTTPException(status_code=400, detail="Kendi ilanınız için talep oluşturamazsınız")
    if listing["status"] != "aktif":
        raise HTTPException(status_code=400, detail="Bu ilan artık satılık değil")

    existing = await db.purchase_requests.find_one(
        {"listingId": ObjectId(listing_id), "buyerId": current_user["_id"]}
    )
    if existing:
        if existing["status"] == "pending":
            return {"message": "Talep zaten beklemede", "requestId": str(existing["_id"]), "status": "pending"}
        if existing["status"] == "pending_buyer_confirmation":
            return {"message": "Satıcı sizi seçti; ilan sayfasından onaylayın", "requestId": str(existing["_id"]), "status": "pending_buyer_confirmation"}
        if existing["status"] == "confirmed":
            return {"message": "Zaten onaylandı", "requestId": str(existing["_id"]), "status": "confirmed"}
        raise HTTPException(status_code=400, detail="Bu ilan için talebiniz reddedildi veya kapandı")

    doc = {
        "listingId": ObjectId(listing_id),
        "buyerId": current_user["_id"],
        "sellerId": listing["sellerId"],
        "status": "pending",
        "initiatedBy": "buyer",
        "ratingSubmitted": False,
        "createdAt": datetime.utcnow(),
        "updatedAt": datetime.utcnow(),
    }
    ins = await db.purchase_requests.insert_one(doc)
    try:
        seller_oid = listing["sellerId"]
        await ws_manager.send_to_user(
            str(seller_oid),
            {
                "type": "seller_offer_new",
                "listingId": str(listing.get("_id")),
                "requestId": str(ins.inserted_id),
            },
        )
        tokens_docs = await db.push_tokens.find({"userId": seller_oid}).to_list(20)
        expo_tokens = [d.get("expoPushToken") for d in tokens_docs if isinstance(d.get("expoPushToken"), str)]
        buyer_name = current_user.get("name") or "Buyer"
        listing_title = listing.get("title") or "Listing"
        await _send_expo_push(
            expo_tokens,
            title="New offer",
            body=f"{str(buyer_name)[:40]}: {str(listing_title)[:90]}",
            data={
                "type": "seller_offer",
                "listingId": str(listing.get("_id")),
                "requestId": str(ins.inserted_id),
                "buyerId": str(current_user.get("_id")),
            },
        )
    except Exception:
        pass
    return {"message": "Satın alma talebi gönderildi", "requestId": str(ins.inserted_id), "status": "pending"}


@api_router.get("/purchases/seller/pending", response_model=List[PurchaseRequestResponse])
async def get_seller_pending_purchases(current_user = Depends(get_current_user)):
    pending = await db.purchase_requests.find(
        {"sellerId": current_user["_id"], "status": "pending"}
    ).sort("createdAt", -1).to_list(100)

    listing_ids = [pr.get("listingId") for pr in pending if isinstance(pr.get("listingId"), ObjectId)]
    buyer_ids = [pr.get("buyerId") for pr in pending if isinstance(pr.get("buyerId"), ObjectId)]
    listings = await db.listings.find({"_id": {"$in": list(set(listing_ids))}}).to_list(len(set(listing_ids)))
    listings_map = {l["_id"]: l for l in listings}
    buyers_map = await fetch_users_map(buyer_ids)

    result = []
    for pr in pending:
        listing = listings_map.get(pr.get("listingId"))
        buyer = buyers_map.get(pr.get("buyerId"))
        result.append(PurchaseRequestResponse(
            id=str(pr["_id"]),
            listingId=str(pr["listingId"]),
            listingTitle=listing["title"] if listing else "?",
            buyerId=str(pr["buyerId"]),
            buyerName=buyer["name"] if buyer else "Unknown",
            status=pr["status"],
            createdAt=pr["createdAt"],
        ))
    return result


@api_router.get("/purchases/buyer/pending-confirmations", response_model=List[BuyerSaleNotificationResponse])
async def get_buyer_pending_sale_notifications(current_user = Depends(get_current_user)):
    """Satıcının size sattığını bildirdiği, onayınızı bekleyen satışlar (profil bildirimleri)."""
    pending = await db.purchase_requests.find(
        {"buyerId": current_user["_id"], "status": "pending_buyer_confirmation"}
    ).sort("createdAt", -1).to_list(50)

    listing_ids = [pr.get("listingId") for pr in pending if isinstance(pr.get("listingId"), ObjectId)]
    seller_ids = [pr.get("sellerId") for pr in pending if isinstance(pr.get("sellerId"), ObjectId)]
    listings = await db.listings.find({"_id": {"$in": list(set(listing_ids))}}).to_list(len(set(listing_ids)))
    listings_map = {l["_id"]: l for l in listings}
    sellers_map = await fetch_users_map(seller_ids)

    result = []
    for pr in pending:
        listing = listings_map.get(pr.get("listingId"))
        seller = sellers_map.get(pr.get("sellerId"))
        imgs = listing.get("images") if listing else None
        first_img = imgs[0] if isinstance(imgs, list) and len(imgs) > 0 else None
        result.append(BuyerSaleNotificationResponse(
            id=str(pr["_id"]),
            listingId=str(pr["listingId"]),
            listingTitle=listing["title"] if listing else "?",
            listingImage=first_img,
            sellerId=str(pr["sellerId"]),
            sellerName=seller["name"] if seller else "Satıcı",
            createdAt=pr["createdAt"],
        ))
    return result


@api_router.get("/purchases/buyer/history", response_model=List[BuyerPurchaseHistoryItemResponse])
async def get_buyer_purchase_history(current_user = Depends(get_current_user)):
    """Alicinin onaylanmis satin alim gecmisi."""
    items = await db.purchase_requests.find(
        {"buyerId": current_user["_id"], "status": "confirmed"}
    ).sort("updatedAt", -1).to_list(100)

    listing_ids = [pr.get("listingId") for pr in items if isinstance(pr.get("listingId"), ObjectId)]
    seller_ids = [pr.get("sellerId") for pr in items if isinstance(pr.get("sellerId"), ObjectId)]
    listings = await db.listings.find({"_id": {"$in": list(set(listing_ids))}}).to_list(len(set(listing_ids)))
    listings_map = {l["_id"]: l for l in listings}
    sellers_map = await fetch_users_map(seller_ids)

    result: list[BuyerPurchaseHistoryItemResponse] = []
    for pr in items:
        listing = listings_map.get(pr.get("listingId"))
        seller = sellers_map.get(pr.get("sellerId"))
        imgs = listing.get("images") if listing else None
        first_img = imgs[0] if isinstance(imgs, list) and len(imgs) > 0 else None
        confirmed_at = pr.get("updatedAt") or pr.get("createdAt") or datetime.utcnow()
        result.append(BuyerPurchaseHistoryItemResponse(
            id=str(pr["_id"]),
            listingId=str(pr["listingId"]),
            listingTitle=listing["title"] if listing else "?",
            listingImage=first_img,
            sellerId=str(pr["sellerId"]),
            sellerName=seller["name"] if seller else "Satıcı",
            confirmedAt=confirmed_at,
        ))
    return result


@api_router.post("/purchases/{request_id}/confirm")
async def confirm_purchase_request(request_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(request_id):
        raise HTTPException(status_code=400, detail="Invalid request ID")
    pr = await db.purchase_requests.find_one({"_id": ObjectId(request_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="Talep bulunamadı")
    if pr["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if pr["status"] != "pending":
        raise HTTPException(status_code=400, detail="Talep artık beklemede değil")

    await finalize_listing_sale(pr)
    await ws_manager.send_to_user(str(pr["buyerId"]), {"type": "refresh_buyer_sales"})
    return {"message": "Satın alma onaylandı, ilan satıldı olarak işaretlendi"}


@api_router.post("/purchases/{request_id}/buyer-confirm-sold")
async def buyer_confirm_sold(request_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(request_id):
        raise HTTPException(status_code=400, detail="Invalid request ID")
    pr = await db.purchase_requests.find_one({"_id": ObjectId(request_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="Talep bulunamadı")
    if pr["buyerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if pr["status"] != "pending_buyer_confirmation":
        raise HTTPException(status_code=400, detail="Onaylanacak satıcı talebi yok")
    await finalize_listing_sale(pr)
    await ws_manager.send_to_user(str(pr["buyerId"]), {"type": "refresh_buyer_sales"})
    return {"message": "Satış onaylandı, ilan satıldı olarak işaretlendi"}


@api_router.post("/purchases/{request_id}/buyer-reject-sold")
async def buyer_reject_sold(request_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(request_id):
        raise HTTPException(status_code=400, detail="Invalid request ID")
    pr = await db.purchase_requests.find_one({"_id": ObjectId(request_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="Talep bulunamadı")
    if pr["buyerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if pr["status"] != "pending_buyer_confirmation":
        raise HTTPException(status_code=400, detail="Bu talep reddedilemez")
    now = datetime.utcnow()
    await db.purchase_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {"status": "declined", "updatedAt": now}},
    )
    await ws_manager.send_to_user(str(pr["buyerId"]), {"type": "refresh_buyer_sales"})
    return {"message": "Satış onayı reddedildi"}


@api_router.post("/purchases/{request_id}/decline")
async def decline_purchase_request(request_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(request_id):
        raise HTTPException(status_code=400, detail="Invalid request ID")
    pr = await db.purchase_requests.find_one({"_id": ObjectId(request_id)})
    if not pr:
        raise HTTPException(status_code=404, detail="Talep bulunamadı")
    if pr["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    if pr["status"] != "pending":
        raise HTTPException(status_code=400, detail="Talep artık beklemede değil")
    now = datetime.utcnow()
    await db.purchase_requests.update_one(
        {"_id": ObjectId(request_id)},
        {"$set": {"status": "declined", "updatedAt": now}},
    )
    await ws_manager.send_to_user(str(pr["buyerId"]), {"type": "refresh_buyer_sales"})
    return {"message": "Talep reddedildi"}


@api_router.put("/listings/{listing_id}")
async def update_listing(listing_id: str, update_data: ListingUpdate, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    if listing["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")

    if listing.get("status") != "aktif":
        raise HTTPException(status_code=409, detail="Listing is not active")
    
    update_dict = {k: v for k, v in update_data.dict().items() if v is not None}
    
    if "images" in update_dict and len(update_dict["images"]) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 images allowed")
    
    if update_dict:
        update_dict["updatedAt"] = datetime.utcnow()
        await db.listings.update_one(
            {"_id": ObjectId(listing_id)},
            {"$set": update_dict}
        )
    
    return {"message": "Listing updated successfully"}

@api_router.delete("/listings/{listing_id}")
async def delete_listing(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    if listing["sellerId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.listings.update_one(
        {"_id": ObjectId(listing_id)},
        {"$set": {"status": "kaldırıldı", "updatedAt": datetime.utcnow()}}
    )
    
    return {"message": "Listing deleted successfully"}

@api_router.get("/listings/my/listings")
async def get_my_listings(current_user = Depends(get_current_user)):
    listings = await db.listings.find(
        {"sellerId": current_user["_id"], "status": {"$ne": "kaldırıldı"}}
    ).sort("createdAt", -1).to_list(100)
    promoted = await fetch_active_promotions_set([l.get("_id") for l in listings if isinstance(l.get("_id"), ObjectId)])
    
    result = []
    for listing in listings:
        result.append(ListingResponse(
            id=str(listing["_id"]),
            sellerId=str(listing["sellerId"]),
            sellerName=current_user["name"],
            sellerAvatar=current_user.get("avatar"),
            sellerRating=current_user.get("rating", {"average": 0, "count": 0}),
            title=listing["title"],
            description=listing["description"],
            price=listing["price"],
            category=listing["category"],
            condition=listing["condition"],
            images=listing["images"],
            location=listing.get("location"),
            status=listing["status"],
            views=listing["views"],
            favoriteCount=len(listing.get("favorites", [])),
            isFavorited=current_user["_id"] in listing.get("favorites", []),
            isPromoted=(listing.get("status") == "aktif" and listing.get("_id") in promoted),
            createdAt=listing["createdAt"],
            updatedAt=listing["updatedAt"]
        ))
    
    return result

@api_router.post("/listings/{listing_id}/favorite")
async def favorite_listing(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    listing = await db.listings.find_one({"_id": ObjectId(listing_id)})
    if not listing:
        raise HTTPException(status_code=404, detail="Listing not found")
    
    if current_user["_id"] in listing.get("favorites", []):
        raise HTTPException(status_code=400, detail="Already favorited")
    
    await db.listings.update_one(
        {"_id": ObjectId(listing_id)},
        {"$addToSet": {"favorites": current_user["_id"]}}
    )
    
    return {"message": "Added to favorites"}

@api_router.delete("/listings/{listing_id}/favorite")
async def unfavorite_listing(listing_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    await db.listings.update_one(
        {"_id": ObjectId(listing_id)},
        {"$pull": {"favorites": current_user["_id"]}}
    )
    
    return {"message": "Removed from favorites"}

@api_router.get("/listings/my/favorites")
async def get_favorites(current_user = Depends(get_current_user)):
    listings = await db.listings.find({"favorites": current_user["_id"], "status": "aktif"}).sort("createdAt", -1).to_list(100)
    promoted = await fetch_active_promotions_set([l.get("_id") for l in listings if isinstance(l.get("_id"), ObjectId)])

    sellers_map = await fetch_users_map([l.get("sellerId") for l in listings])

    result = []
    for listing in listings:
        seller = sellers_map.get(listing.get("sellerId"))
        result.append(ListingResponse(
            id=str(listing["_id"]),
            sellerId=str(listing["sellerId"]),
            sellerName=seller["name"] if seller else "Unknown",
            sellerAvatar=seller.get("avatar") if seller else None,
            sellerRating=seller.get("rating", {"average": 0, "count": 0}) if seller else {"average": 0, "count": 0},
            title=listing["title"],
            description=listing["description"],
            price=listing["price"],
            category=listing["category"],
            condition=listing["condition"],
            images=listing["images"],
            location=listing.get("location"),
            status=listing["status"],
            views=listing["views"],
            favoriteCount=len(listing.get("favorites", [])),
            isFavorited=True,
            isPromoted=listing.get("_id") in promoted,
            createdAt=listing["createdAt"],
            updatedAt=listing["updatedAt"]
        ))
    
    return result


# ==================== MESSAGE ENDPOINTS ====================

@api_router.post("/messages")
async def send_message(message_data: MessageCreate, request: Request, current_user = Depends(get_current_user)):
    ip = _client_ip(request)
    if not rate_limiter.allow(f"msg:{ip}", limit=60, window_seconds=60):
        raise HTTPException(status_code=429, detail="Too many requests")
    text_clean = (message_data.text or "").strip()
    image_clean = (message_data.image or "").strip() if message_data.image else None
    if image_clean == "":
        image_clean = None
    if not text_clean and not image_clean:
        raise HTTPException(status_code=400, detail="Mesaj metni veya fotoğraf gerekli")
    if image_clean and len(image_clean) > 12_000_000:
        raise HTTPException(status_code=400, detail="Fotoğraf çok büyük; daha küçük bir görsel seçin")
    if not ObjectId.is_valid(message_data.listingId) or not ObjectId.is_valid(message_data.receiverId):
        raise HTTPException(status_code=400, detail="Invalid ID")

    message_dict = {
        "listingId": ObjectId(message_data.listingId),
        "senderId": current_user["_id"],
        "receiverId": ObjectId(message_data.receiverId),
        "text": text_clean,
        "image": image_clean,
        "isRead": False,
        "createdAt": datetime.utcnow()
    }

    result = await db.messages.insert_one(message_dict)
    message_dict["_id"] = result.inserted_id

    msg_out = MessageResponse(
        id=str(message_dict["_id"]),
        listingId=str(message_dict["listingId"]),
        senderId=str(message_dict["senderId"]),
        receiverId=str(message_dict["receiverId"]),
        text=message_dict["text"],
        image=message_dict.get("image"),
        isRead=message_dict["isRead"],
        createdAt=message_dict["createdAt"]
    )

    await ws_manager.send_to_users(
        [str(message_dict["senderId"]), str(message_dict["receiverId"])],
        {"type": "message_new", "message": msg_out.dict()},
    )
    await ws_manager.send_to_users(
        [str(message_dict["senderId"]), str(message_dict["receiverId"])],
        {"type": "refresh_conversations"},
    )
    await ws_manager.send_to_user(str(message_dict["senderId"]), {"type": "refresh_unread"})
    await ws_manager.send_to_user(str(message_dict["receiverId"]), {"type": "refresh_unread"})
    _invalidate_unread_cache([str(message_dict["senderId"]), str(message_dict["receiverId"])])

    try:
        sender_name = current_user.get("name") or "New message"
        preview = (text_clean or "").strip()
        if not preview and image_clean:
            preview = "Photo"
        receiver_oid = message_dict["receiverId"]
        tokens_docs = await db.push_tokens.find({"userId": receiver_oid}).to_list(20)
        expo_tokens = [d.get("expoPushToken") for d in tokens_docs if isinstance(d.get("expoPushToken"), str)]
        await _send_expo_push(
            expo_tokens,
            title=str(sender_name),
            body=preview[:140],
            data={
                "type": "chat",
                "listingId": str(message_dict["listingId"]),
                "otherUserId": str(message_dict["senderId"]),
            },
        )
    except Exception:
        # Push should not break message send.
        pass

    return msg_out


@api_router.delete("/messages/{message_id}")
async def delete_message(message_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(message_id):
        raise HTTPException(status_code=400, detail="Invalid message ID")
    msg = await db.messages.find_one({"_id": ObjectId(message_id)})
    if not msg:
        raise HTTPException(status_code=404, detail="Mesaj bulunamadı")
    if msg["senderId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Yalnızca kendi mesajınızı silebilirsiniz")
    await db.messages.delete_one({"_id": ObjectId(message_id)})
    return {"message": "Mesaj silindi"}


@api_router.get("/messages/conversations")
async def get_conversations(current_user = Depends(get_current_user)):
    # Get all messages where user is sender or receiver
    messages = await (
        db.messages.find(
            {
                "$or": [
                    {"senderId": current_user["_id"]},
                    {"receiverId": current_user["_id"]},
                ]
            },
            projection={
                "listingId": 1,
                "senderId": 1,
                "receiverId": 1,
                "text": 1,
                "image": 1,
                "isRead": 1,
                "createdAt": 1,
            },
        )
        .sort("createdAt", -1)
        .limit(500)
        .to_list(500)
    )
    
    # Group by listing and other user
    conversations = {}
    for msg in messages:
        listing_id = str(msg["listingId"])
        other_user_id = str(msg["receiverId"] if msg["senderId"] == current_user["_id"] else msg["senderId"])
        key = f"{listing_id}_{other_user_id}"
        
        if key not in conversations:
            preview = (msg.get("text") or "").strip()
            if not preview and msg.get("image"):
                preview = "📷 Fotoğraf"
            conversations[key] = {
                "listingId": listing_id,
                "otherUserId": other_user_id,
                "lastMessage": preview or "",
                "lastMessageTime": msg["createdAt"],
                "unreadCount": 0
            }
        
        # Count unread
        if msg["receiverId"] == current_user["_id"] and not msg["isRead"]:
            conversations[key]["unreadCount"] += 1
    
    listing_oids: list[ObjectId] = []
    other_user_oids: list[ObjectId] = []
    for conv in conversations.values():
        if ObjectId.is_valid(conv["listingId"]):
            listing_oids.append(ObjectId(conv["listingId"]))
        if ObjectId.is_valid(conv["otherUserId"]):
            other_user_oids.append(ObjectId(conv["otherUserId"]))

    listings = await db.listings.find({"_id": {"$in": list(set(listing_oids))}}).to_list(len(set(listing_oids)))
    listings_map = {l["_id"]: l for l in listings}
    other_users_map = await fetch_users_map(other_user_oids)

    result = []
    for conv in conversations.values():
        listing_oid = ObjectId(conv["listingId"]) if ObjectId.is_valid(conv["listingId"]) else None
        other_oid = ObjectId(conv["otherUserId"]) if ObjectId.is_valid(conv["otherUserId"]) else None
        listing = listings_map.get(listing_oid) if listing_oid else None
        other_user = other_users_map.get(other_oid) if other_oid else None

        if listing and other_user:
            imgs = listing.get("images") or []
            first_img = imgs[0] if isinstance(imgs, list) and len(imgs) > 0 else None
            result.append(
                ConversationResponse(
                    listingId=conv["listingId"],
                    listingTitle=listing["title"],
                    listingImage=first_img,
                    otherUserId=conv["otherUserId"],
                    otherUserName=other_user["name"],
                    otherUserAvatar=other_user.get("avatar"),
                    lastMessage=conv["lastMessage"],
                    lastMessageTime=conv["lastMessageTime"],
                    unreadCount=conv["unreadCount"],
                )
            )
    
    # Sort by last message time
    result.sort(key=lambda x: x.lastMessageTime, reverse=True)
    
    return result


@api_router.delete("/messages/conversations/{listing_id}/{other_user_id}")
async def delete_conversation(listing_id: str, other_user_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id) or not ObjectId.is_valid(other_user_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    lid = ObjectId(listing_id)
    oid = ObjectId(other_user_id)
    uid = current_user["_id"]

    await db.messages.delete_many(
        {
            "listingId": lid,
            "$or": [
                {"senderId": uid, "receiverId": oid},
                {"senderId": oid, "receiverId": uid},
            ],
        }
    )

    _invalidate_unread_cache([str(uid), str(oid)])
    await ws_manager.send_to_users([str(uid), str(oid)], {"type": "refresh_unread"})
    await ws_manager.send_to_users([str(uid), str(oid)], {"type": "refresh_conversations"})
    return {"ok": True}


@api_router.get("/messages/unread-count")
async def get_unread_message_count(current_user = Depends(get_current_user)):
    uid = str(current_user["_id"])
    now = time.time()
    cached = _unread_count_cache.get(uid)
    if cached and (now - float(cached[0])) <= _UNREAD_COUNT_TTL_SECONDS:
        return {"total": int(cached[1])}

    total = await db.messages.count_documents({"receiverId": current_user["_id"], "isRead": False})
    _unread_count_cache[uid] = (now, int(total))
    return {"total": total}


@api_router.post("/messages/read")
async def mark_messages_read(body: MessageReadBody, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(body.listingId) or not ObjectId.is_valid(body.otherUserId):
        raise HTTPException(status_code=400, detail="Invalid ID")
    listing_oid = ObjectId(body.listingId)
    other_oid = ObjectId(body.otherUserId)

    await db.messages.update_many(
        {
            "listingId": listing_oid,
            "senderId": other_oid,
            "receiverId": current_user["_id"],
            "isRead": False,
        },
        {"$set": {"isRead": True}},
    )
    _invalidate_unread_cache([str(current_user["_id"]), str(other_oid)])

    await ws_manager.send_to_users(
        [str(current_user["_id"]), str(other_oid)],
        {
            "type": "message_read",
            "listingId": str(listing_oid),
            "readerId": str(current_user["_id"]),
            "otherUserId": str(other_oid),
        },
    )
    await ws_manager.send_to_users(
        [str(current_user["_id"]), str(other_oid)],
        {"type": "refresh_unread"},
    )
    await ws_manager.send_to_users(
        [str(current_user["_id"]), str(other_oid)],
        {"type": "refresh_conversations"},
    )
    return {"ok": True}


@api_router.get("/messages/{listing_id}/{other_user_id}")
async def get_chat_messages(listing_id: str, other_user_id: str, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(listing_id) or not ObjectId.is_valid(other_user_id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    
    messages = await db.messages.find({
        "listingId": ObjectId(listing_id),
        "$or": [
            {"senderId": current_user["_id"], "receiverId": ObjectId(other_user_id)},
            {"senderId": ObjectId(other_user_id), "receiverId": current_user["_id"]}
        ]
    }).sort("createdAt", 1).to_list(1000)
    
    # Mark as read
    await db.messages.update_many(
        {
            "listingId": ObjectId(listing_id),
            "senderId": ObjectId(other_user_id),
            "receiverId": current_user["_id"],
            "isRead": False
        },
        {"$set": {"isRead": True}}
    )
    _invalidate_unread_cache([str(current_user["_id"]), str(other_user_id)])

    await ws_manager.send_to_users(
        [str(current_user["_id"]), other_user_id],
        {"type": "refresh_unread"},
    )
    await ws_manager.send_to_users(
        [str(current_user["_id"]), other_user_id],
        {"type": "refresh_conversations"},
    )
    
    result = []
    for msg in messages:
        result.append(MessageResponse(
            id=str(msg["_id"]),
            listingId=str(msg["listingId"]),
            senderId=str(msg["senderId"]),
            receiverId=str(msg["receiverId"]),
            text=msg.get("text") or "",
            image=msg.get("image"),
            isRead=msg["isRead"],
            createdAt=msg["createdAt"]
        ))

    return result


# ==================== RATING ENDPOINTS ====================

@api_router.post("/ratings")
async def create_rating(rating_data: RatingCreate, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(rating_data.userId):
        raise HTTPException(status_code=400, detail="Invalid user ID")

    purchase_request_id = None
    if rating_data.listingId:
        if not ObjectId.is_valid(rating_data.listingId):
            raise HTTPException(status_code=400, detail="Invalid listing ID")
        pr = await db.purchase_requests.find_one(
            {
                "listingId": ObjectId(rating_data.listingId),
                "buyerId": current_user["_id"],
                "sellerId": ObjectId(rating_data.userId),
                "status": "confirmed",
                "ratingSubmitted": {"$ne": True},
            },
            sort=[("createdAt", -1)],
        )
        if not pr:
            raise HTTPException(
                status_code=400,
                detail="Bu ilan için onaylı satın alma yok veya zaten değerlendirildi",
            )
        purchase_request_id = pr["_id"]
    
    # Check if already rated
    existing = await db.ratings.find_one({
        "userId": ObjectId(rating_data.userId),
        "reviewerId": current_user["_id"],
        "listingId": ObjectId(rating_data.listingId) if rating_data.listingId else None
    })
    
    if existing:
        raise HTTPException(status_code=400, detail="Already rated")
    
    rating_dict = {
        "userId": ObjectId(rating_data.userId),
        "reviewerId": current_user["_id"],
        "rating": rating_data.rating,
        "comment": rating_data.comment,
        "listingId": ObjectId(rating_data.listingId) if rating_data.listingId else None,
        "createdAt": datetime.utcnow()
    }
    
    await db.ratings.insert_one(rating_dict)

    if purchase_request_id is not None:
        await db.purchase_requests.update_one(
            {"_id": purchase_request_id},
            {"$set": {"ratingSubmitted": True, "updatedAt": datetime.utcnow()}},
        )
    
    # Update user rating
    all_ratings = await db.ratings.find({"userId": ObjectId(rating_data.userId)}).to_list(1000)
    avg_rating = sum(r["rating"] for r in all_ratings) / len(all_ratings)
    
    await db.users.update_one(
        {"_id": ObjectId(rating_data.userId)},
        {"$set": {"rating": {"average": round(avg_rating, 1), "count": len(all_ratings)}}}
    )
    
    return {"message": "Rating created successfully"}

@api_router.get("/ratings/{user_id}")
async def get_ratings(user_id: str):
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    ratings = await db.ratings.find({"userId": ObjectId(user_id)}).sort("createdAt", -1).to_list(100)
    
    result = []
    for rating in ratings:
        reviewer = await db.users.find_one({"_id": rating["reviewerId"]})
        
        result.append(RatingResponse(
            id=str(rating["_id"]),
            userId=str(rating["userId"]),
            reviewerId=str(rating["reviewerId"]),
            reviewerName=reviewer["name"] if reviewer else "Unknown",
            rating=rating["rating"],
            comment=rating.get("comment"),
            listingId=str(rating["listingId"]) if rating.get("listingId") else None,
            createdAt=rating["createdAt"],
            replyText=rating.get("replyText"),
            replyAt=rating.get("replyAt"),
            replyAuthorId=str(rating["replyAuthorId"]) if rating.get("replyAuthorId") else None,
        ))
    
    return result


@api_router.post("/ratings/{rating_id}/reply")
async def reply_to_rating(
    rating_id: str,
    body: RatingReplyBody,
    current_user = Depends(get_current_user),
):
    if not ObjectId.is_valid(rating_id):
        raise HTTPException(status_code=400, detail="Invalid rating ID")
    rating = await db.ratings.find_one({"_id": ObjectId(rating_id)})
    if not rating:
        raise HTTPException(status_code=404, detail="Değerlendirme bulunamadı")
    if rating["userId"] != current_user["_id"]:
        raise HTTPException(status_code=403, detail="Yalnızca değerlendirilen kullanıcı cevap verebilir")
    if rating.get("replyText"):
        raise HTTPException(status_code=400, detail="Bu değerlendirmeye zaten cevap verildi")
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Cevap boş olamaz")
    now = datetime.utcnow()
    await db.ratings.update_one(
        {"_id": ObjectId(rating_id)},
        {
            "$set": {
                "replyText": text,
                "replyAt": now,
                "replyAuthorId": current_user["_id"],
            }
        },
    )
    return {"message": "Cevabınız kaydedildi"}


# ==================== REPORT ENDPOINTS ====================

@api_router.post("/reports")
async def create_report(report_data: ReportCreate, current_user = Depends(get_current_user)):
    if not ObjectId.is_valid(report_data.listingId):
        raise HTTPException(status_code=400, detail="Invalid listing ID")
    
    report_dict = {
        "listingId": ObjectId(report_data.listingId),
        "reporterId": current_user["_id"],
        "reason": report_data.reason,
        "description": report_data.description,
        "status": "beklemede",
        "createdAt": datetime.utcnow()
    }
    
    await db.reports.insert_one(report_dict)
    
    return {"message": "Report submitted successfully"}


# ==================== CATEGORIES ====================

@api_router.get("/categories")
async def get_categories():
    return [
        "Elektronik",
        "Ev & Yaşam",
        "Moda & Aksesuar",
        "Araç & Yedek Parça",
        "Hobi & Oyun",
        "Spor & Outdoor",
        "Kitap & Müzik",
        "Bebek & Çocuk",
        "Diğer"
    ]


# Include router and middleware
app.include_router(api_router)


@app.get("/.well-known/assetlinks.json")
async def android_assetlinks():
    """
    Android App Links verification file.
    Set env:
      - ANDROID_APP_LINK_SHA256: comma-separated SHA256 fingerprints
      - ANDROID_APP_LINK_PACKAGE: optional (default com.aaksoyyyy.ikinciel)
    """
    raw = (ANDROID_APP_LINK_SHA256 or "").strip()
    if not raw:
        return []
    fps = [x.strip() for x in raw.split(",") if x.strip()]
    return [
        {
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {
                "namespace": "android_app",
                "package_name": ANDROID_APP_LINK_PACKAGE,
                "sha256_cert_fingerprints": fps,
            },
        }
    ]

# allow_credentials=True ile allow_origins=["*"] geçersizdir; tarayıcı ACAO başlığı alamaz (Expo web :8081).
_dev_origins = [
    "http://localhost:8081",
    "http://127.0.0.1:8081",
    "http://localhost:19006",
    "http://127.0.0.1:19006",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_extra = os.getenv("CORS_ORIGINS", "")
if _extra:
    _dev_origins.extend(o.strip() for o in _extra.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_dev_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
async def startup_indexes():
    await ensure_indexes()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
