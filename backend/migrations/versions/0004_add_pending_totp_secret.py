"""add pending_totp_secret and totp_last_step to users

Revision ID: 0004_add_pending_totp_secret
Revises: 0003_add_tokens_valid_after
Create Date: 2026-11-11 12:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0004_add_pending_totp_secret"
down_revision = "0003_add_tokens_valid_after"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("pending_totp_secret", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("totp_last_step", sa.Integer(), nullable=True))


def downgrade():
    op.drop_column("users", "totp_last_step")
    op.drop_column("users", "pending_totp_secret")
