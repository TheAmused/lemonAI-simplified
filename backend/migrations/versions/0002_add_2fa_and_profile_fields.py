"""add 2fa and profile fields to users

Revision ID: 0002_add_2fa
Revises: 0001_initial_schema
Create Date: 2026-11-06 19:30:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0002_add_2fa"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("totp_secret", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("backup_codes", sa.JSON(), nullable=True))


def downgrade():
    op.drop_column("users", "backup_codes")
    op.drop_column("users", "totp_secret")
    op.drop_column("users", "two_factor_enabled")
