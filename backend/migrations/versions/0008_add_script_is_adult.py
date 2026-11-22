"""scripts.is_adult: adult (uncensored / NSFW) models are hidden unless the client asks for them

Revision ID: 0008_add_script_is_adult
Revises: 0007_add_recovery_notifications
Create Date: 2026-11-16 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "0008_add_script_is_adult"
down_revision = "0007_add_recovery_notifications"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("scripts", sa.Column("is_adult", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_scripts_is_adult", "scripts", ["is_adult"])


def downgrade():
    op.drop_index("ix_scripts_is_adult", table_name="scripts")
    op.drop_column("scripts", "is_adult")
