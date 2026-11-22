"""Outgoing e-mail (password reset codes, moderation notices).

Configured with SMTP_HOST / SMTP_PORT / SMTP_USERNAME / SMTP_PASSWORD / SMTP_SECURITY
(``starttls`` default, ``ssl`` or ``none``) and MAIL_FROM. Without SMTP_HOST nothing leaves the
server: messages are kept in ``OUTBOX`` (the last 100, for tests and development) and logged.
Message bodies are logged only in development mode, because they can contain reset codes.

Mail goes out after the database transaction that caused it commits (``queue``), on a small
thread pool so a slow mail server never holds up a request. Tests send synchronously.
"""

from __future__ import annotations

import logging
import re
import smtplib
import ssl
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from email.message import EmailMessage

from sqlalchemy import event
from sqlalchemy.orm import Session

logger = logging.getLogger("lemonai.hub.mail")


@dataclass(frozen=True)
class Mail:
    to: str
    subject: str
    body: str


OUTBOX: deque[Mail] = deque(maxlen=100)
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="mail")


def _config():
    from app.config import active_config

    return active_config


def configured() -> bool:
    return bool(getattr(_config(), "SMTP_HOST", None))


def _sanitize_header(value: str) -> str:
    return re.sub(r"[\r\n]+", " ", str(value)).strip()


def _deliver(mail: Mail) -> None:
    cfg = _config()
    host = getattr(cfg, "SMTP_HOST", None)
    clean_to = _sanitize_header(mail.to)
    clean_subject = _sanitize_header(mail.subject)
    if not host:
        OUTBOX.append(Mail(to=clean_to, subject=clean_subject, body=mail.body))
        if getattr(cfg, "DEV_MODE", False) or getattr(cfg, "TESTING", False):
            logger.info("mail (no SMTP configured) to %s: %s\n%s", clean_to, clean_subject, mail.body)
        else:
            logger.warning("SMTP_HOST is not set; e-mail to %s (%s) was not sent", clean_to, clean_subject)
        return
    try:
        message = EmailMessage()
        message["From"] = _sanitize_header(getattr(cfg, "MAIL_FROM", None) or f"LemonAI Hub <no-reply@{host}>")
        message["To"] = clean_to
        message["Subject"] = clean_subject
        message.set_content(mail.body)
        port = int(getattr(cfg, "SMTP_PORT", 587) or 587)
        security = (getattr(cfg, "SMTP_SECURITY", "starttls") or "starttls").lower()
        if security == "ssl":
            server: smtplib.SMTP = smtplib.SMTP_SSL(host, port, timeout=20, context=ssl.create_default_context())
        else:
            server = smtplib.SMTP(host, port, timeout=20)
        with server:
            if security == "starttls":
                server.starttls(context=ssl.create_default_context())
            user = getattr(cfg, "SMTP_USERNAME", None)
            if user:
                server.login(user, getattr(cfg, "SMTP_PASSWORD", "") or "")
            server.send_message(message)
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        logger.error("could not send e-mail to %s (%s): %s", clean_to, clean_subject, exc)


def send(mail: Mail) -> None:
    """Sends now (on the pool; synchronously in tests)."""
    if getattr(_config(), "TESTING", False):
        _deliver(mail)
    else:
        _pool.submit(_deliver, mail)


def queue(db: Session, to: str, subject: str, body: str) -> None:
    """Sends once ``db`` commits; dropped if it rolls back."""
    db.info.setdefault("lemon_mail", []).append(Mail(to=to, subject=subject, body=body))


@event.listens_for(Session, "after_commit")
def _after_commit(session: Session) -> None:
    for mail in session.info.pop("lemon_mail", []):
        send(mail)


@event.listens_for(Session, "after_rollback")
def _after_rollback(session: Session) -> None:
    session.info.pop("lemon_mail", None)
