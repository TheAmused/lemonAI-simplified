"""add tokens_valid_after to users

Revision ID: 0003_add_tokens_valid_after
Revises: 0002_add_2fa
Create Date: 2026-11-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0003_add_tokens_valid_after"
down_revision = "0002_add_2fa"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("tokens_valid_after", sa.DateTime(), nullable=True))


def downgrade():
    op.drop_column("users", "tokens_valid_after")
