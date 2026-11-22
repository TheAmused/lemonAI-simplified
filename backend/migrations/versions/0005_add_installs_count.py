"""add installs_count to scripts

Revision ID: 0005_add_installs_count
Revises: 0004_add_pending_totp_secret
Create Date: 2026-11-11 14:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0005_add_installs_count"
down_revision = "0004_add_pending_totp_secret"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "scripts",
        sa.Column("installs_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("scripts", "installs_count")
